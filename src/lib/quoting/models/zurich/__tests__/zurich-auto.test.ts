/*
 * Testes do estimador histórico Zurich Auto (partes puras: sem BD nem rede).
 *
 * O projeto não tem runner de testes; usam-se node:test + assert. Como os
 * imports do código não levam extensão, compila-se primeiro e corre-se o JS:
 *
 *   npx tsc --outDir <tmp> --module commonjs --moduleResolution node10 \
 *     --target es2022 --strict --skipLibCheck --esModuleInterop --types node \
 *     src/lib/quoting/models/zurich/__tests__/zurich-auto.test.ts
 *   node --test <tmp>/quoting/models/zurich/__tests__/zurich-auto.test.js
 *
 * Os dados são sintéticos (gerados com um modelo de preço conhecido) e
 * fixtures anonimizadas com as descrições REAIS das coberturas Zurich.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { QuoteRequest } from "../../../domain/types";
import { calculateSafetyBuffer } from "../../../confidence/safety-buffer";
import {
  assessEstimate,
  buildCalibration,
  calculateConfidence,
  calculateUncertainty,
  runLeaveOneOut,
} from "../zurich-auto-confidence";
import {
  buildCoverageProfile,
  classifyCoverage,
  deriveCoverageTier,
  tierFromRequestedCoverages,
} from "../zurich-auto-coverages";
import {
  DEFAULT_ESTIMATOR_CONFIG,
  estimatePremium,
  selectComparables,
} from "../zurich-auto-estimator";
import {
  buildConsideredFactors,
  buildInputUsage,
  describeAssessment,
  describeIgnoredRequestData,
} from "../zurich-auto-explain";
import {
  extractRequestFeatures,
  extractVehicleMake,
  extractZurichHistoricalFeatures,
  isEligibleHistorical,
  readFiniteNumber,
  requestFeaturesFromHistorical,
  type HistoricalPolicyInput,
  type RequestFeatures,
  type ZurichHistoricalFeatures,
} from "../zurich-auto-features";
import {
  ageCloseness,
  calculateSimilarity,
  capitalCloseness,
  deductibleCloseness,
  postalCloseness,
  tierCloseness,
} from "../zurich-auto-similarity";
import {
  resolveHistoricalTarget,
  type TargetReceipt,
} from "../zurich-auto-target";
import {
  computeMetrics,
  conformalQuantile,
  crossValidateSelection,
  groupKFolds,
  leaveOneGroupOut,
  residualInterval,
  seededRandom,
} from "../zurich-auto-validation";
import {
  effectiveSampleSize,
  trimmedWeightedMean,
  weightedGeometricMean,
  weightedMean,
  weightedMedian,
  winsorizedWeightedMean,
} from "../weighted-stats";

const NOW = new Date("2026-09-21T12:00:00Z");
const config = DEFAULT_ESTIMATOR_CONFIG;

// ---------- geradores ----------

type Spec = {
  premium: number;
  age?: number | null;
  postal?: string;
  ownDamage?: boolean;
  capital?: number;
  deductible?: number;
  glass?: boolean;
  theft?: boolean;
  frequency?: string;
  productCode?: string;
  status?: string;
  startDate?: string;
  extraCoverages?: { description: string; capital?: number }[];
  vehicles?: number;
  receipts?: TargetReceipt[] | "confirm" | "none";
  groupKey?: string | null;
};

function birthDateFor(age: number): string {
  return `${NOW.getFullYear() - age}-01-01`;
}

function policyInput(index: number, spec: Spec): HistoricalPolicyInput {
  const coverages: Record<string, unknown>[] = [
    { objectNumber: "1", description: "Responsabilidade Civil", capital: 7750000 },
    { objectNumber: "1", description: "Limite Danos Corporais, por Acidente", capital: 6450000 },
    { objectNumber: "1", description: "Defesa e Proteção Jurídica", capital: "0" },
  ];

  if (spec.glass ?? true) {
    coverages.push({ objectNumber: "1", description: "Quebra de Vidros", capital: 0 });
  }

  if (spec.ownDamage) {
    coverages.push({
      objectNumber: "1",
      description: "Zurich-Choque Colisão Cap.Inc.Raio Explo",
      capital: spec.capital ?? 20000,
      deductibleValue: spec.deductible ?? null,
    });
    coverages.push({ objectNumber: "1", description: "Furto ou Roubo", capital: spec.capital ?? 20000 });
  } else if (spec.theft) {
    coverages.push({ objectNumber: "1", description: "Furto ou Roubo", capital: 12000 });
  }

  for (const extra of spec.extraCoverages ?? []) {
    coverages.push({ objectNumber: "1", description: extra.description, capital: extra.capital ?? 0 });
  }

  const vehicles = Array.from({ length: spec.vehicles ?? 1 }, (_, i) => ({
    number: String(i + 1),
    type: "Viatura",
    status: "Em vigor",
    description: `AA-${String(index % 100).padStart(2, "0")}-BB Peugeot 308`,
    capital: 7750000,
  }));

  const frequency = spec.frequency ?? "ANNUAL";
  const perYear = { ANNUAL: 1, SEMIANNUAL: 2, QUARTERLY: 4, MONTHLY: 12 }[frequency] ?? 1;

  const receipts: TargetReceipt[] =
    spec.receipts === "none"
      ? []
      : Array.isArray(spec.receipts)
        ? spec.receipts
        : [
            {
              type: "Novo",
              status: "PAID",
              periodStart: "2026-01-01",
              periodEnd: new Date(Date.parse("2026-01-01") + (365 / perYear) * 86_400_000)
                .toISOString()
                .slice(0, 10),
              totalPremium: spec.premium / perYear,
            },
          ];

  return {
    id: `p${String(index).padStart(4, "0")}`,
    groupKey: spec.groupKey === undefined ? `c${index}` : spec.groupKey,
    productCode: spec.productCode ?? "5324",
    productName: "Zurich Auto",
    status: spec.status ?? "ACTIVE",
    startDate: spec.startDate ?? "2026-03-01",
    annualizedPremium: spec.premium,
    totalPremium: spec.premium,
    paymentFrequency: frequency,
    lastSyncedAt: "2026-09-20T12:00:00Z",
    providerMetadata: {
      vehicleRegistration: "AA-00-BB",
      insuredObject: vehicles[0],
      insuredObjects: vehicles,
      coverages,
    },
    holderBirthDate: spec.age === null ? null : birthDateFor(spec.age ?? 40),
    holderPostalCode: spec.postal ?? "4700-123",
    receipts,
  };
}

function policy(index: number, spec: Spec): ZurichHistoricalFeatures {
  return extractZurichHistoricalFeatures(policyInput(index, spec), NOW);
}

function request(overrides: Partial<RequestFeatures> = {}): RequestFeatures {
  return {
    driverAge: 40,
    postalPrefix: "4700",
    productCode: null,
    productFamily: null,
    coverageTier: "RC",
    wantsGlass: true,
    vehicleValue: null,
    deductible: null,
    ...overrides,
  };
}

/**
 * Carteira sintética com estrutura de preço CONHECIDA:
 *   prémio = 280 x (danos próprios ? 2.2 : 1) x exp(-0.012 (idade-40))
 *            x (capital/25000)^0.35 [só danos próprios]
 *            x (franquia: 250 -> 1.15, 500 -> 1.0, 750 -> 0.92, 1000 -> 0.85)
 * com ruído multiplicativo determinístico de ±6%.
 */
