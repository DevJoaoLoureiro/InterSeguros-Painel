import type { CoverageTier } from "./zurich-auto-coverages";
import type {
  RequestFeatures,
  ZurichHistoricalFeatures,
} from "./zurich-auto-features";

/*
 * Similaridade entre o pedido e uma apólice histórica.
 *
 * score em [0, 1] = média ponderada da PROXIMIDADE (closeness, 0..1) em
 * cada feature, calculada só sobre as features onde ambos os lados têm
 * dado; o que falta não vale 0 nem é ignorado em silêncio: reduz o score
 * por `missingPenalty` (ver abaixo). Só entram features relevantes para o
 * pedido (o produto, por exemplo, só conta se o pedido o indicar).
 *
 * Cada feature tem a sua distância, apropriada à sua natureza:
 * - idade: decaimento exponencial na diferença em anos;
 * - capital: diferença RELATIVA |a-b|/max(a,b) (20k vs 25k != 100k vs 105k);
 * - franquia: igualdade / razão; nunca 0 = desconhecido;
 * - código postal: 4 dígitos > 2 dígitos > 1 dígito;
 * - produto: mesmo código > mesma família > outro;
 * - tier: igual > adjacente > oposto.
 *
 * PESOS. Ponto de partida pedido (produto, tier e capital altos; franquia
 * alta; idade e região médias; recência baixa), depois testado no backtest
 * da carteira (108 apólices, leave-one-client-out; ver validation/). O
 * resultado é que só o TIER e o ajuste multiplicativo (zurich-auto-
 * adjustment.ts) são sinal robusto; variar os restantes pesos move o MAE
 * menos de 1 EUR (ruído com esta amostra). Por isso os que não
 * melhoraram o erro (vidros, idade, recência) foram REDUZIDOS, não
 * afinados: idade e capital já entram pelo ajuste. Uma pesquisa aleatória
 * de pesos com validação aninhada escolheu configurações diferentes em
 * cada dobra e teve pior erro que estes valores fixos, logo não se usa.
 */

export type SimilarityFeature =
  | "product"
  | "tier"
  | "glass"
  | "vehicleCapital"
  | "deductible"
  | "age"
  | "postalRegion"
  | "vehicleClass"
  | "recency";

export const SIMILARITY_FEATURES: readonly SimilarityFeature[] = [
  "product",
  "tier",
  "glass",
  "vehicleCapital",
  "deductible",
  "age",
  "postalRegion",
  "vehicleClass",
  "recency",
];

export type SimilarityConfig = {
  weights: Record<SimilarityFeature, number>;

  /** Escala do decaimento exponencial da idade (anos). */
  ageScaleYears: number;

  /** Diferença relativa de capital a partir da qual a proximidade é 0. */
  capitalTolerance: number;

  /**
   * Tolerância a dados em falta em [0, 1]. 1 = o que falta não penaliza;
   * 0 = uma feature relevante totalmente desconhecida anula o score.
   */
  missingTolerance: number;

  /** Escala do decaimento exponencial da recência (dias). */
  recencyScaleDays: number;

  /** Expoente do kernel: peso = score^kernelPower (maior = mais seletivo). */
  kernelPower: number;

  /**
   * Piso do fator de completude: peso *= piso + (1 - piso) x completude.
   * 1 = ignora a completude.
   */
  completenessFloor: number;

  /** Fator de peso das apólices canceladas (1 = iguais às ativas). */
  cancelledFactor: number;
};

export const DEFAULT_SIMILARITY_CONFIG: SimilarityConfig = {
  weights: {
    product: 3,
    tier: 5,
    glass: 0.5,
    vehicleCapital: 4,
    deductible: 2,
    age: 1,
    postalRegion: 2,
    vehicleClass: 2,
    recency: 0.5,
  },
  ageScaleYears: 10,
  capitalTolerance: 0.6,
  missingTolerance: 0.6,
  recencyScaleDays: 730,
  kernelPower: 2,
  completenessFloor: 0.5,
  cancelledFactor: 1,
};

