/*
 * Testes da recolha de cotações reais Zurich (sem BD nem rede).
 *
 * A BD real gera signed_error/absolute_error/relative_error; a loja em memória
 * abaixo simula essa geração com a MESMA convenção documentada em types.ts
 * (estimado - real) para poder testar o fluxo completo sem tocar na produção.
 *
 *   npx tsc --outDir <tmp> --module commonjs --moduleResolution node10 \
 *     --target es2022 --strict --skipLibCheck --esModuleInterop --types node \
 *     src/lib/quoting/observations/__tests__/observations.test.ts
 *   node --test <tmp>/quoting/observations/__tests__/observations.test.js
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import type { EstimateCalibration, EstimatedQuote, QuoteComparison, QuoteRequest } from "../../domain/types";
import { auditBaseEstimates, buildBaseEstimateRepairSql } from "../audit";
import {
  buildCalibrationSnapshot,
  calibrationSnapshotToJson,
  readCalibrationSnapshot,
} from "../calibration-snapshot";
import { findPossibleDuplicate, type DuplicateProbe } from "../dedupe";
import {
  buildAccuracyReport,
  compareBaseAndCalibrated,
  computeAccuracyMetrics,
  computeCalibratedMetrics,
  deriveErrors,
} from "../metrics";
import {
  normalizeDate,
  normalizePlate,
  normalizePostalCode,
  normalizeText,
  parseMoney,
  toFiniteNumber,
  toJsonValue,
} from "../normalize";
import {
  issueZurichSnapshotToken,
  signSimulationSnapshot,
  verifySimulationSnapshot,
} from "../simulation-token";
import {
  buildObservationInsert,
  buildPredictionSnapshot,
  buildRequestSnapshot,
} from "../snapshots";
import type {
  CalibrationRow,
  DuplicateCandidate,
  MetricsFilters,
  MetricsRow,
  ObservationStore,
  QuoteObservationSource,
  RealQuoteData,
  ZurichQuoteObservationInsert,
  ZurichQuoteObservationRow,
} from "../types";
import { parseRealQuoteForm } from "../validation";
import {
  getZurichQuoteAccuracyMetrics,
  saveZurichQuoteObservation,
} from "../zurich-quote-observations";

// ---------- fixtures ----------

/** Vista tipada e permissiva de um snapshot JSON (só para asserções). */
type Snapshot = {
  customer: Record<string, unknown>;
  vehicle: Record<string, unknown>;
  claims: unknown;
  claimsLast3Years: unknown;
  [key: string]: unknown;
};

const NOW = "2026-09-21T12:00:00.000Z";
const CLIENT_ID = "11111111-1111-4111-8111-111111111111";

function makeRequest(overrides: Partial<QuoteRequest> = {}): QuoteRequest {
  return {
    requestId: "req-1",
    clientId: CLIENT_ID,
    productLine: "AUTO",
    requestedAt: NOW,
    customer: {
      birthDate: "1998-03-14",
      postalCode: "4700-123",
      drivingLicenceDate: "2018-06-01",
      usage: "PRIVATE",
    },
    vehicle: {
      registration: "AB-12-CD",
      make: null,
      model: null,
      version: null,
      firstRegistrationDate: null,
      fuelType: null,
      engineCc: null,
      powerKw: null,
      marketValue: null,
      annualKm: null,
    },
    claims: null,
    requestedCoverages: {
      liability: true,
      ownDamage: true,
      collision: true,
      fire: false,
      theft: false,
      glass: true,
      assistance: false,
      legalProtection: false,
      deductible: 500,
    },
    paymentFrequency: "ANNUAL",
    metadata: { origin: "simulador-ui" },
    ...overrides,
  };
}

function makePrediction(overrides: Partial<EstimatedQuote> = {}): EstimatedQuote {
  return {
    insurerCode: "ZURICH",
    insurerName: "Zurich",
    productLine: "AUTO",
    reasons: ["Estimativa histórica"],
    warnings: ["Aviso"],
    generatedAt: NOW,
    status: "ESTIMATED",
    source: "INTERNAL_MODEL",
    premiumBasis: "ANNUAL_TOTAL",
    pointEstimate: 300,
    priceRange: { min: 250, max: 380 },
    confidence: "LOW",
    confidenceScore: 41.5,
    comparablePolicies: 12,
    consideredFactors: ["Tipo de cobertura", "Idade do titular"],
    modelVersion: "zurich-auto-v3",
    diagnostics: {
      target: { basis: "ANNUAL_TOTAL", source: "annualized_premium", confirmedShare: 1, note: "" },
      selection: {
        fallbackLevel: 2,
        fallbackLabel: "x",
        strongComparables: 4,
        secondaryComparables: 8,
        effectiveSampleSize: 9.5,
        meanSimilarity: 0.81,
        minSimilarity: 0.5,
        poolSize: 100,
      },
      estimator: { method: "WINSORIZED_MEAN", comparablesEstimate: 300, modelPrediction: 310, modelBlend: 0.5, dispersion: 0.2, outliersAdjusted: 0 },
      interval: { nominalCoverage: 0.8, lowerError: -0.2, upperError: 0.3, source: "SEGMENT", residuals: 20 },
      historicalError: null,
      confidence: { score: 41.5, components: {}, cap: null },
      adjustments: [],
      mainFactors: [],
      unavailableData: [],
      inputUsage: [],
    },
    ...overrides,
  };
}

function makeCalibration(overrides: Partial<EstimateCalibration> = {}): EstimateCalibration {
  return {
    version: "zurich-calibration-v1",
    configMode: "EXPERIMENTAL",
    mode: "NEAREST_QUOTES",
    experimental: true,
    applied: false,
    eligibleForProduction: false,
    baseEstimate: 362,
    baseRange: { min: 255, max: 538 },
    calibratedEstimate: 1259.87,
    headlineEstimate: 1259.87,
    productionSafeEstimate: 537.89,
    clamped: false,
    adjustment: { amount: 897.87, percent: 2.48 },
    sampleSize: 2,
    productionSampleSize: 2,
    effectiveSampleSize: 1.1,
    confidence: "LOW",
    reason: "Amostra insuficiente para produção.",
    modelVersion: "zurich-auto-v3",
    diagnostics: {
      totalValidObservations: 2,
      consideredObservations: 2,
      rejected: { modelVersion: 0, basis: 0, tier: 0, invalid: 0, retroactive: 0 },
      globalBias: null,
      medianResidual: null,
      meanAbsoluteError: null,
      weightedResidual: 2.48,
      residualPercentiles: null,
      meanSimilarity: 0.9,
      independentObservations: 1.1,
      independentProductionObservations: 1.1,
      robustness: "NONE",
      methods: { weightedMean: null, weightedMedian: null, trimmedMean: null },
      requiredForProduction: 5,
    },
    ...overrides,
  };
}