function syntheticPortfolio(size = 400): ZurichHistoricalFeatures[] {
  const random = seededRandom(42);
  const deductibles = [250, 500, 750, 1000];
  const deductibleFactor: Record<number, number> = { 250: 1.15, 500: 1, 750: 0.92, 1000: 0.85 };
  const postals = ["4700-100", "4705-200", "4710-300", "4800-400", "1000-100"];

  return Array.from({ length: size }, (_, index) => {
    const own = index % 2 === 0;
    const age = 20 + Math.floor(random() * 50);
    const capital = 8000 + Math.floor(random() * 45000);
    const deductible = deductibles[Math.floor(random() * 4)];
    const noise = 0.94 + random() * 0.12;

    const premium =
      280 *
      (own ? 2.2 : 1) *
      Math.exp(-0.012 * (age - 40)) *
      (own ? Math.pow(capital / 25000, 0.35) * deductibleFactor[deductible] : 1) *
      noise;

    return policy(index, {
      premium,
      age,
      postal: postals[Math.floor(random() * postals.length)],
      ownDamage: own,
      capital,
      deductible,
    });
  });
}

const PORTFOLIO = syntheticPortfolio();
const CALIBRATION = buildCalibration(
  runLeaveOneOut(PORTFOLIO, config, requestFeaturesFromHistorical),
);

function assess(
  target: RequestFeatures,
  pool = PORTFOLIO,
  estimatorConfig = config,
) {
  const result = assessEstimate(target, pool, estimatorConfig, CALIBRATION, NOW);

  assert.ok(result, "deveria ser possível estimar");

  return result;
}

// ---------- coberturas reais ----------

describe("classifyCoverage (descrições reais Zurich)", () => {
  const cases: [string, string | null][] = [
    ["Responsabilidade Civil", "LIABILITY"],
    ["Responsabilidad Civil Seguro Facultativo", "LIABILITY"],
    ["Limite Danos Corporais, por Acidente", "LIABILITY_LIMIT"],
    ["Limite Danos Materiais, por Acidente", "LIABILITY_LIMIT"],
    ["Defesa e Proteção Jurídica", "LEGAL_PROTECTION"],
    ["Assistência Viagem", "TRAVEL_ASSISTANCE"],
    ["Assistência Viagem até 3500Kg", "TRAVEL_ASSISTANCE"],
    ["Assistência Viagem Veículos de 2 Rodas", "TRAVEL_ASSISTANCE"],
    ["Assistência em Viagem Essencial", "TRAVEL_ASSISTANCE"],
    ["Despesas de Tratamento e Repatriamento", "MEDICAL_EXPENSES"],
    ["Despesas Tratamen/Repatriamento-Condutor", "MEDICAL_EXPENSES"],
    ["Morte ou Invalidez Permanente - Condutor", "PERSONAL_ACCIDENT"],
    ["Incapacidade Temporária", "PERSONAL_ACCIDENT"],
    ["Despesas de Funeral", "PERSONAL_ACCIDENT"],
    ["Quebra de Vidros", "GLASS"],
    ["Quebra de Vidros Essencial", "GLASS"],
    ["Quebra Vidros - Vidro Fabricante Veículo", "GLASS"],
    ["Zurich-Choque Colisão Cap.Inc.Raio Explo", "OWN_DAMAGE"],
    ["Choque,Colisão,Capot,Incên,Raio Explosão", "OWN_DAMAGE"],
    ["Furto ou Roubo", "THEFT"],
    ["Incêndio, Raio ou Explosão", "FIRE"],
    ["Riscos Catastróficos da Natureza", "NATURAL_PERILS"],
    ["Riscos Catastróficos Natureza", "NATURAL_PERILS"],
    ["Greves,Tumultos,Alterações Ordem Pública", "STRIKES"],
    ["Atos Terrorismo, Vandalismo, Sabotagem", "TERRORISM"],
    ["Veíc.Substituição Sinistro Equivalente", "REPLACEMENT_VEHICLE"],
    ["Adaptação de Veículo e/ou de Residência", "ADAPTATION"],
    ["Cobertura inventada", null],
    ["  ", null],
  ];

  for (const [description, kind] of cases) {
    it(`${JSON.stringify(description)} -> ${kind}`, () => {
      assert.equal(classifyCoverage(description).kind, kind);
    });
  }

  it("variantes de vidros, RC facultativa e classe de veículo", () => {
    assert.equal(classifyCoverage("Quebra de Vidros Essencial").glassVariant, "ESSENTIAL");
    assert.equal(classifyCoverage("Quebra Vidros - Vidro Fabricante Veículo").glassVariant, "MANUFACTURER");
    assert.equal(classifyCoverage("Quebra de Vidros").glassVariant, "STANDARD");
    assert.equal(classifyCoverage("Responsabilidad Civil Seguro Facultativo").optionalLiability, true);
    assert.equal(classifyCoverage("Assistência Viagem Veículos de 2 Rodas").vehicleClassHint, "TWO_WHEELER");
    assert.equal(classifyCoverage("Assistência Viagem até 3500Kg").vehicleClassHint, "LIGHT_COMMERCIAL");
    assert.equal(classifyCoverage("Assistência Viagem").vehicleClassHint, null);
  });

  it("não é difuso: 'Vidrosa' não é vidros e texto parcial não passa", () => {
    assert.equal(classifyCoverage("Vidrosa").kind, null);
    assert.equal(classifyCoverage("Civil").kind, null);
  });
});