// ---------- distâncias (todas puras e testadas) ----------

/** Proximidade em [0, 1] ou null se algum lado é desconhecido. */
export type Closeness = number | null;

export function ageCloseness(
  targetAge: number | null,
  historicalAge: number | null,
  scaleYears: number,
): Closeness {
  if (targetAge === null || historicalAge === null) {
    return null;
  }

  return Math.exp(-Math.abs(targetAge - historicalAge) / scaleYears);
}

export function relativeDifference(a: number, b: number): number {
  const max = Math.max(Math.abs(a), Math.abs(b));

  return max === 0 ? 0 : Math.abs(a - b) / max;
}

export function capitalCloseness(
  targetCapital: number | null,
  historicalCapital: number | null,
  tolerance: number,
): Closeness {
  if (
    targetCapital === null ||
    historicalCapital === null ||
    targetCapital <= 0 ||
    historicalCapital <= 0
  ) {
    return null;
  }

  return Math.max(
    0,
    1 - relativeDifference(targetCapital, historicalCapital) / tolerance,
  );
}

/**
 * Franquia (euros). Igualdade = 1; até 1,5x de razão = 0,6; senão 0.
 * Um pedido sem franquia (0) só é igual a franquia 0, e as históricas
 * nunca têm 0 conhecido (0 = não informado), logo dá 0 e não null: o
 * mediador quis sem franquia e a apólice tem franquia.
 */
export function deductibleCloseness(
  targetDeductible: number | null,
  historicalDeductible: number | null,
): Closeness {
  if (targetDeductible === null || historicalDeductible === null) {
    return null;
  }

  if (targetDeductible === 0) {
    return historicalDeductible === 0 ? 1 : 0;
  }

  const ratio =
    Math.max(targetDeductible, historicalDeductible) /
    Math.min(targetDeductible, historicalDeductible);

  if (ratio <= 1.005) return 1;
  if (ratio <= 1.5) return 0.6;

  return 0;
}

export function postalCloseness(
  targetPrefix: string | null,
  historicalPrefix: string | null,
): Closeness {
  if (!targetPrefix || !historicalPrefix) {
    return null;
  }

  if (targetPrefix === historicalPrefix) return 1;
  if (targetPrefix.slice(0, 2) === historicalPrefix.slice(0, 2)) return 0.5;
  if (targetPrefix[0] === historicalPrefix[0]) return 0.15;

  return 0;
}

export function productCloseness(
  target: Pick<RequestFeatures, "productCode" | "productFamily">,
  historical: Pick<ZurichHistoricalFeatures, "productCode" | "productFamily">,
): Closeness {
  if (target.productCode === null) {
    return null;
  }

  if (historical.productCode === target.productCode) return 1;
  if (
    target.productFamily !== null &&
    historical.productFamily === target.productFamily
  ) {
    return 0.6;
  }

  return 0;
}

const TIER_ORDER: readonly CoverageTier[] = ["RC", "RC_PLUS", "OWN_DAMAGE"];

/** Mesmo tier = 1; tiers vizinhos = 0,35; RC vs danos próprios = 0. */
export function tierCloseness(
  target: CoverageTier,
  historical: CoverageTier,
): Closeness {
  if (historical === "UNKNOWN" || target === "UNKNOWN") {
    return null;
  }

  const distance = Math.abs(
    TIER_ORDER.indexOf(target) - TIER_ORDER.indexOf(historical),
  );

  return distance === 0 ? 1 : distance === 1 ? 0.35 : 0;
}

export function recencyCloseness(
  ageOfObservationDays: number | null,
  scaleDays: number,
): Closeness {
  if (ageOfObservationDays === null) {
    return null;
  }

  return Math.exp(-Math.max(0, ageOfObservationDays) / scaleDays);
}

