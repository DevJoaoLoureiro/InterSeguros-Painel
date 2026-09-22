/*
 * Testes da calibração do simulador Zurich Auto com cotações reais (sem BD).
 *
 *   npx tsc --outDir <tmp> --module commonjs --moduleResolution node10 \
 *     --target es2022 --strict --skipLibCheck --esModuleInterop --types node \
 *     src/lib/quoting/models/zurich/calibration/__tests__/calibration.test.ts
 *   node --test <tmp>/quoting/models/zurich/calibration/__tests__/calibration.test.js
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CalibrationConfigMode, QuoteRequest } from "../../../../domain/types";
import type { CalibrationRow } from "../../../../observations/types";
import {
  MAX_HEADLINE_FACTOR,
  MAX_PRODUCTION_FACTOR,
  MIN_GLOBAL_QUOTES_FOR_PRODUCTION,
  MIN_NEAREST_QUOTES_FOR_PRODUCTION,
  MIN_SEGMENT_QUOTES_FOR_PRODUCTION,
  MIN_SIMILARITY_FOR_NEAREST,
  ZURICH_CALIBRATION_MODE,
} from "../config";
import {
  extractCalibrationTarget,
  toCalibrationObservation,
} from "../observation-features";
import { getZurichCalibration } from "../service";
import { ZURICH_CALIBRATION_VERSION } from "../version";
import {
  ageCloseness,
  calculateRealQuoteSimilarity,
  licenceCloseness,
  recencyWeight,
  usageCloseness,
  vehicleCloseness,
} from "../similarity";
import {
  applyCalibrationToEstimate,
  calibrateZurichEstimate,
  independentCount,
  summarizeObservationResiduals,
} from "../zurich-quote-calibration";

const NOW = new Date("2026-09-21T16:00:00.000Z");
const VERSION = "zurich-auto-v3";

// ---------- fixtures ----------

function makeRequest(overrides: Partial<QuoteRequest> = {}): QuoteRequest {
  return {
    requestId: "req-1",
    clientId: null,
    productLine: "AUTO",
    requestedAt: NOW.toISOString(),
    customer: {
      birthDate: "2006-01-15",
      postalCode: "4700-100",
      drivingLicenceDate: "2024-12-01",
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
      ownDamage: false,
      collision: false,
      fire: false,
      theft: false,
      glass: false,
      assistance: false,
      legalProtection: false,
      deductible: null,
    },
    paymentFrequency: "ANNUAL",
    ...overrides,
  };
}

let counter = 0;

function row(overrides: Partial<CalibrationRow> = {}): CalibrationRow {
  counter += 1;

  return {
    id: `obs-${counter}`,
    status: "VALID",
    model_version: VERSION,
    quoted_at: NOW.toISOString(),
    birth_date: "2006-01-15",
    driving_licence_date: "2024-12-01",
    postal_code: "4700-100",
    usage_type: "PRIVATE",
    coverage_tier: "RC",
    deductible: null,
    payment_frequency: "ANNUAL",
    real_product_code: "5324",
    real_product_name: "Zurich Auto",
    real_quote_basis: "ANNUAL",
    estimated_premium: 362,
    real_quote_amount: 1262.55,
    request_snapshot: {
      vehicle: {
        registration: "AB-12-CD",
        make: null,
        model: null,
        marketValue: null,
        firstRegistrationDate: null,
      },
      claims: null,
      claimsLast3Years: null,
    },
    prediction_snapshot: {},
    ...overrides,
  };
}

function calibrate(
  observations: CalibrationRow[],
  extra: { baseEstimate?: number; configMode?: CalibrationConfigMode; request?: QuoteRequest } = {},
) {
  return calibrateZurichEstimate({
    request: extra.request ?? makeRequest(),
    baseEstimate: extra.baseEstimate ?? 362,
    modelVersion: VERSION,
    observations,
    now: NOW,
    configMode: extra.configMode ?? "EXPERIMENTAL",
  });
}

/** n observações semelhantes com resíduo relativo ~ `ratio` (real = base x ratio, com ruído pequeno). */
function series(count: number, ratio: number, overrides: Partial<CalibrationRow> = {}): CalibrationRow[] {
  return Array.from({ length: count }, (_, i) =>
    row({
      estimated_premium: 360,
      real_quote_amount: 360 * ratio * (1 + ((i % 5) - 2) * 0.01),
      ...overrides,
    }),
  );
}

/**
 * n observações do MESMO segmento mas de clientes DIFERENTES: perfis ligeiramente
 * diferentes e preços reais bem distintos (`priceStep` = espaçamento relativo).
 * Contam como independentes (ao contrário de `series`, quase iguais entre si).
 */