describe("perfil e tier de cobertura", () => {
  const entry = (description: string, capital: number | null = null, deductibleValue: number | null = null) => ({
    objectNumber: "1",
    description,
    capital,
    deductibleValue,
  });

  it("RC / RC_PLUS / OWN_DAMAGE só com evidência real", () => {
    const rc = buildCoverageProfile([entry("Responsabilidade Civil"), entry("Quebra de Vidros")]);
    const plus = buildCoverageProfile([entry("Responsabilidade Civil"), entry("Furto ou Roubo"), entry("Incêndio, Raio ou Explosão")]);
    const own = buildCoverageProfile([entry("Responsabilidade Civil"), entry("Zurich-Choque Colisão Cap.Inc.Raio Explo", 22000, 500)]);

    assert.equal(deriveCoverageTier(rc), "RC");
    assert.equal(deriveCoverageTier(plus), "RC_PLUS");
    assert.equal(deriveCoverageTier(own), "OWN_DAMAGE");
    assert.equal(own.ownDamageCapital, 22000);
    assert.equal(own.ownDamageDeductible, 500);
  });

  it("sem Responsabilidade Civil o perfil é desconhecido (nunca 'ausente')", () => {
    const profile = buildCoverageProfile([entry("Quebra de Vidros")]);

    assert.equal(profile.hasRC, null);
    assert.equal(profile.hasGlass, null);
    assert.equal(deriveCoverageTier(profile), "UNKNOWN");
    assert.equal(deriveCoverageTier(buildCoverageProfile([])), "UNKNOWN");
  });

  it("franquia 0 e capital 0 são 'não informado', nunca valores", () => {
    const profile = buildCoverageProfile([
      entry("Responsabilidade Civil", 7750000, 0),
      entry("Zurich-Choque Colisão Cap.Inc.Raio Explo", 0, 0),
      entry("Quebra de Vidros", 0, 0),
    ]);

    assert.equal(profile.ownDamageCapital, null);
    assert.equal(profile.ownDamageDeductible, null);
    assert.equal(profile.glassCapital, null);
    assert.equal(profile.glassDeductible, null);
  });

  it("tier do pedido", () => {
    const base = { ownDamage: false, collision: false, fire: false, theft: false };

    assert.equal(tierFromRequestedCoverages(base), "RC");
    assert.equal(tierFromRequestedCoverages({ ...base, theft: true }), "RC_PLUS");
    assert.equal(tierFromRequestedCoverages({ ...base, ownDamage: true, collision: true }), "OWN_DAMAGE");
  });
});

// ---------- target ----------

describe("resolveHistoricalTarget", () => {
  const receipt = (total: number, days: number, type = "Novo", status = "PAID"): TargetReceipt => ({
    type,
    status,
    periodStart: "2026-01-01",
    periodEnd: new Date(Date.parse("2026-01-01") + days * 86_400_000).toISOString().slice(0, 10),
    totalPremium: total,
  });

  it("anual: recibo igual ao prémio confirma", () => {
    const target = resolveHistoricalTarget({ annualizedPremium: 320, totalPremium: 320, paymentFrequency: "ANNUAL", receipts: [receipt(322, 364)] });

    assert.equal(target.confidence, "CONFIRMED");
    assert.equal(target.value, 320);
    assert.equal(target.basis, "ANNUAL_TOTAL");
  });

  it("semestral e mensal: o recibo é 1/n do prémio anual", () => {
    assert.equal(resolveHistoricalTarget({ annualizedPremium: 400, totalPremium: 400, paymentFrequency: "SEMIANNUAL", receipts: [receipt(201, 183)] }).confidence, "CONFIRMED");
    assert.equal(resolveHistoricalTarget({ annualizedPremium: 360, totalPremium: 360, paymentFrequency: "MONTHLY", receipts: [receipt(30, 30)] }).confidence, "CONFIRMED");
  });

  it("recibos que discordam -> INCONSISTENT; sem recibos -> PROBABLE", () => {
    assert.equal(resolveHistoricalTarget({ annualizedPremium: 345, totalPremium: 345, paymentFrequency: "ANNUAL", receipts: [receipt(390, 364)] }).confidence, "INCONSISTENT");
    assert.equal(resolveHistoricalTarget({ annualizedPremium: 345, totalPremium: 345, paymentFrequency: "ANNUAL", receipts: [] }).confidence, "PROBABLE");
  });

  it("estornos, suplementares e cancelados não contam; período incoerente não conta", () => {
    const result = resolveHistoricalTarget({
      annualizedPremium: 300,
      totalPremium: 300,
      paymentFrequency: "ANNUAL",
      receipts: [receipt(7.96, 11), receipt(300, 364, "Estorno"), receipt(300, 364, "Suplementar"), receipt(300, 364, "Novo", "CANCELLED"), receipt(300, 90)],
    });

    assert.equal(result.confidence, "PROBABLE");
    assert.equal(result.receiptsChecked, 0);
  });

  it("valor em falta -> null (nunca 0) e o comercial/objeto nunca são o target", () => {
    const none = resolveHistoricalTarget({ annualizedPremium: null, totalPremium: null, paymentFrequency: "ANNUAL", receipts: [] });

    assert.equal(none.value, null);
    assert.equal(none.confidence, "MISSING");
    assert.equal(resolveHistoricalTarget({ annualizedPremium: 0, totalPremium: 0, paymentFrequency: "ANNUAL", receipts: [] }).value, null);
    // total_premium só serve se annualized faltar
    assert.equal(resolveHistoricalTarget({ annualizedPremium: null, totalPremium: 250, paymentFrequency: "ANNUAL", receipts: [] }).source, "total_premium");
  });

  it("fracionamento desconhecido não se confirma mas não falha", () => {
    assert.equal(resolveHistoricalTarget({ annualizedPremium: 300, totalPremium: 300, paymentFrequency: "OTHER", receipts: [receipt(300, 364)] }).confidence, "PROBABLE");
  });
});

// ---------- features ----------