// ---------- score ----------

export type SimilarityContribution = {
  /** false = o pedido não tem este dado: a feature não conta. */
  relevant: boolean;
  weight: number;
  closeness: Closeness;
};

export type SimilarityResult = {
  /** 0..1, já com a penalização por dados em falta. */
  score: number;

  contributions: Record<SimilarityFeature, SimilarityContribution>;

  /** Redução relativa do score por dados em falta (0..1). */
  missingPenalty: number;

  /** Fração do peso relevante que teve dados dos dois lados (0..1). */
  weightCoverage: number;
};

/**
 * O pedido é sempre tratado como viatura STANDARD: o simulador não pergunta
 * o tipo de veículo. Apólices de duas rodas ou de "até 3500Kg" (indício
 * dado pelas suas coberturas de assistência) aproximam-se menos.
 */
function vehicleClassCloseness(
  historical: Pick<ZurichHistoricalFeatures, "vehicleClass">,
): Closeness {
  return historical.vehicleClass === "STANDARD" ? 1 : 0;
}

export function calculateSimilarity(
  target: RequestFeatures,
  historical: ZurichHistoricalFeatures,
  config: SimilarityConfig = DEFAULT_SIMILARITY_CONFIG,
): SimilarityResult {
  const profile = historical.coverageProfile;

  const raw: Record<SimilarityFeature, { relevant: boolean; closeness: Closeness }> = {
    product: {
      relevant: target.productCode !== null,
      closeness: productCloseness(target, historical),
    },
    tier: {
      relevant: true,
      closeness: tierCloseness(target.coverageTier, historical.coverageTier),
    },
    glass: {
      relevant: true,
      closeness:
        profile.hasGlass === null
          ? null
          : profile.hasGlass === target.wantsGlass
            ? 1
            : 0,
    },
    vehicleCapital: {
      relevant: target.vehicleValue !== null,
      closeness: capitalCloseness(
        target.vehicleValue,
        historical.vehicleCapital,
        config.capitalTolerance,
      ),
    },
    deductible: {
      relevant: target.deductible !== null,
      closeness: deductibleCloseness(
        target.deductible,
        profile.ownDamageDeductible,
      ),
    },
    age: {
      relevant: target.driverAge !== null,
      closeness: ageCloseness(
        target.driverAge,
        historical.driverAge,
        config.ageScaleYears,
      ),
    },
    postalRegion: {
      relevant: target.postalPrefix !== null,
      closeness: postalCloseness(target.postalPrefix, historical.postalPrefix),
    },
    vehicleClass: {
      relevant: true,
      closeness: vehicleClassCloseness(historical),
    },
    recency: {
      relevant: true,
      closeness: recencyCloseness(
        historical.ageOfObservationDays,
        config.recencyScaleDays,
      ),
    },
  };

  const contributions = {} as Record<SimilarityFeature, SimilarityContribution>;

  let weightedCloseness = 0;
  let knownWeight = 0;
  let missingWeight = 0;

  for (const feature of SIMILARITY_FEATURES) {
    const weight = config.weights[feature];
    const { relevant, closeness } = raw[feature];

    contributions[feature] = { relevant, weight, closeness };

    if (!relevant || weight <= 0) continue;

    if (closeness === null) {
      missingWeight += weight;
    } else {
      knownWeight += weight;
      weightedCloseness += weight * closeness;
    }
  }

  const relevantWeight = knownWeight + missingWeight;

  if (knownWeight === 0 || relevantWeight === 0) {
    return { score: 0, contributions, missingPenalty: 1, weightCoverage: 0 };
  }

  const missingShare = missingWeight / relevantWeight;
  const missingPenalty = (1 - config.missingTolerance) * missingShare;

  return {
    score: (weightedCloseness / knownWeight) * (1 - missingPenalty),
    contributions,
    missingPenalty,
    weightCoverage: knownWeight / relevantWeight,
  };
}