function diverse(
  count: number,
  ratio: number,
  overrides: Partial<CalibrationRow> = {},
  priceStep = 0.03,
): CalibrationRow[] {
  const shift = (iso: string, days: number) =>
    new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);

  return Array.from({ length: count }, (_, i) =>
    row({
      estimated_premium: 360,
      real_quote_amount: 360 * ratio * (1 + (((i * 7) % 29) - 14) * priceStep),
      birth_date: shift("2006-01-15", ((i % 5) - 2) * 60),
      driving_licence_date: shift("2024-12-01", (i % 7) * 20),
      postal_code: ["4700-100", "4705-200", "4710-300"][i % 3],
      ...overrides,
    }),
  );
}

// ---------- os 15 casos ----------

describe("calibração: casos pedidos", () => {
  it("1. sem observations -> mode NONE, sampleSize 0, estimativa intacta", () => {
    const result = calibrate([]);

    assert.equal(result.mode, "NONE");
    assert.equal(result.sampleSize, 0);
    assert.equal(result.calibratedEstimate, 362);
    assert.equal(result.productionSafeEstimate, 362);
    assert.equal(result.adjustment.amount, 0);
    assert.equal(result.confidence, "LOW");
    assert.equal(result.experimental, true);
    assert.match(result.reason, /Ainda não existem cotações reais/);
  });

  it("2. duas observações semelhantes -> calibratedEstimate experimental que sobe o preço", () => {
    const result = calibrate([
      row({ estimated_premium: 364.92, real_quote_amount: 1262.55, driving_licence_date: "2025-01-01" }),
      row({ estimated_premium: 361.55, real_quote_amount: 1262.55, driving_licence_date: "2022-12-01", postal_code: "4715-100" }),
    ]);

    assert.equal(result.mode, "NEAREST_QUOTES");
    assert.equal(result.sampleSize, 2);
    assert.equal(result.experimental, true);
    assert.equal(result.confidence, "LOW");
    assert.equal(result.eligibleForProduction, false);
    assert.ok(result.calibratedEstimate > 362 * 3 && result.calibratedEstimate < 362 * 4, `${result.calibratedEstimate}`);
    assert.ok(result.adjustment.amount > 800);
    assert.ok((result.adjustment.percent as number) > 2);
    assert.equal(result.diagnostics.robustness, "NONE");
    assert.match(result.reason, /insuficiente/i);
  });

  it("3. cobertura incompatível não é usada como nearest nem como segmento", () => {
    const result = calibrate(series(6, 3, { coverage_tier: "OWN_DAMAGE" }));

    assert.notEqual(result.mode, "NEAREST_QUOTES");
    assert.notEqual(result.mode, "SEGMENT");
    assert.equal(result.diagnostics.rejected.tier, 6);
    // Só o viés global (qualquer tier) as pode usar, e nunca em produção com 6.
    assert.equal(result.mode, "GLOBAL");
    assert.equal(result.eligibleForProduction, false);
  });

  it("4. ANNUAL não mistura INSTALLMENT (nem COMMERCIAL)", () => {
    const onlyOthers = calibrate([
      row({ real_quote_basis: "INSTALLMENT" }),
      row({ real_quote_basis: "COMMERCIAL" }),
    ]);

    assert.equal(onlyOthers.mode, "NONE");
    assert.equal(onlyOthers.diagnostics.rejected.basis, 2);

    const mixed = calibrate([
      row({ real_quote_basis: "ANNUAL" }),
      row({ real_quote_basis: "INSTALLMENT", real_quote_amount: 100 }),
    ]);

    assert.equal(mixed.sampleSize, 1);
    assert.equal(mixed.diagnostics.rejected.basis, 1);
    assert.ok(mixed.calibratedEstimate > 362 * 3, "a prestação de 100 € não contaminou");
  });

  it("5. anos de carta semelhantes -> maior similaridade (e nunca datas em bruto)", () => {
    assert.ok((licenceCloseness(2, 2.5) as number) > (licenceCloseness(2, 10) as number));
    // 1 vs 3 anos pesa mais do que 21 vs 23.
    assert.ok((licenceCloseness(1, 3) as number) < (licenceCloseness(21, 23) as number));

    const target = extractCalibrationTarget(makeRequest(), NOW);
    const near = toCalibrationObservation(row({ driving_licence_date: "2024-10-01" }));
    const far = toCalibrationObservation(row({ driving_licence_date: "2010-01-01" }));

    assert.ok(near && far);
    assert.ok(
      calculateRealQuoteSimilarity(target, near).score > calculateRealQuoteSimilarity(target, far).score,
    );
  });

  it("6. idades muito diferentes -> similaridade menor", () => {
    assert.ok((ageCloseness(20, 22) as number) > 0.9);
    assert.ok((ageCloseness(20, 45) as number) < 0.05);

    const target = extractCalibrationTarget(makeRequest(), NOW);
    const young = toCalibrationObservation(row({ birth_date: "2005-11-01" }));
    const old = toCalibrationObservation(row({ birth_date: "1975-11-01" }));

    assert.ok(young && old);
    assert.ok(
      calculateRealQuoteSimilarity(target, young).score > calculateRealQuoteSimilarity(target, old).score,
    );
  });

  it("7. cotação recente pesa mais que uma antiga equivalente", () => {
    const nowMs = NOW.getTime();

    assert.ok(recencyWeight(nowMs, nowMs) > recencyWeight(nowMs - 400 * 86_400_000, nowMs));
    assert.ok(recencyWeight(nowMs - 4000 * 86_400_000, nowMs) >= 0.25, "nunca elimina brutalmente");
    assert.equal(recencyWeight(null, nowMs), 0.25, "sem data não se assume recente");

    // Mesmo perfil, resíduos opostos: a recente puxa a média mais que a antiga.
    const oldQuote = new Date(NOW.getTime() - 730 * 86_400_000).toISOString();
    const result = calibrate([
      row({ estimated_premium: 360, real_quote_amount: 720 }),
      row({ estimated_premium: 360, real_quote_amount: 360, quoted_at: oldQuote }),
    ]);

    // Com pesos iguais seria +41% (média em log); a recente empurra para mais.
    assert.ok((result.diagnostics.methods.weightedMean as number) > 0.6, `${result.diagnostics.methods.weightedMean}`);
  });

  it("8. um outlier extremo não domina o resíduo", () => {
    const inliers = diverse(9, 1.2, {}, 0.01);
    const outlier = row({ estimated_premium: 360, real_quote_amount: 3600, driving_licence_date: "2024-10-15" });
    const result = calibrate([...inliers, outlier]);

    assert.notEqual(result.diagnostics.robustness, "NONE");
    assert.ok((result.diagnostics.weightedResidual as number) < 0.35, `${result.diagnostics.weightedResidual}`);
    assert.ok((result.diagnostics.methods.weightedMean as number) > (result.diagnostics.weightedResidual as number));
    // O bruto continua visível e o "safe" nunca sobe mais de x2.
    assert.ok(result.productionSafeEstimate <= 362 * MAX_PRODUCTION_FACTOR + 0.01);
  });

  it("9. status TEST é ignorado", () => {
    const result = calibrate([row({ status: "TEST" })]);

    assert.equal(result.mode, "NONE");
    assert.equal(result.diagnostics.totalValidObservations, 0);
  });

  it("10. status DUPLICATE (e INVALID, INCOMPLETE, EXPIRED, MANUAL_OVERRIDE) é ignorado", () => {
    for (const status of ["DUPLICATE", "INVALID", "INCOMPLETE", "EXPIRED", "MANUAL_OVERRIDE"] as const) {
      const result = calibrate([row({ status })]);

      assert.equal(result.mode, "NONE", status);
      assert.equal(result.sampleSize, 0, status);
    }
  });

  it("11. status VALID é elegível", () => {
    const result = calibrate([row({ status: "VALID" })]);

    assert.notEqual(result.mode, "NONE");
    assert.equal(result.sampleSize, 1);
    assert.equal(result.diagnostics.totalValidObservations, 1);
  });

  it("12. valores em falta não viram 0", () => {
    const target = extractCalibrationTarget(
      makeRequest({ customer: { birthDate: null, postalCode: null, drivingLicenceDate: null, usage: "PRIVATE" } }),
      NOW,
    );

    assert.equal(target.ageYears, null);
    assert.equal(target.licenceYears, null);
    assert.equal(target.postal, null);
    assert.equal(target.claims3Y, null);
    assert.equal(target.deductible, null);
    assert.equal(target.vehicle.marketValue, null);

    const observation = toCalibrationObservation(row({ birth_date: null, driving_licence_date: null, request_snapshot: {} }));

    assert.ok(observation);
    assert.equal(observation.ageYears, null);
    assert.equal(observation.licenceYears, null);
    assert.equal(observation.claims3Y, null);
    assert.equal(observation.deductible, null);

    // Desconhecido nos dois lados: sem contribuição (não 0) e o score não colapsa.
    const complete = extractCalibrationTarget(makeRequest(), NOW);
    const similarity = calculateRealQuoteSimilarity(complete, observation);

    assert.equal(similarity.contributions.age.closeness, null);
    assert.equal(similarity.contributions.licenceYears.closeness, null);
    assert.ok(similarity.score > 0 && similarity.missingPenalty > 0);
    assert.equal(ageCloseness(null, 30), null);
    assert.equal(vehicleCloseness(complete.vehicle, observation.vehicle), null);
  });

  it("13. amostra abaixo do threshold -> experimental true, não elegível", () => {
    const result = calibrate(series(MIN_NEAREST_QUOTES_FOR_PRODUCTION - 1, 1.2));

    assert.equal(result.experimental, true);
    assert.equal(result.eligibleForProduction, false);
    assert.equal(result.applied, false);
    assert.equal(result.diagnostics.requiredForProduction, MIN_NEAREST_QUOTES_FOR_PRODUCTION);
    assert.match(result.reason, /Amostra insuficiente/);
  });

  it("14. o pointEstimate oficial permanece igual em modo experimental", () => {
    const calibration = calibrate(diverse(25, 1.2), { configMode: "EXPERIMENTAL" });

    assert.equal(calibration.eligibleForProduction, true, "amostra suficiente...");
    assert.equal(calibration.applied, false, "...mas em EXPERIMENTAL nunca se aplica");
    assert.equal(calibration.experimental, true);

    const estimate = { pointEstimate: 362, priceRange: { min: 255, max: 538 } };
    const result = applyCalibrationToEstimate(estimate, calibration);

    assert.equal(result.applied, false);
    assert.deepEqual({ pointEstimate: result.pointEstimate, priceRange: result.priceRange }, estimate);
    assert.equal(calibration.baseEstimate, 362);
  });

  it("15. o calibratedEstimate aparece separadamente da estimativa base", () => {
    const calibration = calibrate(series(3, 2));

    assert.equal(calibration.baseEstimate, 362);
    assert.ok(calibration.calibratedEstimate > 700);
    assert.notEqual(calibration.calibratedEstimate, calibration.baseEstimate);
    assert.equal(
      calibration.adjustment.amount,
      Math.round((calibration.calibratedEstimate - calibration.baseEstimate) * 100) / 100,
    );
  });
});