describe("extractZurichHistoricalFeatures", () => {
  it("apólice enriquecida real: tier, capital de danos próprios, marca e completude", () => {
    const f = policy(1, { premium: 700, age: 45, ownDamage: true, capital: 22850, deductible: 750 });

    assert.equal(f.coverageTier, "OWN_DAMAGE");
    assert.equal(f.vehicleCapital, 22850);
    assert.equal(f.coverageProfile.ownDamageDeductible, 750);
    assert.equal(f.vehicleMake, "Peugeot");
    assert.equal(f.driverAge, 45);
    assert.equal(f.postalPrefix, "4700");
    assert.equal(f.target.confidence, "CONFIRMED");
    assert.ok(f.metadataCompleteness > 0.95);
    assert.equal(isEligibleHistorical(f), true);
  });

  it("insuredObject.capital de RC NUNCA é o valor do veículo", () => {
    const f = policy(2, { premium: 320 });

    assert.equal(f.coverageTier, "RC");
    assert.equal(f.vehicleCapital, null);
  });

  it("números como string e valores em falta: nunca 0", () => {
    const input = policyInput(3, { premium: 300, ownDamage: true, capital: 18000 });
    const metadata = input.providerMetadata as { coverages: Record<string, unknown>[] };

    metadata.coverages[3] = {
      objectNumber: "1",
      description: "Zurich-Choque Colisão Cap.Inc.Raio Explo",
      capital: "18.000,50",
      deductibleValue: "",
    };

    const f = extractZurichHistoricalFeatures({ ...input, annualizedPremium: "300,25", totalPremium: null }, NOW);

    assert.equal(f.vehicleCapital, 18000.5);
    assert.equal(f.coverageProfile.ownDamageDeductible, null);
    assert.equal(f.targetPremium, 300.25);
    assert.equal(readFiniteNumber(""), null);
    assert.equal(readFiniteNumber(undefined), null);
    assert.equal(readFiniteNumber("abc"), null);
    assert.equal(readFiniteNumber("0"), 0);
  });

  it("apólice antiga sem metadata: tier desconhecido, completude baixa, sem falhar", () => {
    const input = policyInput(4, { premium: 300 });
    const f = extractZurichHistoricalFeatures({ ...input, providerMetadata: { vehicleRegistration: "AA-11-BB" } }, NOW);

    assert.equal(f.coverageTier, "UNKNOWN");
    assert.ok(f.metadataCompleteness < 0.8);
    assert.doesNotThrow(() => extractZurichHistoricalFeatures({ ...input, providerMetadata: null }, NOW));
    assert.doesNotThrow(() => extractZurichHistoricalFeatures({ ...input, providerMetadata: "lixo" }, NOW));
  });

  it("várias viaturas ativas: sem perfil e não elegível; viatura anulada não conta", () => {
    assert.equal(isEligibleHistorical(policy(5, { premium: 500, vehicles: 2 })), false);

    const input = policyInput(6, { premium: 300 });
    const metadata = input.providerMetadata as { insuredObjects: Record<string, unknown>[] };

    metadata.insuredObjects = [
      { number: "1", type: "Viatura", status: "Anulada", description: "AA-11-BB Opel" },
      { number: "1", type: "Viatura", status: "Em vigor", description: "CC-22-DD Renault Clio" },
    ];

    const f = extractZurichHistoricalFeatures(input, NOW);

    assert.equal(f.vehicleCount, 1);
    assert.equal(f.vehicleMake, "Renault");
  });

  it("classe de veículo pelas coberturas de assistência", () => {
    assert.equal(policy(7, { premium: 200, extraCoverages: [{ description: "Assistência Viagem Veículos de 2 Rodas" }] }).vehicleClass, "TWO_WHEELER");
    assert.equal(policy(8, { premium: 400, extraCoverages: [{ description: "Assistência Viagem até 3500Kg" }] }).vehicleClass, "LIGHT_COMMERCIAL");
    assert.equal(policy(9, { premium: 300 }).vehicleClass, "STANDARD");
  });

  it("marca: só a marca, nunca matrícula nem modelo", () => {
    assert.equal(extractVehicleMake("CF-26-HG Mercedes-Benz -"), "Mercedes-Benz");
    assert.equal(extractVehicleMake("<PLACA> BMW 320d"), "BMW");
    assert.equal(extractVehicleMake("Peugeot -"), "Peugeot");
    assert.equal(extractVehicleMake("Marca Desconhecida X1"), null);
    assert.equal(extractVehicleMake(null), null);
    assert.equal(extractVehicleMake("AB-12-CD"), null);
  });

  it("produto: família Empresas", () => {
    assert.equal(policy(10, { premium: 500, productCode: "5907" }).productFamily, "AUTO_BUSINESS");
    assert.equal(policy(11, { premium: 500, productCode: "5324" }).productFamily, "AUTO");
  });

  it("features do pedido: 0 é franquia válida mas valor 0 não é valor do veículo", () => {
    const req = {
      requestId: "r",
      productLine: "AUTO",
      requestedAt: NOW.toISOString(),
      customer: { birthDate: "1986-05-10", postalCode: "4700-123", drivingLicenceDate: "2008-01-01", usage: "PRIVATE" },
      vehicle: { registration: "AA-11-BB", make: null, model: null, version: null, firstRegistrationDate: null, fuelType: null, engineCc: null, powerKw: null, marketValue: 0, annualKm: null },
      claims: null,
      requestedCoverages: { liability: true, ownDamage: true, collision: true, fire: false, theft: false, glass: true, assistance: false, legalProtection: false, deductible: 0 },
      paymentFrequency: "ANNUAL",
    } satisfies QuoteRequest;

    const features = extractRequestFeatures(req, NOW);

    assert.equal(features.driverAge, 40);
    assert.equal(features.postalPrefix, "4700");
    assert.equal(features.coverageTier, "OWN_DAMAGE");
    assert.equal(features.vehicleValue, null);
    assert.equal(features.deductible, 0);

    // Sem danos próprios não há valor nem franquia a comparar.
    const rc = extractRequestFeatures({ ...req, requestedCoverages: { ...req.requestedCoverages, ownDamage: false, collision: false }, vehicle: { ...req.vehicle, marketValue: 30000 } }, NOW);

    assert.equal(rc.vehicleValue, null);
    assert.equal(rc.deductible, null);
  });
});

// ---------- distâncias ----------