/** Previsão em que a UI MOSTROU o valor calibrado (PRODUCTION aplicada): pointEstimate != base. */
function appliedPrediction(): EstimatedQuote {
  return makePrediction({
    pointEstimate: 1259.87,
    priceRange: { min: 887.48, max: 1872.4 },
    calibration: makeCalibration({
      configMode: "PRODUCTION",
      experimental: false,
      applied: true,
      eligibleForProduction: true,
      headlineEstimate: null,
      productionSafeEstimate: 1259.87,
    }),
  });
}

const REAL: RealQuoteData = {
  amount: 400,
  basis: "UNKNOWN",
  productCode: "5324",
  productName: "Zurich Auto",
  reference: "SIM-001",
};

/** Loja em memória que imita a BD (incluindo as colunas geradas). */
/** Espelha supabase-store.ts: source vive dentro de insurer_quote_snapshot. */
function sourceOf(row: ZurichQuoteObservationRow): QuoteObservationSource | null {
  const value = (row.insurer_quote_snapshot as { source?: unknown } | null)?.source;

  return value === "MANUAL_ENTRY" || value === "RETROACTIVE_PORTFOLIO" ? value : null;
}

class MemoryStore implements ObservationStore {
  rows: ZurichQuoteObservationRow[] = [];
  private counter = 0;

  async insert(row: ZurichQuoteObservationInsert): Promise<ZurichQuoteObservationRow> {
    // A BD nunca recebe as colunas geradas.
    assert.ok(!("signed_error" in row), "signed_error não pode ser escrito");
    assert.ok(!("absolute_error" in row), "absolute_error não pode ser escrito");
    assert.ok(!("relative_error" in row), "relative_error não pode ser escrito");

    const signed = row.estimated_premium - row.real_quote_amount;
    this.counter += 1;

    const stored: ZurichQuoteObservationRow = {
      ...row,
      id: randomUUID(),
      created_at: new Date(Date.parse(NOW) + this.counter * 1000).toISOString(),
      signed_error: signed,
      absolute_error: Math.abs(signed),
      relative_error: Math.abs(signed) / row.real_quote_amount,
    };

    this.rows.push(stored);

    return stored;
  }

  async findDuplicateCandidates(query: { plate: string | null; reference: string | null }): Promise<DuplicateCandidate[]> {
    return this.rows
      .filter(
        (row) =>
          ["VALID", "MANUAL_OVERRIDE"].includes(row.status) &&
          ((query.plate !== null && row.vehicle_registration === query.plate) ||
            (query.reference !== null &&
              row.real_quote_reference?.toLowerCase() === query.reference.toLowerCase())),
      )
      .map((row) => ({ ...row, source: sourceOf(row) }));
  }

  async listForCalibration(): Promise<CalibrationRow[]> {
    return this.rows
      .filter((row) => row.status === "VALID")
      .map((row) => ({ ...row, source: sourceOf(row) }));
  }

  async listValidForMetrics(
    filters: Omit<MetricsFilters, "modelVersion" | "calibrationVersion" | "calibrationMode">,
  ): Promise<MetricsRow[]> {
    return this.rows
      .map((r) => ({
        ...r,
        calibration: r.prediction_snapshot.calibration ?? null,
        source: sourceOf(r),
      }))
      .filter(
      (row) =>
        row.status === "VALID" &&
        (!filters.coverageTier || row.coverage_tier === filters.coverageTier) &&
        (!filters.productCode || row.real_product_code === filters.productCode) &&
        (!filters.basis || row.real_quote_basis === filters.basis),
    );
  }
}

async function save(
  store: MemoryStore,
  overrides: {
    request?: QuoteRequest;
    prediction?: EstimatedQuote;
    realQuote?: Partial<RealQuoteData>;
    status?: Parameters<typeof saveZurichQuoteObservation>[0]["status"];
    notes?: string | null;
    quotedAt?: string;
  } = {},
) {
  return saveZurichQuoteObservation({
    request: overrides.request ?? makeRequest(),
    prediction: overrides.prediction ?? makePrediction(),
    realQuote: { ...REAL, ...overrides.realQuote },
    status: overrides.status,
    notes: overrides.notes,
    quotedAt: overrides.quotedAt ?? NOW,
    store,
  });
}

function row(overrides: Partial<MetricsRow> = {}): MetricsRow {
  return {
    id: randomUUID(),
    status: "VALID",
    model_version: "zurich-auto-v3",
    quoted_at: NOW,
    coverage_tier: "RC",
    real_product_code: "5324",
    real_quote_basis: "ANNUAL",
    estimated_premium: 300,
    real_quote_amount: 400,
    signed_error: null,
    absolute_error: null,
    relative_error: null,
    confidence_label: null,
    calibration: null,
    source: "MANUAL_ENTRY",
    ...overrides,
  };
}

// ---------- os 10 casos pedidos ----------

describe("erros (convenção estimado - real)", () => {
  it("1. estimado 300, real 400: subestimou (−100, 100, 0,25)", async () => {
    const store = new MemoryStore();
    const result = await save(store, { prediction: makePrediction({ pointEstimate: 300 }), realQuote: { amount: 400 } });

    assert.ok(result.ok);
    assert.equal(result.observation.signed_error, -100);
    assert.equal(result.observation.absolute_error, 100);
    assert.equal(result.observation.relative_error, 0.25);
    assert.deepEqual(deriveErrors(300, 400), { signed: -100, absolute: 100, relative: 0.25 });
  });

  it("2. estimado 500, real 400: sobrestimou (signed_error positivo)", async () => {
    const store = new MemoryStore();
    const result = await save(store, { prediction: makePrediction({ pointEstimate: 500 }), realQuote: { amount: 400 } });

    assert.ok(result.ok);
    assert.ok((result.observation.signed_error as number) > 0);
    assert.equal(deriveErrors(500, 400)?.signed, 100);
  });

  it("as colunas geradas nunca são escritas pela aplicação", async () => {
    const built = buildObservationInsert({
      request: makeRequest(),
      prediction: makePrediction(),
      realQuote: REAL,
      status: "VALID",
      quotedAt: NOW,
    });

    assert.ok(built.ok);
    for (const column of ["signed_error", "absolute_error", "relative_error", "id", "created_at"]) {
      assert.ok(!(column in built.row), column);
    }
  });
});