// ---------- observações redundantes, modos e versão ----------

describe("observações redundantes e amostra efetiva", () => {
  it("6. duas observações iguais: contagem bruta 2, amostra efetiva ≈ 1", () => {
    const twin = { estimated_premium: 362, real_quote_amount: 1262.55 };
    const result = calibrate([row(twin), row(twin)]);

    assert.equal(result.sampleSize, 2);
    assert.ok((result.effectiveSampleSize as number) < 1.05, `${result.effectiveSampleSize}`);
    assert.ok((result.diagnostics.independentObservations as number) < 1.05);
    assert.match(result.reason, /praticamente iguais/);
    // Não se apaga nenhuma: as duas continuam a contar como observações.
    assert.equal(result.diagnostics.consideredObservations, 2);
  });

  it("as 2 cotações reais atuais (mesmo preço, carta e região ligeiramente diferentes) valem quase como uma", () => {
    const result = calibrate([
      row({ estimated_premium: 364.92, real_quote_amount: 1262.55, driving_licence_date: "2025-01-01" }),
      row({ estimated_premium: 361.55, real_quote_amount: 1262.55, driving_licence_date: "2022-12-01", postal_code: "4715-100" }),
    ]);

    assert.equal(result.sampleSize, 2);
    assert.ok((result.effectiveSampleSize as number) < 1.4, `${result.effectiveSampleSize}`);
  });

  it("clientes parecidos com preços reais diferentes SÃO independentes", () => {
    const result = calibrate(diverse(4, 1.2, {}, 0.06));

    assert.ok((result.effectiveSampleSize as number) > 2.5, `${result.effectiveSampleSize}`);
  });

  it("os mínimos de produção contam observações independentes, não linhas", () => {
    // 30 linhas do mesmo perfil e preço: uma evidência, por muitas linhas que haja.
    const clones = Array.from({ length: 30 }, () => row({ estimated_premium: 362, real_quote_amount: 1262.55 }));
    const result = calibrate(clones, { configMode: "PRODUCTION" });

    assert.equal(result.sampleSize > 5, true);
    assert.ok((result.diagnostics.independentProductionObservations as number) < 2);
    assert.equal(result.eligibleForProduction, false);
    assert.equal(result.applied, false);
  });

  it("tiers diferentes nunca são redundantes entre si", () => {
    const rc = toCalibrationObservation(row({ coverage_tier: "RC" }));
    const own = toCalibrationObservation(row({ coverage_tier: "OWN_DAMAGE" }));

    assert.ok(rc && own);
    assert.equal(independentCount([rc, own]), 2);
  });
});