describe("distâncias por feature", () => {
  it("idade decai com a diferença", () => {
    assert.equal(ageCloseness(40, 40, 10), 1);
    assert.ok((ageCloseness(40, 45, 10) as number) > (ageCloseness(40, 60, 10) as number));
    assert.equal(ageCloseness(null, 40, 10), null);
  });

  it("capital: diferença RELATIVA (20k/25k != 100k/105k)", () => {
    const small = capitalCloseness(20000, 25000, 0.6) as number;
    const large = capitalCloseness(100000, 105000, 0.6) as number;

    assert.ok(large > small);
    assert.equal(capitalCloseness(30000, 30000, 0.6), 1);
    assert.equal(capitalCloseness(30000, null, 0.6), null);
    assert.equal(capitalCloseness(30000, 0, 0.6), null);
    assert.equal(capitalCloseness(10000, 90000, 0.6), 0);
  });

  it("franquia: igual > próxima > distante; null nunca vira 0; 0 pedido só iguala 0", () => {
    assert.equal(deductibleCloseness(500, 500), 1);
    assert.equal(deductibleCloseness(500, 750), 0.6);
    assert.equal(deductibleCloseness(250, 1000), 0);
    assert.equal(deductibleCloseness(500, null), null);
    assert.equal(deductibleCloseness(null, 500), null);
    assert.equal(deductibleCloseness(0, 500), 0);
  });

  it("código postal: prefixo completo > zona > primeiro dígito > outro", () => {
    assert.equal(postalCloseness("4700", "4700"), 1);
    assert.equal(postalCloseness("4700", "4750"), 0.5);
    assert.equal(postalCloseness("4700", "4200"), 0.15);
    assert.equal(postalCloseness("4700", "1000"), 0);
    assert.equal(postalCloseness(null, "4700"), null);
  });

  it("tier: igual > vizinho > oposto; desconhecido = null", () => {
    assert.equal(tierCloseness("RC", "RC"), 1);
    assert.equal(tierCloseness("RC", "RC_PLUS"), 0.35);
    assert.equal(tierCloseness("RC", "OWN_DAMAGE"), 0);
    assert.equal(tierCloseness("RC", "UNKNOWN"), null);
  });
});

// ---------- estatística ----------

describe("weighted-stats", () => {
  const items = (values: number[], weight = 1) => values.map((value) => ({ value, weight }));

  it("médias e mediana coincidem com pesos iguais", () => {
    assert.equal(weightedMean(items([10, 20, 30, 40])), 25);
    assert.equal(weightedMedian(items([10, 20, 30, 40])), 25);
    assert.ok(Math.abs((weightedGeometricMean(items([100, 400])) as number) - 200) < 1e-9);
  });

  it("valores/pesos inválidos são ignorados; vazio -> null", () => {
    assert.equal(weightedMean([{ value: Number.NaN, weight: 1 }, { value: 5, weight: 0 }]), null);
    assert.equal(weightedMedian([]), null);
    assert.equal(weightedGeometricMean([{ value: -5, weight: 1 }]), null);
  });

  it("aparada e winsorizada resistem a um extremo, sem apagar", () => {
    const data = items([300, 305, 310, 295, 302, 298, 307, 301, 299, 303, 5000]);
    const plain = weightedMean(data) as number;
    const winsorized = winsorizedWeightedMean(data);
    const trimmed = trimmedWeightedMean(data, 0.1, 5) as number;

    assert.ok(plain > 700);
    assert.ok((winsorized.value as number) < 400);
    assert.equal(winsorized.flagged, 1);
    assert.ok(trimmed < plain);
  });

  it("sem dispersão ou pouca amostra não altera nada", () => {
    assert.equal(winsorizedWeightedMean(items([300, 300, 300, 300, 300, 300, 9999])).flagged, 0);
    assert.equal(winsorizedWeightedMean(items([1, 2, 3])).flagged, 0);
  });

  it("tamanho efetivo", () => {
    assert.equal(effectiveSampleSize([1, 1, 1, 1]), 4);
    assert.ok(effectiveSampleSize([10, 1, 1, 1]) < 2);
  });
});

// ---------- similaridade ----------

describe("calculateSimilarity", () => {
  it("dois casos quase idênticos -> similaridade muito alta (10)", () => {
    const a = policy(1, { premium: 700, age: 45, ownDamage: true, capital: 25000, deductible: 500 });
    const b = policy(2, { premium: 705, age: 46, ownDamage: true, capital: 25500, deductible: 500 });
    const target = requestFeaturesFromHistorical(a);
    const s = calculateSimilarity(target, b, config.similarity);

    assert.ok(s.score > 0.93, `score=${s.score}`);
    assert.equal(s.missingPenalty, 0);
    assert.equal(s.weightCoverage, 1);
  });

  it("dados em falta penalizam, mas não valem 0", () => {
    const complete = policy(1, { premium: 300, age: 40 });
    const noAge = policy(2, { premium: 300, age: null });
    const target = request();

    const full = calculateSimilarity(target, complete, config.similarity);
    const missing = calculateSimilarity(target, noAge, config.similarity);

    assert.ok(missing.score < full.score);
    assert.ok(missing.score > 0.5);
    assert.ok(missing.missingPenalty > 0);
    assert.equal(missing.contributions.age.closeness, null);
  });

  it("o produto só conta se o pedido o indicar", () => {
    const h = policy(1, { premium: 300, productCode: "5907" });

    assert.equal(calculateSimilarity(request(), h, config.similarity).contributions.product.relevant, false);
    assert.equal(
      calculateSimilarity(request({ productCode: "5324", productFamily: "AUTO" }), h, config.similarity).contributions.product.closeness,
      0,
    );
  });

  it("contribuições explícitas por feature", () => {
    const h = policy(1, { premium: 300, age: 41, postal: "4750-100" });
    const s = calculateSimilarity(request(), h, config.similarity);

    for (const key of ["product", "tier", "glass", "vehicleCapital", "deductible", "age", "postalRegion", "vehicleClass", "recency"] as const) {
      assert.ok(key in s.contributions);
    }

    assert.equal(s.contributions.postalRegion.closeness, 0.5);
    assert.equal(s.contributions.tier.closeness, 1);
  });
});

// ---------- os 10 cenários ----------