describe("métricas por status", () => {
  it("3. status TEST não entra nas métricas", async () => {
    const store = new MemoryStore();

    await save(store, { status: "TEST", realQuote: { reference: "T-1" } });

    const report = await getZurichQuoteAccuracyMetrics({}, store);

    assert.equal(report.overall.count, 0);
  });

  it("4. status VALID entra nas métricas", async () => {
    const store = new MemoryStore();

    await save(store);

    const report = await getZurichQuoteAccuracyMetrics({}, store);

    assert.equal(report.overall.count, 1);
    assert.equal(report.overall.meanSignedError, -100);
  });

  it("5. status DUPLICATE não entra nas métricas (mesmo se vier da BD)", () => {
    const metrics = computeAccuracyMetrics([
      row({ status: "DUPLICATE" }),
      row({ status: "INVALID" }),
      row({ status: "EXPIRED" }),
      row({ status: "VALID" }),
    ]);

    assert.equal(metrics.count, 1);
    assert.equal(buildAccuracyReport([row({ status: "DUPLICATE" })]).overall.count, 0);
  });

  it("9. versões diferentes do modelo permanecem separadas", async () => {
    const rows = [
      row({ model_version: "zurich-auto-v2", estimated_premium: 350, real_quote_amount: 400 }),
      row({ model_version: "zurich-auto-v2", estimated_premium: 380, real_quote_amount: 400 }),
      row({ model_version: "zurich-auto-v3", estimated_premium: 300, real_quote_amount: 400 }),
    ];

    const all = buildAccuracyReport(rows);

    assert.equal(all.byModelVersion["zurich-auto-v2"].count, 2);
    assert.equal(all.byModelVersion["zurich-auto-v3"].count, 1);
    assert.equal(all.byModelVersion["zurich-auto-v2"].mae, 35);
    assert.equal(all.byModelVersion["zurich-auto-v3"].mae, 100);
    assert.ok(all.warnings.some((w) => w.includes("várias versões")));

    const onlyV3 = buildAccuracyReport(rows, { modelVersion: "zurich-auto-v3" });

    assert.equal(onlyV3.overall.count, 1);
    assert.equal(onlyV3.overall.mae, 100);
    // As outras versões continuam visíveis lado a lado.
    assert.equal(Object.keys(onlyV3.byModelVersion).length, 2);
  });

  it("a versão do modelo gravada é a da previsão, não uma constante", async () => {
    const store = new MemoryStore();
    const result = await save(store, { prediction: makePrediction({ modelVersion: "zurich-auto-v9" }) });

    assert.ok(result.ok);
    assert.equal(result.observation.model_version, "zurich-auto-v9");
    assert.equal(
      (result.observation.prediction_snapshot as { modelVersion: string }).modelVersion,
      "zurich-auto-v9",
    );
  });
});

describe("validação no servidor", () => {
  it("6. valor real <= 0 é rejeitado", async () => {
    for (const amount of [0, -5, Number.NaN]) {
      const result = await save(new MemoryStore(), { realQuote: { amount } });

      assert.equal(result.ok, false);
    }

    assert.equal(parseRealQuoteForm({ amount: "0", basis: "UNKNOWN" }).ok, false);
    assert.equal(parseRealQuoteForm({ amount: "-10", basis: "UNKNOWN" }).ok, false);
    assert.equal(parseRealQuoteForm({ amount: "abc", basis: "UNKNOWN" }).ok, false);
    assert.equal(parseRealQuoteForm({ amount: "", basis: "UNKNOWN" }).ok, false);
  });

  it("rejeita previsão inexistente, versão do modelo vazia e pedido vazio", async () => {
    const store = new MemoryStore();

    const emptyVersion = await save(store, { prediction: makePrediction({ modelVersion: "  " }) });
    const emptyRequest = await saveZurichQuoteObservation({
      request: null as unknown as QuoteRequest,
      prediction: makePrediction(),
      realQuote: REAL,
      store,
    });
    const notZurich = await save(store, { prediction: makePrediction({ insurerCode: "OUTRA" }) });
    const badEstimate = await save(store, { prediction: makePrediction({ pointEstimate: 0 }) });

    const missing = await saveZurichQuoteObservation({
      request: makeRequest(),
      prediction: null as unknown as EstimatedQuote,
      realQuote: REAL,
      store,
    });

    for (const result of [emptyVersion, emptyRequest, notZurich, badEstimate, missing]) {
      assert.equal(result.ok, false);
    }

    assert.equal(store.rows.length, 0, "nada foi gravado pelos pedidos inválidos");
  });

  it("base e estado inválidos são rejeitados; a base nunca é assumida ANNUAL", () => {
    assert.equal(parseRealQuoteForm({ amount: "400", basis: "ANUAL" }).ok, false);
    assert.equal(parseRealQuoteForm({ amount: "400" }).ok, false);
    assert.equal(parseRealQuoteForm({ amount: "400", basis: "UNKNOWN", status: "DUPLICATE" }).ok, false);
    assert.equal(parseRealQuoteForm({ amount: "400", basis: "UNKNOWN", status: "LIXO" }).ok, false);
    assert.equal(parseRealQuoteForm(null).ok, false);

    const ok = parseRealQuoteForm({ amount: "400", basis: "ANNUAL" });

    assert.ok(ok.ok);
    assert.equal(ok.value.status, "VALID");
  });

  it("strings vazias opcionais viram null; valores em euros à portuguesa", () => {
    const parsed = parseRealQuoteForm({
      amount: "1.264,40",
      basis: "TOTAL",
      productName: "  ",
      productCode: "",
      reference: "  SIM 9  ",
      notes: "\n ",
      status: "",
    });

    assert.ok(parsed.ok);
    assert.equal(parsed.value.realQuote.amount, 1264.4);
    assert.equal(parsed.value.realQuote.productName, null);
    assert.equal(parsed.value.realQuote.productCode, null);
    assert.equal(parsed.value.realQuote.reference, "SIM 9");
    assert.equal(parsed.value.notes, null);
    assert.equal(parsed.value.status, "VALID");
  });
});