describe("valor principal apresentado: «Calibração com cotações reais»", () => {
  const twoReal = () => [
    row({ estimated_premium: 364.92, real_quote_amount: 1262.55, driving_licence_date: "2025-01-01" }),
    row({ estimated_premium: 361.55, real_quote_amount: 1262.55, driving_licence_date: "2022-12-01", postal_code: "4715-100" }),
  ];

  it("com cotações reais do mesmo tipo de cobertura o valor calibrado é o valor em grande", () => {
    const calibration = calibrate(twoReal());

    assert.equal(calibration.mode, "NEAREST_QUOTES");
    assert.notEqual(calibration.headlineEstimate, null);
    assert.equal(calibration.headlineEstimate, calibration.calibratedEstimate, "sem encolhimento");
    assert.ok((calibration.headlineEstimate as number) > 1200 && (calibration.headlineEstimate as number) < 1300);
  });

  it("é só apresentação: o pointEstimate e a base ficam intactos, e continua experimental", () => {
    const calibration = calibrate(twoReal());
    const result = applyCalibrationToEstimate({ pointEstimate: 362, priceRange: { min: 255, max: 538 } }, calibration);

    assert.equal(calibration.applied, false);
    assert.equal(calibration.experimental, true);
    assert.equal(calibration.baseEstimate, 362);
    assert.equal(result.pointEstimate, 362);
    assert.match(calibration.reason, /valor principal/);
  });

  it("o viés GLOBAL (outro tipo de cobertura) nunca é o valor em grande", () => {
    const calibration = calibrate(diverse(30, 3, { coverage_tier: "OWN_DAMAGE" }));

    assert.equal(calibration.mode, "GLOBAL");
    assert.equal(calibration.headlineEstimate, null);
    assert.match(calibration.reason, /viés global/);
  });

  it("sem cotações reais não há valor em grande (mostra-se a estimativa histórica)", () => {
    assert.equal(calibrate([]).headlineEstimate, null);
    assert.equal(calibrate([], { configMode: "DISABLED" }).headlineEstimate, null);
  });

  it("um valor absurdo é limitado a x6 no valor em grande; o bruto continua visível", () => {
    const calibration = calibrate(diverse(6, 25, {}, 0.01));

    assert.ok(Math.abs((calibration.headlineEstimate as number) - 362 * MAX_HEADLINE_FACTOR) < 0.01);
    assert.ok(calibration.calibratedEstimate > (calibration.headlineEstimate as number));
    assert.match(calibration.reason, /limitado a x6/);
  });

  it("a estimativa em grande desce se as cotações reais forem mais baixas que o modelo", () => {
    const calibration = calibrate(diverse(4, 0.7, {}, 0.02));

    assert.ok((calibration.headlineEstimate as number) < 362);
  });

  it("em PRODUCTION aplicada o valor já está no pointEstimate (sem valor em grande à parte)", () => {
    const calibration = calibrate(diverse(25, 1.2), { configMode: "PRODUCTION" });

    assert.equal(calibration.applied, true);
    assert.equal(calibration.headlineEstimate, null);
  });
});

