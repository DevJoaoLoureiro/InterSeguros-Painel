import { capitalCloseness, deductibleCloseness, postalCloseness } from "../zurich-auto-similarity";
import {
  AGE_SCALE_YEARS,
  LICENCE_LOG_SCALE,
  MISSING_TOLERANCE,
  RECENCY_FLOOR,
  RECENCY_SCALE_DAYS,
  SIMILARITY_WEIGHTS,
  type RealQuoteSimilarityFeature,
} from "./config";
import {
  sameText,
  type CalibrationObservation,
  type CalibrationTarget,
  type VehicleFeatures,
} from "./observation-features";

/*
 * Similaridade entre o pedido atual e uma cotação real Zurich.
 *
 * score em [0, 1] = média ponderada da proximidade (0..1) das features onde
 * AMBOS os lados têm dado, penalizada por dados em falta (nunca 0 nem
 * ignorado em silêncio). Só contam features que o pedido tem. O tier de
 * cobertura é um filtro à parte (calibrate), e a recência é um peso à parte
 * (recencyWeight): aqui só se compara o RISCO.
 *
 * Não entram: NIF, client_id, policy_id, número de apólice; a matrícula não
 * é feature.
 */

export type Closeness = number | null;

/** Idade: gaussiana em anos. 0-2 anos ~0,94+; 5 ~0,68; 10 ~0,21; 15+ ~0. */
export function ageCloseness(a: number | null, b: number | null): Closeness {
  if (a === null || b === null) return null;

  return Math.exp(-((Math.abs(a - b) / AGE_SCALE_YEARS) ** 2));
}

/**
 * Anos de carta: compara-se em log(1 + anos), porque a diferença entre 1 e 3
 * anos de carta pesa muito mais que entre 21 e 23. Nunca se comparam as datas
 * em bruto.
 */
export function licenceCloseness(a: number | null, b: number | null): Closeness {
  if (a === null || b === null) return null;

  return Math.exp(-Math.abs(Math.log(1 + a) - Math.log(1 + b)) / LICENCE_LOG_SCALE);
}

const HIGH_RISK_USES = new Set(["TVDE", "TAXI"]);

export function usageCloseness(a: string | null, b: string | null): Closeness {
  if (a === null || b === null) return null;

  if (a === b) return 1;

  // TVDE/táxi têm um perfil de risco próprio: não se aproximam de outros usos.
  if (HIGH_RISK_USES.has(a) || HIGH_RISK_USES.has(b)) return 0;

  return 0.3;
}

export function productCloseness(
  target: Pick<CalibrationTarget, "productCode" | "productName">,
  observation: Pick<CalibrationObservation, "productCode" | "productName">,
): Closeness {
  const byCode = sameText(target.productCode, observation.productCode);

  if (byCode !== null) return byCode ? 1 : 0.3;

  const byName = sameText(target.productName, observation.productName);

  return byName === null ? null : byName ? 1 : 0.3;
}

export function frequencyCloseness(a: string | null, b: string | null): Closeness {
  if (a === null || b === null) return null;

  return a === b ? 1 : 0.6;
}

/** Sinistros dos últimos 3 anos: só com os dois valores conhecidos. */
export function claimsCloseness(a: number | null, b: number | null): Closeness {
  if (a === null || b === null) return null;

  const difference = Math.abs(a - b);

  return difference === 0 ? 1 : difference === 1 ? 0.5 : 0.15;
}

function relativeCloseness(a: number | null, b: number | null, tolerance: number): Closeness {
  return capitalCloseness(a, b, tolerance);
}

/**
 * Veículo: média das proximidades dos sub-campos que ambos os lados têm
 * (valor, marca, combustível, potência, cilindrada, ano da 1.ª matrícula).
 * Hoje o simulador ainda não guarda estes campos: fica null (desconhecido) e
 * passa a pesar sozinho quando existirem, sem exigir que existam.
 */
export function vehicleCloseness(a: VehicleFeatures, b: VehicleFeatures): Closeness {
  const parts: number[] = [];

  const push = (value: Closeness) => {
    if (value !== null) parts.push(value);
  };

  push(relativeCloseness(a.marketValue, b.marketValue, 0.6));
  push(relativeCloseness(a.powerKw, b.powerKw, 0.6));
  push(relativeCloseness(a.engineCc, b.engineCc, 0.6));

  const make = sameText(a.make, b.make);

  if (make !== null) parts.push(make ? 1 : 0.2);

  const fuel = sameText(a.fuelType, b.fuelType);

  if (fuel !== null) parts.push(fuel ? 1 : 0.3);

  if (a.firstRegistrationYear !== null && b.firstRegistrationYear !== null) {
    parts.push(Math.exp(-Math.abs(a.firstRegistrationYear - b.firstRegistrationYear) / 6));
  }

  return parts.length === 0 ? null : parts.reduce((sum, value) => sum + value, 0) / parts.length;
}