describe("cenários de negócio", () => {
  // Com 400 apólices sintéticas o nível 0 só chega a ~5 comparáveis; os cenários
  // que exigem franquia/capital compatíveis usam esse mínimo. (Na carteira real
  // há 20 apólices com danos próprios: esses pedidos relaxam para o nível 1-2.)
  const dense = { ...config, minComparables: 3 };

  it("1. mesmo cliente: RC vs danos próprios dá preços diferentes", () => {
    const rc = assess(request({ coverageTier: "RC" }));
    const own = assess(request({ coverageTier: "OWN_DAMAGE", vehicleValue: 25000 }));

    assert.ok(own.pointEstimate > rc.pointEstimate * 1.6, `${own.pointEstimate} vs ${rc.pointEstimate}`);
    assert.ok(rc.selection.comparables.every((m) => m.policy.coverageTier === "RC"));
    assert.ok(own.selection.comparables.every((m) => m.policy.coverageTier === "OWN_DAMAGE"));
  });

  it("2. franquia 250 vs 1000: comparáveis e estimativa mudam", () => {
    const low = assess(request({ coverageTier: "OWN_DAMAGE", vehicleValue: 25000, deductible: 250 }), PORTFOLIO, dense);
    const high = assess(request({ coverageTier: "OWN_DAMAGE", vehicleValue: 25000, deductible: 1000 }), PORTFOLIO, dense);

    const idsLow = new Set(low.selection.comparables.map((m) => m.policy.id));
    const idsHigh = new Set(high.selection.comparables.map((m) => m.policy.id));

    assert.equal(low.selection.fallbackLevel, 0);
    assert.equal(high.selection.fallbackLevel, 0);
    assert.notDeepEqual([...idsLow].sort(), [...idsHigh].sort());
    assert.ok(low.selection.comparables.every((m) => m.policy.coverageProfile.ownDamageDeductible === 250));
    // 750 está a razão 1,33 de 1000 (<= 1,5): franquia "próxima", aceite no nível 0.
    assert.ok(high.selection.comparables.every((m) => [750, 1000].includes(m.policy.coverageProfile.ownDamageDeductible as number)));
    assert.ok(low.pointEstimate > high.pointEstimate, `${low.pointEstimate} vs ${high.pointEstimate}`);
  });

  it("3. capital muito diferente: não escolhe os mesmos comparáveis", () => {
    const cheap = assess(request({ coverageTier: "OWN_DAMAGE", vehicleValue: 10000 }), PORTFOLIO, dense);
    const dear = assess(request({ coverageTier: "OWN_DAMAGE", vehicleValue: 48000 }), PORTFOLIO, dense);

    const idsCheap = new Set(cheap.selection.comparables.map((m) => m.policy.id));
    const shared = dear.selection.comparables.filter((m) => idsCheap.has(m.policy.id));

    assert.equal(shared.length, 0);
    assert.ok(dear.pointEstimate > cheap.pointEstimate);
  });

  it("4. cliente de 25 vs 60 anos: seleção e valor mudam", () => {
    const young = assess(request({ driverAge: 25 }));
    const old = assess(request({ driverAge: 60 }));

    const ages = (a: typeof young) => a.selection.comparables.map((m) => m.policy.driverAge as number);

    assert.ok(Math.max(...ages(young)) <= 25 + config.ageGateYears);
    assert.ok(Math.min(...ages(old)) >= 60 - config.ageGateYears);
    assert.ok(young.pointEstimate > old.pointEstimate, `${young.pointEstimate} vs ${old.pointEstimate}`);
  });

  it("5. código postal diferente: influência moderada", () => {
    const near = assess(request({ postalPrefix: "4700" }));
    const far = assess(request({ postalPrefix: "1000" }));

    // O gate de região muda o conjunto (mesma zona) mas o preço sintético não
    // depende do código postal: o efeito no valor tem de ser pequeno.
    const change = Math.abs(near.pointEstimate - far.pointEstimate) / near.pointEstimate;

    assert.ok(change < 0.12, `variação ${change}`);
    assert.notEqual(near.selection.comparables[0].policy.id, far.selection.comparables[0].policy.id);
  });

  it("6. metadata completa vs quase vazia: peso e confiança inferiores", () => {
    const full = policy(1, { premium: 300 });
    const poor: ZurichHistoricalFeatures = { ...full, id: "poor", metadataCompleteness: 0.3 };

    const selection = selectComparables(request(), [full, poor], { ...config, minComparables: 2 });
    const weightFull = selection.comparables.find((m) => m.policy.id === full.id)?.weight as number;
    const weightPoor = selection.comparables.find((m) => m.policy.id === "poor")?.weight as number;

    assert.ok(weightPoor > 0 && weightPoor < weightFull);

    const wellDescribed = assess(request());
    const poorPool = PORTFOLIO.map((p) => ({ ...p, metadataCompleteness: 0.3 }));
    const poorlyDescribed = assess(request(), poorPool);

    assert.ok(poorlyDescribed.confidence.components.completeness < wellDescribed.confidence.components.completeness);
    assert.ok(poorlyDescribed.confidence.score < wellDescribed.confidence.score);
  });

  it("7. poucos comparáveis: fallback e confiança baixa", () => {
    const small = PORTFOLIO.slice(0, 6);
    const result = assess(request(), small);

    assert.ok(result.selection.fallbackLevel >= 3);
    assert.equal(result.confidence.level, "LOW");
    assert.ok(result.confidence.cap !== null);

    const { warnings } = describeAssessment(request(), result);

    assert.ok(warnings.some((w) => w.includes("Poucas apólices muito parecidas")));
  });

  it("8. um outlier extremo não destrói a estimativa", () => {
    const base = Array.from({ length: 30 }, (_, i) => policy(i, { premium: 300 + (i % 5) * 4, age: 40 }));
    const withOutlier = [...base, policy(99, { premium: 6000, age: 40 })];

    // maxComparables 40 para o outlier entrar nos comparáveis (winsorização) além de entrar no ajuste.
    const wide = { ...config, maxComparables: 40 };
    const clean = estimatePremium(request(), base, wide);
    const dirty = estimatePremium(request(), withOutlier, wide);

    assert.ok(clean && dirty);
    assert.ok(Math.abs(dirty.estimate.pointEstimate - clean.estimate.pointEstimate) / clean.estimate.pointEstimate < 0.1);
    assert.ok(dirty.estimate.outliersAdjusted >= 1);
    assert.ok((dirty.estimate.adjustmentModel?.outliersClipped ?? 0) >= 1);
  });

  it("9. observações muito antigas: recência e confiança são afetadas", () => {
    const recent = PORTFOLIO;
    const old = PORTFOLIO.map((p) => ({ ...p, ageOfObservationDays: 1600 }));

    const fresh = assess(request(), recent);
    const stale = assess(request(), old);

    assert.ok((stale.observationAgeDays as number) > (fresh.observationAgeDays as number));
    assert.ok(stale.confidence.components.dataAge < fresh.confidence.components.dataAge);
    assert.ok(stale.confidence.score < fresh.confidence.score);
    assert.ok(
      calculateSimilarity(request(), old[0], config.similarity).contributions.recency.closeness! <
        calculateSimilarity(request(), recent[0], config.similarity).contributions.recency.closeness!,
    );
  });

  it("10. dois casos quase idênticos: o mais parecido lidera os comparáveis", () => {
    const twin = policy(7000, { premium: 333, age: 40, postal: "4700-100" });
    const pool = [...PORTFOLIO.slice(0, 100), twin];
    const target = requestFeaturesFromHistorical(twin);

    const selection = selectComparables(target, pool.filter((p) => p !== twin).concat(policy(7001, { premium: 336, age: 40, postal: "4700-100" })), config);

    assert.equal(selection.comparables[0].policy.id, "p7001");
    assert.ok(selection.comparables[0].similarity.score > 0.95);
  });
});