describe("modos: EXPERIMENTAL e PRODUCTION", () => {
  it("9. o modo por omissão é EXPERIMENTAL e o pointEstimate principal fica na base", () => {
    assert.equal(ZURICH_CALIBRATION_MODE, "EXPERIMENTAL");

    const calibration = calibrateZurichEstimate({
      request: makeRequest(),
      baseEstimate: 362,
      baseRange: { min: 255, max: 538 },
      modelVersion: VERSION,
      observations: diverse(25, 1.2),
      now: NOW,
    });

    assert.equal(calibration.configMode, "EXPERIMENTAL");
    assert.equal(calibration.applied, false);
    assert.equal(calibration.version, ZURICH_CALIBRATION_VERSION);
    assert.deepEqual(calibration.baseRange, { min: 255, max: 538 });

    const result = applyCalibrationToEstimate({ pointEstimate: 362, priceRange: { min: 255, max: 538 } }, calibration);

    assert.equal(result.pointEstimate, 362);
    assert.notEqual(calibration.calibratedEstimate, 362, "o calibrado aparece à parte");
  });

  it("2 cotações reais em EXPERIMENTAL: valor calibrado visível, confiança baixa, nada aplicado", () => {
    const calibration = calibrate([
      row({ estimated_premium: 364.92, real_quote_amount: 1262.55, driving_licence_date: "2025-01-01" }),
      row({ estimated_premium: 361.55, real_quote_amount: 1262.55, driving_licence_date: "2022-12-01", postal_code: "4715-100" }),
    ]);

    assert.equal(calibration.applied, false);
    assert.equal(calibration.experimental, true);
    assert.equal(calibration.confidence, "LOW");
    assert.ok(calibration.calibratedEstimate > 1000);
    assert.match(calibration.reason, /insuficiente para produção/);
  });

  it("10. PRODUCTION só altera o resultado quando os thresholds são atingidos", () => {
    const below = calibrate(diverse(3, 1.2, {}, 0.06), { configMode: "PRODUCTION" });

    assert.equal(below.applied, false);
    assert.equal(
      applyCalibrationToEstimate({ pointEstimate: 362, priceRange: { min: 255, max: 538 } }, below).pointEstimate,
      362,
    );

    const enough = calibrate(diverse(25, 1.2), { configMode: "PRODUCTION" });

    assert.equal(enough.applied, true);
    assert.equal(enough.experimental, false);

    const applied = applyCalibrationToEstimate({ pointEstimate: 362, priceRange: { min: 255, max: 538 } }, enough);

    assert.equal(applied.applied, true);
    assert.equal(applied.pointEstimate, enough.productionSafeEstimate);
    assert.equal(enough.baseEstimate, 362, "a base fica sempre registada");
  });

  it("8. cotações RC não calibram um pedido de danos próprios", () => {
    const ownRequest = makeRequest();

    ownRequest.requestedCoverages = { ...ownRequest.requestedCoverages, ownDamage: true, collision: true, deductible: 500 };

    const calibration = calibrate(diverse(25, 3, { coverage_tier: "RC" }), { request: ownRequest, configMode: "PRODUCTION" });

    assert.notEqual(calibration.mode, "NEAREST_QUOTES");
    assert.notEqual(calibration.mode, "SEGMENT");
    assert.equal(calibration.applied, false);
    assert.equal(calibration.diagnostics.rejected.tier, 25);

    const result = applyCalibrationToEstimate({ pointEstimate: 815, priceRange: { min: 525, max: 1097 } }, calibration);

    assert.equal(result.pointEstimate, 815, "fallback para a estimativa histórica");
  });

  it("a versão da calibração é independente da do modelo base", () => {
    const calibration = calibrate([row()]);

    assert.equal(calibration.version, "zurich-calibration-v1");
    assert.equal(calibration.modelVersion, VERSION);
    assert.notEqual(calibration.version, calibration.modelVersion);
  });
});