describe("snapshots e normalização", () => {
  it("7. null permanece null (nunca 0) e não se inventam campos", async () => {
    const store = new MemoryStore();
    const request = makeRequest({
      customer: { birthDate: "1998-03-14", postalCode: "4700-123", drivingLicenceDate: null, usage: "PRIVATE" },
    });
    const result = await save(store, { request });

    assert.ok(result.ok);

    const snapshot = result.observation.request_snapshot as Snapshot;

    assert.equal(result.observation.driving_licence_date, null);
    assert.equal(snapshot.customer.drivingLicenceDate, null);
    assert.equal(snapshot.vehicle.make, null);
    assert.equal(snapshot.vehicle.model, null);
    assert.equal(snapshot.vehicle.marketValue, null);
    assert.equal(snapshot.claimsLast3Years, null);
    assert.equal(snapshot.claims, null);
    assert.ok(!("nif" in snapshot.customer));
  });

  it("guarda sempre a data da carta quando existe", async () => {
    const result = await save(new MemoryStore());

    assert.ok(result.ok);
    assert.equal(result.observation.driving_licence_date, "2018-06-01");
  });

  it("8. os snapshots mantêm os valores originais (imutáveis)", async () => {
    const store = new MemoryStore();
    const request = makeRequest();
    const prediction = makePrediction();
    const result = await save(store, { request, prediction });

    assert.ok(result.ok);

    // Alterar os objetos originais depois não muda o que ficou guardado.
    request.customer.postalCode = "1000-001";
    prediction.pointEstimate = 999;
    prediction.reasons.push("depois");

    const snap = result.observation.request_snapshot as Snapshot;
    const pred = result.observation.prediction_snapshot as { reasons: string[]; [key: string]: unknown };

    assert.equal(snap.customer.postalCode, "4700-123");
    assert.equal(pred.pointEstimate, 300);
    assert.equal(pred.reasons.length, 1);
    assert.equal(pred.lowerEstimate, 250);
    assert.equal(pred.upperEstimate, 380);
    assert.equal(pred.strongComparables, 4);
    assert.equal(pred.secondaryComparables, 8);
    assert.equal(pred.effectiveSampleSize, 9.5);
    assert.equal(pred.meanSimilarity, 0.81);
    assert.equal(pred.confidenceScore, 41.5);
    assert.deepEqual(pred.consideredFactors, ["Tipo de cobertura", "Idade do titular"]);
  });

  it("colunas normalizadas: matrícula, código postal, datas, números", async () => {
    const request = makeRequest({
      customer: { birthDate: "1998-03-14T00:00:00Z", postalCode: "4700 123", drivingLicenceDate: "2018-06-01", usage: "TVDE" },
      vehicle: { ...makeRequest().vehicle!, registration: " ab 12 cd " },
    });
    const result = await save(new MemoryStore(), { request });

    assert.ok(result.ok);

    const r = result.observation;

    assert.equal(r.vehicle_registration, "AB-12-CD");
    assert.equal(r.postal_code, "4700-123");
    assert.equal(r.birth_date, "1998-03-14");
    assert.equal(r.usage_type, "TVDE");
    assert.equal(r.coverage_tier, "OWN_DAMAGE");
    assert.equal(r.deductible, 500);
    assert.equal(r.payment_frequency, "ANNUAL");
    assert.equal(r.strong_comparables, 4);
    assert.equal(r.estimated_lower, 250);
    assert.equal(r.confidence_label, "LOW");
    assert.equal(r.status, "VALID");
    assert.equal(r.client_id, CLIENT_ID);
  });

  it("normalizadores: inválido -> null, nunca 0 nem NaN", () => {
    assert.equal(normalizePlate("12-34"), null);
    assert.equal(normalizePlate(null), null);
    assert.equal(normalizePostalCode("47"), null);
    assert.equal(normalizePostalCode("4700"), "4700");
    assert.equal(normalizeDate("2026-02-30"), null);
    assert.equal(normalizeDate("hoje"), null);
    assert.equal(normalizeText("   "), null);
    assert.equal(toFiniteNumber(undefined), null);
    assert.equal(toFiniteNumber(Number.NaN), null);
    assert.equal(toFiniteNumber(""), null);
    assert.equal(toFiniteNumber("12.5"), 12.5);
    assert.equal(parseMoney("1264,40 €"), 1264.4);
    assert.equal(parseMoney("1 264.40"), 1264.4);
    assert.equal(parseMoney("1,2,3"), null);
    assert.deepEqual(toJsonValue({ a: Number.NaN, b: undefined, c: [Number.POSITIVE_INFINITY, 1] }), { a: null, c: [null, 1] });
  });

  it("o snapshot do pedido não leva NIF nem segredos", () => {
    const request = makeRequest();

    (request.customer as { nif?: string }).nif = "123456789";

    const text = JSON.stringify(buildRequestSnapshot(request));

    assert.ok(!text.includes("123456789"));
    assert.ok(!/password|token|cookie|authorization|otp/i.test(text));
    assert.ok(!/password|token|cookie|authorization|otp/i.test(JSON.stringify(buildPredictionSnapshot(makePrediction()))));
  });
});