/** Região por prefixo do código postal (4 dígitos > 2 > 1). */
function postalPrefix(value: string | null): string | null {
  return value?.match(/^(\d{4})/)?.[1] ?? null;
}

/**
 * Peso de recência: cotação de hoje = 1; decai suavemente com a idade e nunca
 * desce do piso (não se eliminam dados antigos de forma brusca). Sem data
 * válida devolve o piso (não se assume que seja recente).
 */
export function recencyWeight(quotedAtMs: number | null, nowMs: number): number {
  if (quotedAtMs === null) return RECENCY_FLOOR;

  const days = Math.max(0, (nowMs - quotedAtMs) / 86_400_000);

  return Math.max(RECENCY_FLOOR, Math.exp(-days / RECENCY_SCALE_DAYS));
}

export type RealQuoteSimilarity = {
  /** 0..1, já com a penalização por dados em falta. */
  score: number;

  contributions: Record<
    RealQuoteSimilarityFeature,
    { relevant: boolean; weight: number; closeness: Closeness }
  >;

  missingPenalty: number;
  weightCoverage: number;
};

export function calculateRealQuoteSimilarity(
  target: CalibrationTarget,
  observation: CalibrationObservation,
): RealQuoteSimilarity {
  const targetPostal = postalPrefix(target.postal);
  const observationPostal = postalPrefix(observation.postal);

  const vehicleRelevant =
    target.vehicle.marketValue !== null ||
    target.vehicle.make !== null ||
    target.vehicle.fuelType !== null ||
    target.vehicle.powerKw !== null ||
    target.vehicle.engineCc !== null ||
    target.vehicle.firstRegistrationYear !== null;

  const raw: Record<
    RealQuoteSimilarityFeature,
    { relevant: boolean; closeness: Closeness }
  > = {
    licenceYears: {
      relevant: target.licenceYears !== null,
      closeness: licenceCloseness(target.licenceYears, observation.licenceYears),
    },
    age: {
      relevant: target.ageYears !== null,
      closeness: ageCloseness(target.ageYears, observation.ageYears),
    },
    usage: {
      relevant: target.usage !== null,
      closeness: usageCloseness(target.usage, observation.usage),
    },
    product: {
      relevant: target.productCode !== null || target.productName !== null,
      closeness: productCloseness(target, observation),
    },
    deductible: {
      relevant: target.deductible !== null,
      closeness: deductibleCloseness(target.deductible, observation.deductible),
    },
    vehicle: {
      relevant: vehicleRelevant,
      closeness: vehicleCloseness(target.vehicle, observation.vehicle),
    },
    postalRegion: {
      relevant: targetPostal !== null,
      closeness: postalCloseness(targetPostal, observationPostal),
    },
    paymentFrequency: {
      relevant: target.paymentFrequency !== null,
      closeness: frequencyCloseness(target.paymentFrequency, observation.paymentFrequency),
    },
    claims: {
      relevant: target.claims3Y !== null,
      closeness: claimsCloseness(target.claims3Y, observation.claims3Y),
    },
  };

  const contributions = {} as RealQuoteSimilarity["contributions"];

  let weighted = 0;
  let known = 0;
  let missing = 0;

  for (const feature of Object.keys(SIMILARITY_WEIGHTS) as RealQuoteSimilarityFeature[]) {
    const weight = SIMILARITY_WEIGHTS[feature];
    const { relevant, closeness } = raw[feature];

    contributions[feature] = { relevant, weight, closeness };

    if (!relevant) continue;

    if (closeness === null) {
      missing += weight;
    } else {
      known += weight;
      weighted += weight * closeness;
    }
  }

  const relevantWeight = known + missing;

  if (known === 0 || relevantWeight === 0) {
    return { score: 0, contributions, missingPenalty: 1, weightCoverage: 0 };
  }

  const missingPenalty = (1 - MISSING_TOLERANCE) * (missing / relevantWeight);

  return {
    score: (weighted / known) * (1 - missingPenalty),
    contributions,
    missingPenalty,
    weightCoverage: known / relevantWeight,
  };
}