// ---------- comportamento por dimensão da amostra ----------

describe("calibração: 0, 2 e 20+ observações", () => {
  it("20+ observações independentes: elegível, confiança >= MEDIUM, e só se aplica em PRODUCTION", () => {
    const observations = diverse(25, 1.2);

    const experimental = calibrate(observations, { configMode: "EXPERIMENTAL" });
    const production = calibrate(observations, { configMode: "PRODUCTION" });

    assert.equal(experimental.mode, "NEAREST_QUOTES");
    assert.notEqual(experimental.confidence, "LOW");
    assert.equal(experimental.eligibleForProduction, true);
    assert.equal(experimental.applied, false);

    assert.equal(production.applied, true);
    assert.equal(production.experimental, false);

    // Encolhimento por n/(n+K): a correção "safe" é menor que a bruta.
    assert.ok(production.productionSafeEstimate < production.calibratedEstimate);
    assert.ok(production.productionSafeEstimate > production.baseEstimate);

    const applied = applyCalibrationToEstimate({ pointEstimate: 362, priceRange: { min: 255, max: 538 } }, production);

    assert.equal(applied.applied, true);
    assert.equal(applied.pointEstimate, production.productionSafeEstimate);
    assert.ok(applied.priceRange.min < applied.pointEstimate && applied.pointEstimate < applied.priceRange.max);
  });

  it("segmento e global entram por ordem quando as vizinhas não chegam", () => {
    // Mesmo segmento (tier, idade a <= 10 anos, faixa de carta, uso) mas pouco parecidas
    // (outro produto, outra região, outro fracionamento): não são "vizinhas".
    const request = makeRequest();

    request.metadata = { productCode: "5324" };

    const segmentRows = diverse(MIN_SEGMENT_QUOTES_FOR_PRODUCTION * 2, 1.3, {
      birth_date: "1996-06-01",
      real_product_code: "5907",
      real_product_name: "Zurich Auto Empresas",
      postal_code: "1000-100",
      payment_frequency: "MONTHLY",
    }, 0.03);

    const probe = toCalibrationObservation(segmentRows[0]);

    assert.ok(probe);
    assert.ok(
      calculateRealQuoteSimilarity(extractCalibrationTarget(request, NOW), probe).score < MIN_SIMILARITY_FOR_NEAREST,
      "precondição: não são vizinhas",
    );

    const result = calibrate(segmentRows, { request });

    assert.equal(result.mode, "SEGMENT");
    assert.equal(result.eligibleForProduction, true);

    const global = calibrate(diverse(MIN_GLOBAL_QUOTES_FOR_PRODUCTION + 5, 1.3, { coverage_tier: "OWN_DAMAGE" }, 0.04));

    assert.equal(global.mode, "GLOBAL");
    assert.equal(global.productionSampleSize, MIN_GLOBAL_QUOTES_FOR_PRODUCTION + 5);
  });

  it("base UNKNOWN só serve no experimental e nunca conta para produção", () => {
    const result = calibrate(diverse(25, 1.2, { real_quote_basis: "UNKNOWN" }), { configMode: "PRODUCTION" });

    assert.equal(result.sampleSize > 0, true);
    assert.equal(result.productionSampleSize, 0);
    assert.equal(result.diagnostics.independentProductionObservations, 0);
    assert.equal(result.eligibleForProduction, false);
    assert.equal(result.applied, false);
    assert.match(result.reason, /UNKNOWN/);
  });

  it("outra versão do modelo é rejeitada (o resíduo é contra a estimativa desse modelo)", () => {
    const result = calibrate([row({ model_version: "zurich-auto-v2" })]);

    assert.equal(result.mode, "NONE");
    assert.equal(result.diagnostics.rejected.modelVersion, 1);
  });

  it("o resíduo mede-se contra a estimativa BASE quando o snapshot a guarda", () => {
    // pointEstimate final 500 (já calibrado), mas a base era 362.
    const withBase = row({
      estimated_premium: 500,
      real_quote_amount: 1000,
      prediction_snapshot: { calibration: { baseEstimate: 362 } },
    });
    const result = calibrate([withBase]);

    assert.ok(Math.abs((result.diagnostics.weightedResidual as number) - (1000 / 362 - 1)) < 1e-9);
  });

  it("correções absurdas: o bruto fica visível, o 'safe' é limitado a x2", () => {
    const result = calibrate(diverse(30, 8));

    assert.ok(result.calibratedEstimate > 362 * 6, "bruto sem limite");
    assert.ok(result.productionSafeEstimate <= 362 * MAX_PRODUCTION_FACTOR + 0.01);
    assert.equal(result.clamped, true);
  });

  it("DISABLED não calcula; base inválida não calibra", () => {
    assert.equal(calibrate(series(10, 2), { configMode: "DISABLED" }).mode, "NONE");
    assert.equal(calibrate(series(10, 2), { baseEstimate: 0 }).mode, "NONE");
    assert.equal(calibrate(series(10, 2), { baseEstimate: Number.NaN }).mode, "NONE");
  });
});