describe("deduplicação", () => {
  const candidate = (overrides: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
    id: randomUUID(),
    created_at: NOW,
    quoted_at: NOW,
    status: "VALID",
    vehicle_registration: "AB-12-CD",
    birth_date: "1998-03-14",
    driving_licence_date: "2018-06-01",
    postal_code: "4700-123",
    coverage_tier: "OWN_DAMAGE",
    deductible: 500,
    payment_frequency: "ANNUAL",
    real_product_code: "5324",
    real_product_name: "Zurich Auto",
    real_quote_reference: "SIM-001",
    real_quote_amount: 400,
    real_quote_basis: "ANNUAL",
    source: "MANUAL_ENTRY",
    ...overrides,
  });

  const probe = (overrides: Partial<DuplicateProbe> = {}): DuplicateProbe => ({
    plate: "AB-12-CD",
    reference: null,
    birthDate: "1998-03-14",
    drivingLicenceDate: "2018-06-01",
    postalCode: "4700-123",
    coverageTier: "OWN_DAMAGE",
    deductible: 500,
    paymentFrequency: "ANNUAL",
    productCode: "5324",
    productName: "Zurich Auto",
    quotedAt: NOW,
    amount: 402,
    ...overrides,
  });

  it("mesma referência com matrícula compatível é duplicado", () => {
    const original = candidate();

    assert.equal(findPossibleDuplicate(probe({ reference: " sim-001 ", amount: 900 }), [original])?.duplicateOf, original.id);
    assert.equal(findPossibleDuplicate(probe({ reference: "SIM-001", plate: null }), [original])?.reason, "SAME_REFERENCE");
  });

  it("mesma referência com matrícula diferente NÃO é duplicado", () => {
    assert.equal(findPossibleDuplicate(probe({ reference: "SIM-001", plate: "ZZ-99-ZZ", birthDate: "1970-01-01" }), [candidate()]), null);
  });

  it("mesmo risco e preço (<= 1%) na janela é duplicado", () => {
    const original = candidate();
    const match = findPossibleDuplicate(probe(), [original]);

    assert.equal(match?.duplicateOf, original.id);
    assert.equal(match?.reason, "SAME_RISK_AND_PRICE");
  });

  it("preço diferente, fora da janela ou risco diferente NÃO marca", () => {
    const original = candidate();

    assert.equal(findPossibleDuplicate(probe({ amount: 460 }), [original]), null);
    assert.equal(findPossibleDuplicate(probe({ quotedAt: "2026-12-01T12:00:00.000Z" }), [original]), null);
    assert.equal(findPossibleDuplicate(probe({ deductible: 250 }), [original]), null);
    assert.equal(findPossibleDuplicate(probe({ postalCode: "4800-000" }), [original]), null);
    assert.equal(findPossibleDuplicate(probe({ coverageTier: "RC" }), [original]), null);
  });

  it("desconhecido nunca é tratado como igual", () => {
    assert.equal(findPossibleDuplicate(probe({ drivingLicenceDate: null }), [candidate()]), null);
    assert.equal(findPossibleDuplicate(probe({ productCode: null, productName: null }), [candidate()]), null);
    assert.equal(findPossibleDuplicate(probe({ plate: null }), [candidate()]), null);
  });

  it("só compara com VALID/MANUAL_OVERRIDE e devolve a mais antiga", () => {
    const older = candidate({ created_at: "2026-09-01T00:00:00.000Z" });
    const newer = candidate({ created_at: "2026-09-10T00:00:00.000Z" });
    const test = candidate({ status: "TEST" });
    const dup = candidate({ status: "DUPLICATE" });

    assert.equal(findPossibleDuplicate(probe(), [newer, older])?.duplicateOf, older.id);
    assert.equal(findPossibleDuplicate(probe(), [test, dup]), null);
  });

  it("10. o dedupe marca DUPLICATE e nunca apaga registos", async () => {
    const store = new MemoryStore();
    const first = await save(store, { realQuote: { amount: 400, reference: "SIM-A" } });
    const second = await save(store, { realQuote: { amount: 401, reference: null } });
    const third = await save(store, { realQuote: { amount: 900, reference: null } });

    assert.ok(first.ok && second.ok && third.ok);
    assert.equal(first.observation.status, "VALID");
    assert.equal(first.duplicate, null);

    assert.equal(second.observation.status, "DUPLICATE");
    assert.equal(second.observation.duplicate_of, first.observation.id);

    // Preço bem diferente: nova cotação, não duplicado.
    assert.equal(third.observation.status, "VALID");

    assert.equal(store.rows.length, 3, "nenhuma linha foi apagada");
    assert.ok(store.rows.some((r) => r.id === first.observation.id));

    const report = await getZurichQuoteAccuracyMetrics({}, store);

    assert.equal(report.overall.count, 2, "o duplicado não conta duas vezes");
  });

  it("não faz dedupe para estados que não contam (TEST/INVALID)", async () => {
    const store = new MemoryStore();

    await save(store, { realQuote: { reference: "SIM-A" } });

    const test = await save(store, { status: "TEST", realQuote: { reference: "SIM-A" } });

    assert.ok(test.ok);
    assert.equal(test.observation.status, "TEST");
    assert.equal(test.observation.duplicate_of, null);
  });

  it("DUPLICATE não se escolhe manualmente", async () => {
    const result = await save(new MemoryStore(), { status: "DUPLICATE" });

    assert.equal(result.ok, false);
  });
});

describe("métricas", () => {
  it("valores conhecidos: MAE, mediana, RMSE, bias, taxas e percentis", () => {
    // erros assinados: -100, -50, -20, +30, +60  (real 400 em todos)
    const rows = [300, 350, 380, 430, 460].map((estimated) => row({ estimated_premium: estimated, real_quote_amount: 400 }));
    const m = computeAccuracyMetrics(rows);

    assert.equal(m.count, 5);
    assert.equal(m.mae, 52);
    assert.equal(m.medianAbsoluteError, 50);
    assert.equal(m.meanSignedError, -16);
    assert.ok(Math.abs((m.rmse as number) - Math.sqrt((10000 + 2500 + 400 + 900 + 3600) / 5)) < 1e-9);
    assert.equal(m.underestimationRate, 0.6);
    assert.equal(m.overestimationRate, 0.4);
    assert.equal(m.exactRate, 0);
    assert.equal(m.absErrorP50, 50);
    assert.equal(m.absErrorP75, 60);
    assert.ok((m.absErrorP90 as number) > 60 && (m.absErrorP95 as number) <= 100);
    assert.ok(Math.abs((m.meanRelativeError as number) - 0.13) < 1e-9);
    assert.ok(Math.abs((m.meanSignedRelativeError as number) - -0.04) < 1e-9);
  });

  it("usa as colunas geradas quando existem e deriva quando são null", () => {
    const withColumns = computeAccuracyMetrics([row({ signed_error: -100, absolute_error: 100, relative_error: 0.25 })]);
    const derived = computeAccuracyMetrics([row()]);

    assert.equal(withColumns.mae, 100);
    assert.equal(derived.mae, 100);
    assert.equal(derived.meanRelativeError, 0.25);
  });

  it("sem observações: tudo null (nunca 0) e aviso", () => {
    const report = buildAccuracyReport([]);

    assert.equal(report.overall.count, 0);
    assert.equal(report.overall.mae, null);
    assert.equal(report.overall.underestimationRate, null);
    assert.ok(report.warnings.some((w) => w.includes("Sem observações")));
  });

  it("linhas com valor real inválido não entram (nunca viram 0)", () => {
    assert.equal(computeAccuracyMetrics([row({ real_quote_amount: 0 }), row({ estimated_premium: Number.NaN })]).count, 0);
  });

  it("avisa amostra pequena e bases não equivalentes", () => {
    const report = buildAccuracyReport([row({ real_quote_basis: "INSTALLMENT" }), row({ real_quote_basis: "ANNUAL" })]);

    assert.ok(report.warnings.some((w) => w.includes("Amostra pequena")));
    assert.ok(report.warnings.some((w) => w.includes("INSTALLMENT")));
    assert.equal(report.byBasis.ANNUAL.count, 1);
    assert.equal(report.byBasis.INSTALLMENT.count, 1);
  });

  it("filtros de cobertura, produto e base passam à loja", async () => {
    const store = new MemoryStore();

    await save(store, { realQuote: { reference: "A", basis: "ANNUAL" } });
    await save(store, {
      request: makeRequest({ requestedCoverages: { ...makeRequest().requestedCoverages, ownDamage: false, collision: false } }),
      realQuote: { reference: "B", basis: "TOTAL", productCode: "5907" },
    });

    assert.equal((await getZurichQuoteAccuracyMetrics({}, store)).overall.count, 2);
    assert.equal((await getZurichQuoteAccuracyMetrics({ coverageTier: "RC" }, store)).overall.count, 1);
    assert.equal((await getZurichQuoteAccuracyMetrics({ productCode: "5907" }, store)).overall.count, 1);
    assert.equal((await getZurichQuoteAccuracyMetrics({ basis: "ANNUAL" }, store)).overall.count, 1);
  });
});