// ---------- estimador / seleção ----------

describe("seleção em camadas", () => {
  it("só relaxa quando faltam comparáveis, e informa o nível", () => {
    const rich = assess(request({ coverageTier: "OWN_DAMAGE", vehicleValue: 25000 }));

    assert.ok(rich.selection.fallbackLevel <= 1);
    assert.equal(rich.selection.strongCount + rich.selection.secondaryCount, rich.selection.comparables.length);
    assert.ok(rich.selection.comparables.length <= config.maxComparables);
  });

  it("nunca mistura viaturas não standard como 'fortes' e nunca inclui peso 0", () => {
    const pool = [
      ...Array.from({ length: 20 }, (_, i) => policy(i, { premium: 300 })),
      policy(100, { premium: 150, extraCoverages: [{ description: "Assistência Viagem Veículos de 2 Rodas" }] }),
    ];
    const selection = selectComparables(request(), pool, config);

    assert.ok(selection.comparables.every((m) => m.weight > 0));
    assert.ok(selection.comparables.filter((m) => m.level === 0).every((m) => m.policy.vehicleClass === "STANDARD"));
  });

  it("é determinística: a ordem de entrada não altera o resultado", () => {
    const a = estimatePremium(request(), PORTFOLIO, config);
    const b = estimatePremium(request(), [...PORTFOLIO].reverse(), config);

    // Somas em ordem diferente diferem na 13.a casa decimal; o valor publicado tem 2.
    assert.ok(Math.abs((a?.estimate.pointEstimate ?? 0) - (b?.estimate.pointEstimate ?? 1)) < 1e-6);
    assert.deepEqual(
      a?.selection.comparables.map((m) => m.policy.id),
      b?.selection.comparables.map((m) => m.policy.id),
    );
  });

  it("pool vazio -> null", () => {
    assert.equal(estimatePremium(request(), [], config), null);
  });
});

// ---------- validação ----------

describe("validação (backtest)", () => {
  it("leave-one-group-out retira TODAS as apólices do mesmo grupo", () => {
    const items = [
      { id: 1, group: "a", v: 10 },
      { id: 2, group: "a", v: 20 },
      { id: 3, group: "b", v: 30 },
    ];
    const seen: number[][] = [];

    leaveOneGroupOut(items, (i) => i.v, (i) => i.group, (target, pool) => {
      seen.push(pool.map((p) => p.id));

      return { predicted: target.v };
    });

    assert.deepEqual(seen, [[3], [3], [1, 2]]);
  });

  it("métricas: previsão perfeita e sub/sobre-estimação", () => {
    const perfect = computeMetrics([{ item: 1, actual: 100, predicted: 100 }]);

    assert.equal(perfect.mae, 0);

    const m = computeMetrics([
      { item: 1, actual: 100, predicted: 80 },
      { item: 2, actual: 100, predicted: 130 },
      { item: 3, actual: 100, predicted: null },
    ]);

    assert.equal(m.n, 2);
    assert.equal(m.unpredicted, 1);
    assert.equal(m.mae, 25);
    assert.equal(m.bias, 5);
    assert.equal(m.underpricing.meanAbsError, 20);
    assert.equal(m.overpricing.meanAbsError, 30);
  });

  it("intervalo de resíduos: assimétrico, com correção de amostra finita e sem dados suficientes -> null", () => {
    const residuals = [-0.3, -0.2, -0.1, -0.05, 0, 0.02, 0.05, 0.1, 0.15, 0.2, 0.4, 0.6, -0.15, 0.08, 0.12, -0.02];
    const interval = residualInterval(residuals, 0.8, 8);

    assert.ok(interval);
    assert.ok(interval.lower < 0 && interval.upper > 0);
    assert.ok(Math.abs(interval.upper) > Math.abs(interval.lower)); // cauda direita mais pesada
    assert.equal(residualInterval([0.1, 0.2], 0.8, 8), null);
    assert.equal(conformalQuantile([], 0.9), null);
  });

  it("dobras por grupo nunca partem um cliente e são determinísticas", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ i, g: `g${i % 10}` }));
    const folds = groupKFolds(items, (x) => x.g, 5, 1);

    for (const group of new Set(items.map((x) => x.g))) {
      assert.equal(folds.filter((f) => f.some((x) => x.g === group)).length, 1);
    }

    assert.deepEqual(folds, groupKFolds(items, (x) => x.g, 5, 1));
  });

  it("validação cruzada aninhada escolhe a configuração sem ver o teste", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ i, g: `g${i}`, y: 100 + (i % 5) }));

    const { predictions, chosen } = crossValidateSelection({
      items,
      groupOf: (x) => x.g,
      actualOf: (x) => x.y,
      configs: [0, 1000],
      predictorFor: (offset) => () => ({ predicted: 102 + offset }),
      score: (preds) => computeMetrics(preds).mae ?? Infinity,
      folds: 4,
      repeats: 1,
      seed: 3,
    });

    assert.equal(predictions.length, 40);
    assert.ok(chosen.every((c) => c.config === 0));
  });

  it("o gerador pseudo-aleatório é reprodutível", () => {
    assert.equal(seededRandom(1)(), seededRandom(1)());
    assert.notEqual(seededRandom(1)(), seededRandom(2)());
  });

  it("o backtest da carteira sintética bate a mediana global e o viés é pequeno", () => {
    const predictions = runLeaveOneOut(PORTFOLIO, config, requestFeaturesFromHistorical);
    const model = computeMetrics(predictions);
    const globalMedian = weightedMedian(PORTFOLIO.map((p) => ({ value: p.targetPremium as number, weight: 1 })));
    const baseline = computeMetrics(
      predictions.map((p) => ({ ...p, predicted: globalMedian })),
    );

    assert.ok((model.mae as number) < (baseline.mae as number) * 0.6, `${model.mae} vs ${baseline.mae}`);
    assert.ok(Math.abs(model.biasPct as number) < 0.05);
  });
});