// ---------- features e similaridade ----------

describe("similaridade entre cotações reais", () => {
  it("usa veículo só quando existe nos dois lados (arquitetura pronta, sem exigir)", () => {
    const vehicle = { marketValue: 20000, make: "Peugeot", fuelType: "Diesel", powerKw: 80, engineCc: 1500, firstRegistrationYear: 2018 };
    const empty = { marketValue: null, make: null, fuelType: null, powerKw: null, engineCc: null, firstRegistrationYear: null };

    assert.equal(vehicleCloseness(vehicle, empty), null);
    assert.equal(vehicleCloseness(vehicle, vehicle), 1);
    assert.ok((vehicleCloseness(vehicle, { ...vehicle, make: "BMW", marketValue: 60000 }) as number) < 0.75);

    const request = makeRequest();

    request.vehicle = { ...request.vehicle!, make: "Peugeot", marketValue: 20000 };

    const target = extractCalibrationTarget(request, NOW);
    const same = toCalibrationObservation(row({ request_snapshot: { vehicle: { make: "Peugeot", marketValue: 20000 } } }));
    const other = toCalibrationObservation(row({ request_snapshot: { vehicle: { make: "BMW", marketValue: 80000 } } }));

    assert.ok(same && other);
    assert.ok(calculateRealQuoteSimilarity(target, same).score > calculateRealQuoteSimilarity(target, other).score);
  });

  it("uso TVDE/táxi não se aproxima de outros usos; produto e franquia contam", () => {
    assert.equal(usageCloseness("PRIVATE", "PRIVATE"), 1);
    assert.equal(usageCloseness("PRIVATE", "TVDE"), 0);
    assert.equal(usageCloseness("PRIVATE", null), null);

    const request = makeRequest();

    request.requestedCoverages = { ...request.requestedCoverages, ownDamage: true, collision: true, deductible: 500 };
    request.metadata = { productCode: "5324" };

    const target = extractCalibrationTarget(request, NOW);
    const match = toCalibrationObservation(row({ coverage_tier: "OWN_DAMAGE", deductible: 500 }));
    const different = toCalibrationObservation(row({ coverage_tier: "OWN_DAMAGE", deductible: 1500, real_product_code: "5907" }));

    assert.ok(match && different);
    assert.equal(target.tier, "OWN_DAMAGE");
    assert.ok(calculateRealQuoteSimilarity(target, match).score > calculateRealQuoteSimilarity(target, different).score);
  });

  it("idade e anos de carta calculam-se NA DATA DA COTAÇÃO, não hoje", () => {
    const observation = toCalibrationObservation(
      row({ quoted_at: "2025-06-01T00:00:00.000Z", birth_date: "2005-06-01", driving_licence_date: "2024-06-01" }),
    );

    assert.ok(observation);
    assert.ok(Math.abs((observation.ageYears as number) - 20) < 0.05);
    assert.ok(Math.abs((observation.licenceYears as number) - 1) < 0.05);
  });

  it("não usa NIF, client_id, policy_id nem matrícula como feature", () => {
    const target = extractCalibrationTarget(makeRequest(), NOW);
    const observation = toCalibrationObservation(row());

    assert.ok(observation);

    const keys = JSON.stringify([Object.keys(target), Object.keys(observation)]);

    for (const forbidden of ["nif", "client", "policy", "registration", "plate"]) {
      assert.ok(!keys.toLowerCase().includes(forbidden), forbidden);
    }
  });
});