describe("estimativa BASE vs CALIBRADA", () => {
  it("1. estimated_premium guarda SEMPRE a estimativa base (mesmo se a UI mostrou o calibrado)", async () => {
    const store = new MemoryStore();
    const result = await save(store, { prediction: appliedPrediction(), realQuote: { amount: 1262.55 } });

    assert.ok(result.ok);

    const r = result.observation;

    assert.equal(r.estimated_premium, 362, "base, não 1259.87");
    assert.equal(r.estimated_lower, 255);
    assert.equal(r.estimated_upper, 538);
    assert.equal(r.model_version, "zurich-auto-v3", "versão do modelo BASE");

    const snapshot = r.prediction_snapshot as { pointEstimate: number; baseEstimate: number; lowerEstimate: number; displayed: { pointEstimate: number; calibrationApplied: boolean } };

    assert.equal(snapshot.pointEstimate, 362, "topo do snapshot = base");
    assert.equal(snapshot.baseEstimate, 362);
    assert.equal(snapshot.lowerEstimate, 255);
    assert.equal(snapshot.displayed.pointEstimate, 1259.87, "o mostrado fica identificado à parte");
    assert.equal(snapshot.displayed.calibrationApplied, true);
  });

  it("2. o calibratedEstimate fica só no snapshot (nunca numa coluna) com versão e modo", async () => {
    const store = new MemoryStore();
    const result = await save(store, { prediction: appliedPrediction() });

    assert.ok(result.ok);

    const r = result.observation;
    const calibration = (r.prediction_snapshot as { calibration: Record<string, unknown> }).calibration;

    assert.equal(calibration.calibratedEstimate, 1259.87);
    assert.equal(calibration.baseEstimate, 362);
    assert.equal(calibration.version, "zurich-calibration-v1");
    assert.equal(calibration.mode, "PRODUCTION");
    assert.equal(calibration.strategy, "NEAREST_QUOTES");
    assert.equal(calibration.adjustmentAmount, 897.87);
    assert.equal(calibration.experimental, false);

    for (const column of ["estimated_premium", "estimated_lower", "estimated_upper", "real_quote_amount"] as const) {
      assert.notEqual(r[column], 1259.87, column);
    }

    assert.ok(!Object.keys(r).some((key) => /calibrat/i.test(key)), "nenhuma coluna de calibração");
  });

  it("3. o signed_error gerado mede o erro da BASE contra o real", async () => {
    const store = new MemoryStore();
    const result = await save(store, { prediction: appliedPrediction(), realQuote: { amount: 1262.55 } });

    assert.ok(result.ok);
    assert.ok(Math.abs((result.observation.signed_error as number) - (362 - 1262.55)) < 1e-9);
    assert.ok((result.observation.signed_error as number) < -900, "a base subestimou");
    assert.ok(Math.abs((result.observation.relative_error as number) - 900.55 / 1262.55) < 1e-9);
  });

  it("em EXPERIMENTAL a base é o pointEstimate e o calibrado fica à parte", async () => {
    const prediction = makePrediction({ pointEstimate: 362, calibration: makeCalibration() });
    const result = await save(new MemoryStore(), { prediction });

    assert.ok(result.ok);
    assert.equal(result.observation.estimated_premium, 362);

    const calibration = (result.observation.prediction_snapshot as { calibration: Record<string, unknown> }).calibration;

    assert.equal(calibration.calibratedEstimate, 1259.87);
    assert.equal(calibration.applied, false);
  });

  it("o valor mostrado em grande fica registado em displayed, sem tocar na base", async () => {
    // Em EXPERIMENTAL a UI mostra a «Calibração com cotações reais» em grande, mas o pointEstimate é a base.
    const prediction = makePrediction({ pointEstimate: 362, calibration: makeCalibration() });
    const result = await save(new MemoryStore(), { prediction, realQuote: { amount: 1262.55 } });

    assert.ok(result.ok);
    assert.equal(result.observation.estimated_premium, 362, "a base, não o valor em grande");

    const displayed = (result.observation.prediction_snapshot as { displayed: { pointEstimate: number; headlineEstimate: number | null } }).displayed;

    assert.equal(displayed.pointEstimate, 362);
    assert.equal(displayed.headlineEstimate, 1259.87);
    assert.ok(Math.abs((result.observation.signed_error as number) - (362 - 1262.55)) < 1e-9, "o erro gerado continua a ser o da base");
  });

  it("sem observações compatíveis o calibratedEstimate é null (nunca a base repetida)", () => {
    const none = buildCalibrationSnapshot(makeCalibration({ mode: "NONE", calibratedEstimate: 362, sampleSize: 0 }));
    const disabled = buildCalibrationSnapshot(makeCalibration({ configMode: "DISABLED" }));

    assert.equal(none?.calibratedEstimate, null);
    assert.equal(none?.adjustmentAmount, null);
    assert.equal(disabled?.calibratedEstimate, null);
    assert.equal(buildCalibrationSnapshot(undefined), null);
  });

  it("leitura defensiva do snapshot de calibração", () => {
    const good = readCalibrationSnapshot(calibrationSnapshotToJson(buildCalibrationSnapshot(makeCalibration())!));

    assert.equal(good?.calibratedEstimate, 1259.87);
    assert.equal(readCalibrationSnapshot(null), null);
    assert.equal(readCalibrationSnapshot("lixo"), null);
    assert.equal(readCalibrationSnapshot({ version: "v1", mode: "OUTRO", baseEstimate: 1 }), null);
    assert.equal(readCalibrationSnapshot({ version: "v1", mode: "EXPERIMENTAL", baseEstimate: 0 }), null);

    for (const invalid of [0, -5, Number.NaN, "abc", null]) {
      const snapshot = readCalibrationSnapshot({ version: "v1", mode: "EXPERIMENTAL", strategy: "NEAREST_QUOTES", baseEstimate: 300, calibratedEstimate: invalid });

      assert.equal(snapshot?.calibratedEstimate, null, String(invalid));
    }
  });
});