// ---------- incerteza e confiança ----------

describe("incerteza e confiança", () => {
  it("o intervalo reflete o erro histórico e contém a estimativa", () => {
    const { interval } = calculateUncertainty(400, CALIBRATION, "RC");

    assert.ok(interval.min < 400 && interval.max > 400);
    assert.equal(interval.source, "SEGMENT");
    assert.ok(interval.residuals >= 15);
  });

  it("sem histórico usa a regra de recurso, e um segmento pequeno usa o global", () => {
    assert.equal(calculateUncertainty(400, null, "RC").interval.source, "FALLBACK_RULE");
    assert.equal(calculateUncertainty(400, CALIBRATION, "RC_PLUS").interval.source, "GLOBAL");
  });

  it("um erro histórico alto limita a confiança, por muitos comparáveis que haja", () => {
    const base = {
      effectiveSampleSize: 20,
      meanSimilarity: 0.95,
      minSimilarity: 0.8,
      dispersion: 0.05,
      completeness: 1,
      fallbackLevel: 0 as const,
      dataAgeDays: 1,
      observationAgeDays: 100,
      confirmedTargetShare: 1,
    };

    assert.equal(calculateConfidence({ ...base, historicalMedianApe: 0.05 }).level, "HIGH");
    assert.equal(calculateConfidence({ ...base, historicalMedianApe: 0.2 }).level, "MEDIUM");
    assert.equal(calculateConfidence({ ...base, historicalMedianApe: 0.4 }).level, "LOW");
    assert.equal(calculateConfidence({ ...base, historicalMedianApe: null }).level, "LOW");
    assert.equal(calculateConfidence({ ...base, historicalMedianApe: 0.05, fallbackLevel: 3 }).level, "LOW");
    assert.equal(calculateConfidence({ ...base, historicalMedianApe: 0.05, effectiveSampleSize: 3 }).level, "LOW");
  });

  it("o score é 0..100 e os componentes estão em [0, 1]", () => {
    const result = calculateConfidence({
      effectiveSampleSize: 1,
      meanSimilarity: 0.1,
      minSimilarity: 0,
      dispersion: 5,
      historicalMedianApe: 2,
      completeness: 0,
      fallbackLevel: 4,
      dataAgeDays: 999,
      observationAgeDays: 9999,
      confirmedTargetShare: 0,
    });

    assert.ok(result.score >= 0 && result.score <= 100);

    for (const value of Object.values(result.components)) {
      assert.ok(value >= 0 && value <= 1);
    }
  });

  it("safety-buffer continua a funcionar para modelos sem intervalo próprio", () => {
    const buffer = calculateSafetyBuffer({ pointEstimate: 300, comparablePolicies: 400, effectiveSampleSize: 20, medianAbsoluteError: 0.03 });

    assert.equal(buffer.confidence, "LOW");
  });
});

// ---------- explicabilidade ----------

describe("explicabilidade", () => {
  const ownRequest = request({ coverageTier: "OWN_DAMAGE", vehicleValue: 25000, deductible: 500 });

  it("diagnóstico completo e JSON-seguro", () => {
    const result = assess(ownRequest);
    const { reasons, warnings, diagnostics } = describeAssessment(ownRequest, result);

    assert.ok(reasons.some((r) => r.startsWith("Estimativa histórica")));
    assert.ok(reasons.some((r) => r.includes("Intervalo histórico")));
    assert.ok(reasons.some((r) => r.includes("fortes") && r.includes("secundários")));
    assert.ok(reasons.some((r) => r.startsWith("Confiança")));
    assert.ok(warnings.length > 0);
    assert.equal(diagnostics.target.basis, "ANNUAL_TOTAL");
    assert.equal(diagnostics.selection.fallbackLevel, result.selection.fallbackLevel);
    assert.ok(diagnostics.historicalError && diagnostics.historicalError.n > 0);
    assert.ok(diagnostics.mainFactors.length > 0);
    assert.ok(diagnostics.unavailableData.some((d) => d.includes("Sinistralidade")));
    assert.deepEqual(JSON.parse(JSON.stringify(diagnostics)), diagnostics);
  });

  it("consideredFactors só lista o que pesou", () => {
    const rc = buildConsideredFactors(request(), assess(request()), config);
    const own = buildConsideredFactors(ownRequest, assess(ownRequest), config);

    assert.ok(rc.includes("Tipo de cobertura"));
    assert.ok(!rc.includes("Valor do veículo"));
    assert.ok(!rc.includes("Franquia"));
    assert.ok(own.includes("Valor do veículo"));
    assert.ok(own.includes("Franquia"));
    assert.ok(!own.includes("Produto"));
  });

  it("a tabela de inputs não finge que a carta, a matrícula ou os sinistros influenciam", () => {
    const usage = Object.fromEntries(buildInputUsage().map((row) => [row.input, row]));

    assert.equal(usage["Data da carta de condução"].usedByModel, false);
    assert.equal(usage["Data da carta de condução"].existsInHistory, false);
    assert.equal(usage["Matrícula"].usedByModel, false);
    assert.equal(usage["Matrícula"].role, "IDENTIFICATION_ONLY");
    assert.equal(usage["Sinistros"].usedByModel, false);
    assert.equal(usage["Fracionamento"].usedByModel, false);
    assert.equal(usage["Data de nascimento"].usedByModel, true);
    assert.equal(usage["Valor do veículo"].usedByModel, true);
  });

  it("avisa dos dados do pedido que não usa", () => {
    const warnings = describeIgnoredRequestData({
      requestId: "r",
      productLine: "AUTO",
      requestedAt: NOW.toISOString(),
      customer: { birthDate: "1986-05-10", postalCode: "4700-123", drivingLicenceDate: "2008-01-01", usage: "TVDE" },
      vehicle: null,
      claims: { claims1Y: 0, claims3Y: 0, claims5Y: null, atFaultClaims3Y: 0 },
      requestedCoverages: { liability: true, ownDamage: false, collision: false, fire: false, theft: false, glass: false, assistance: false, legalProtection: false, deductible: null },
      paymentFrequency: "ANNUAL",
      bonusMalus: { class: null, coefficient: 0.9, claimFreeYears: 5 },
    }).join("\n");

    assert.match(warnings, /sinistros/);
    assert.match(warnings, /carta de condução/);
    assert.match(warnings, /TVDE/);
    assert.match(warnings, /bónus-malus/);
  });
});