// ---------- serviço e diagnóstico ----------

describe("serviço de calibração e diagnóstico", () => {
  it("lê a BD uma vez; DISABLED não lê; falha da BD devolve NONE sem lançar", async () => {
    let reads = 0;
    const store = {
      async listForCalibration() {
        reads += 1;

        return series(3, 2);
      },
    };
    const params = { request: makeRequest(), baseEstimate: 362, modelVersion: VERSION, now: NOW };

    const ok = await getZurichCalibration({ ...params, store });

    assert.equal(reads, 1);
    assert.equal(ok.sampleSize, 3);

    await getZurichCalibration({ ...params, store, configMode: "DISABLED" });

    assert.equal(reads, 1, "DISABLED não lê a tabela");

    const failing = await getZurichCalibration({
      ...params,
      store: {
        async listForCalibration() {
          throw new Error("falha simulada com dados pessoais");
        },
      },
    });

    assert.equal(failing.mode, "NONE");
    assert.equal(failing.baseEstimate, 362);
    assert.ok(!failing.reason.includes("pessoais"));
  });

  it("resumo global dos resíduos: viés, mediana, MAE e distribuição", () => {
    const summary = summarizeObservationResiduals(
      [
        row({ estimated_premium: 300, real_quote_amount: 400 }),
        row({ estimated_premium: 300, real_quote_amount: 500 }),
        row({ estimated_premium: 300, real_quote_amount: 200 }),
        row({ estimated_premium: 300, real_quote_amount: 600, real_quote_basis: "INSTALLMENT" }),
        row({ status: "TEST" }),
      ],
      VERSION,
    );

    assert.equal(summary.totalValidObservations, 4);
    assert.equal(summary.eligibleObservations, 3);
    assert.equal(summary.rejected.basis, 1);
    // resíduos em euros: +100, +200, -100
    assert.ok(Math.abs((summary.globalBias as number) - 200 / 3) < 1e-9);
    assert.equal(summary.medianResidual, 100);
    assert.ok(Math.abs((summary.meanAbsoluteError as number) - 133.333333) < 1e-4);
    assert.ok(summary.residualPercentiles);
    assert.deepEqual(summary.byBasis, { ANNUAL: 3 });
    assert.equal(summarizeObservationResiduals([row()], VERSION).residualPercentiles, null);
  });
});