describe("métricas: base e calibrada separadas", () => {
  const withCalibration = (calibratedEstimate: number | null, version = "zurich-calibration-v1", mode: "EXPERIMENTAL" | "PRODUCTION" = "EXPERIMENTAL") =>
    calibrationSnapshotToJson(
      buildCalibrationSnapshot(
        makeCalibration({ version, configMode: mode, calibratedEstimate: calibratedEstimate ?? 0, mode: calibratedEstimate === null ? "NONE" : "NEAREST_QUOTES" }),
      )!,
    );

  it("4. o MAE calibrado usa o calibratedEstimate e o base usa estimated_premium", () => {
    const rows = [
      row({ estimated_premium: 300, real_quote_amount: 400, calibration: withCalibration(380) }),
      row({ estimated_premium: 300, real_quote_amount: 500, calibration: withCalibration(480) }),
    ];

    assert.equal(computeAccuracyMetrics(rows).mae, 150, "base: |300-400| e |300-500|");
    assert.equal(computeCalibratedMetrics(rows).mae, 20, "calibrada: |380-400| e |480-500|");
    assert.equal(computeCalibratedMetrics(rows).meanSignedError, -20);
  });

  it("5. sem calibratedEstimate entra nas métricas base mas NÃO nas calibradas", () => {
    const rows = [
      row({ estimated_premium: 300, real_quote_amount: 400, calibration: withCalibration(380) }),
      row({ estimated_premium: 300, real_quote_amount: 400, calibration: null }),
      row({ estimated_premium: 300, real_quote_amount: 400, calibration: withCalibration(null) }),
    ];

    assert.equal(computeAccuracyMetrics(rows).count, 3);
    assert.equal(computeCalibratedMetrics(rows).count, 1);

    const comparison = compareBaseAndCalibrated(rows);

    assert.equal(comparison.pairedCount, 1);
    // A base do par compara-se só nas MESMAS observações.
    assert.equal(comparison.base.count, 1);
    assert.equal(comparison.calibrated.count, 1);
  });

  it("nunca há fallback silencioso para estimated_premium nas métricas calibradas", () => {
    const rows = [row({ estimated_premium: 399, real_quote_amount: 400, calibration: { version: "v1", mode: "EXPERIMENTAL", baseEstimate: 399, strategy: "NEAREST_QUOTES" } })];

    assert.equal(computeCalibratedMetrics(rows).count, 0);
    assert.equal(computeCalibratedMetrics(rows).mae, null);
  });

  it("melhoria do MAE: variação negativa = menos erro; amostra pequena assinalada", () => {
    const small = compareBaseAndCalibrated([
      row({ estimated_premium: 210, real_quote_amount: 420, calibration: withCalibration(325) }),
    ]);

    assert.equal(small.sufficient, false);
    assert.ok(Math.abs((small.maeChange as number) - (95 - 210) / 210) < 1e-9);
    assert.ok((small.maeChange as number) < 0);

    const report = buildAccuracyReport([row({ estimated_premium: 210, real_quote_amount: 420, calibration: withCalibration(325) })]);

    assert.ok(report.warnings.some((w) => w.includes("insuficiente")));

    const many = Array.from({ length: 12 }, () => row({ estimated_premium: 300, real_quote_amount: 400, calibration: withCalibration(390) }));

    assert.equal(compareBaseAndCalibrated(many).sufficient, true);
  });

  it("11. versões do modelo e da calibração ficam em saídas separadas", () => {
    const rows = [
      row({ model_version: "zurich-auto-v2", calibration: null }),
      row({ model_version: "zurich-auto-v3", calibration: null }),
      row({ model_version: "zurich-auto-v3", calibration: withCalibration(380, "zurich-calibration-v1", "EXPERIMENTAL") }),
      row({ model_version: "zurich-auto-v3", calibration: withCalibration(380, "zurich-calibration-v2", "EXPERIMENTAL") }),
      row({ model_version: "zurich-auto-v3", calibration: withCalibration(380, "zurich-calibration-v1", "PRODUCTION") }),
    ];

    const report = buildAccuracyReport(rows);
    const labels = report.byOutput.map((group) => group.label);

    assert.equal(labels.length, 5);
    assert.ok(labels.includes("zurich-auto-v2 + sem calibração"));
    assert.ok(labels.includes("zurich-auto-v3 + sem calibração"));
    assert.ok(labels.includes("zurich-auto-v3 + zurich-calibration-v1 (EXPERIMENTAL)"));
    assert.ok(labels.includes("zurich-auto-v3 + zurich-calibration-v2 (EXPERIMENTAL)"));
    assert.ok(labels.includes("zurich-auto-v3 + zurich-calibration-v1 (PRODUCTION)"));
    assert.equal(report.byOutput.find((g) => g.label.endsWith("sem calibração") && g.modelVersion === "zurich-auto-v3")?.calibrated, null);
    assert.ok(report.warnings.some((w) => w.includes("com e sem calibração")));
  });

  it("filtros por versão da calibração e por modo (incluindo 'NONE' = sem calibração)", () => {
    const rows = [
      row({ calibration: null }),
      row({ calibration: withCalibration(380, "zurich-calibration-v1", "EXPERIMENTAL") }),
      row({ calibration: withCalibration(380, "zurich-calibration-v2", "PRODUCTION") }),
    ];

    assert.equal(buildAccuracyReport(rows, { calibrationVersion: "NONE" }).overall.count, 1);
    assert.equal(buildAccuracyReport(rows, { calibrationVersion: "zurich-calibration-v2" }).overall.count, 1);
    assert.equal(buildAccuracyReport(rows, { calibrationMode: "EXPERIMENTAL" }).overall.count, 1);
    assert.equal(buildAccuracyReport(rows, { calibrationMode: "PRODUCTION", calibrationVersion: "zurich-calibration-v1" }).overall.count, 0);
  });

  it("o total 'overall' é só a base: não inclui o efeito da calibração", () => {
    const report = buildAccuracyReport([row({ estimated_premium: 300, real_quote_amount: 400, calibration: withCalibration(399) })]);

    assert.equal(report.overall.mae, 100);
    assert.equal(report.calibration.calibrated.mae, 1);
  });
});

describe("auditoria de estimated_premium (só deteta e propõe)", () => {
  const ID_A = "11111111-1111-4111-8111-111111111111";
  const ID_B = "22222222-2222-4222-8222-222222222222";
  const ID_C = "33333333-3333-4333-8333-333333333333";

  it("linhas antigas sem snapshot de calibração não são ambíguas", () => {
    const audit = auditBaseEstimates([
      { id: ID_A, estimated_premium: 364.92, estimated_lower: 257, estimated_upper: 543, prediction_snapshot: { pointEstimate: 364.92 } },
    ]);

    assert.equal(audit.ok, 1);
    assert.equal(audit.recoverable, 0);
    assert.equal(audit.unrecoverable, 0);
    assert.match(buildBaseEstimateRepairSql(audit), /Nada a corrigir/);
  });

  it("estimated_premium calibrado com base no snapshot é recuperável, e o SQL é só uma proposta", () => {
    const calibration = calibrationSnapshotToJson(buildCalibrationSnapshot(makeCalibration())!);
    const audit = auditBaseEstimates([
      { id: ID_A, estimated_premium: 1259.87, estimated_lower: 887.48, estimated_upper: 1872.4, prediction_snapshot: { pointEstimate: 1259.87, calibration } },
      { id: ID_B, estimated_premium: 362, estimated_lower: 255, estimated_upper: 538, prediction_snapshot: { pointEstimate: 362, calibration } },
      { id: ID_C, estimated_premium: 900, estimated_lower: null, estimated_upper: null, prediction_snapshot: { pointEstimate: 362 } },
    ]);

    assert.equal(audit.total, 3);
    assert.equal(audit.recoverable, 1);
    assert.equal(audit.ok, 1);
    assert.equal(audit.unrecoverable, 1, "sem base no snapshot não se adivinha");

    const recoverable = audit.findings.find((f) => f.id === ID_A);

    assert.equal(recoverable?.proposed?.estimated_premium, 362);
    assert.equal(recoverable?.proposed?.estimated_lower, 255);

    const sql = buildBaseEstimateRepairSql(audit);

    assert.match(sql, /NÃO EXECUTAR AUTOMATICAMENTE/);
    assert.match(sql, new RegExp(`WHERE id = '${ID_A}' AND estimated_premium = 1259.87`));
    assert.ok(!sql.includes(ID_B) && !sql.includes(ID_C), "só as recuperáveis");
    assert.ok(!/signed_error|absolute_error|relative_error/.test(sql.replace(/-- .*signed_error.*/g, "")), "não mexe nas colunas geradas");
  });

  it("recusa ids inválidos no SQL", () => {
    const calibration = calibrationSnapshotToJson(buildCalibrationSnapshot(makeCalibration())!);
    const audit = auditBaseEstimates([
      { id: "1'; DROP TABLE x;--", estimated_premium: 900, estimated_lower: null, estimated_upper: null, prediction_snapshot: { calibration } },
    ]);

    assert.throws(() => buildBaseEstimateRepairSql(audit));
  });
});

describe("token assinado da simulação", () => {
  const SECRET = "segredo-de-teste";
  const snapshot = { issuedAt: NOW, request: makeRequest(), prediction: makePrediction() };

  it("ida e volta preserva o pedido e a previsão", () => {
    const token = signSimulationSnapshot(snapshot, SECRET);
    const verified = verifySimulationSnapshot(token, SECRET, new Date(NOW));

    assert.ok(verified.ok);
    assert.equal(verified.snapshot.prediction.pointEstimate, 300);
    assert.equal(verified.snapshot.request.customer.postalCode, "4700-123");
  });

  it("adulteração, segredo errado e formato inválido são rejeitados", () => {
    const token = signSimulationSnapshot(snapshot, SECRET);
    const [version, payload, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...snapshot, prediction: { ...snapshot.prediction, pointEstimate: 1 } })).toString("base64url");

    assert.deepEqual(verifySimulationSnapshot(`${version}.${forged}.${signature}`, SECRET, new Date(NOW)), { ok: false, reason: "BAD_SIGNATURE" });
    assert.deepEqual(verifySimulationSnapshot(token, "outro", new Date(NOW)), { ok: false, reason: "BAD_SIGNATURE" });
    assert.deepEqual(verifySimulationSnapshot("lixo", SECRET), { ok: false, reason: "MALFORMED" });
    assert.deepEqual(verifySimulationSnapshot(undefined, SECRET), { ok: false, reason: "MALFORMED" });
    assert.deepEqual(verifySimulationSnapshot(`${version}.${payload}.x`, SECRET), { ok: false, reason: "BAD_SIGNATURE" });
  });

  it("expira", () => {
    const token = signSimulationSnapshot(snapshot, SECRET);
    const later = new Date(Date.parse(NOW) + 15 * 86_400_000);

    assert.deepEqual(verifySimulationSnapshot(token, SECRET, later), { ok: false, reason: "EXPIRED" });
  });

  it("só se emite para uma estimativa Zurich Auto; sem segredo devolve null", () => {
    const comparison = (results: EstimatedQuote[]): QuoteComparison => ({
      requestId: "r",
      productLine: "AUTO",
      results,
      cheapestEstimated: null,
      cheapestFirm: null,
      warnings: [],
      generatedAt: NOW,
    });

    assert.ok(issueZurichSnapshotToken(makeRequest(), comparison([makePrediction()]), SECRET));
    assert.equal(issueZurichSnapshotToken(makeRequest(), comparison([makePrediction({ insurerCode: "PREVOIR" })]), SECRET), null);
    assert.equal(issueZurichSnapshotToken(makeRequest(), comparison([]), SECRET), null);
    assert.equal(issueZurichSnapshotToken(makeRequest(), comparison([makePrediction()]), undefined), null);
  });
});
