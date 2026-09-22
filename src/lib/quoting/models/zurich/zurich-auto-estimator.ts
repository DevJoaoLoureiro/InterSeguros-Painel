import {
  effectiveSampleSize,
  relativeMedianAbsoluteDeviation,
  trimmedWeightedMean,
  weightedGeometricMean,
  weightedMean,
  weightedMedian,
  winsorizedWeightedMean,
  type WeightedValue,
} from "./weighted-stats";
import {
  adjustmentFactor,
  fitAdjustmentModel,
  inputsFromHistorical,
  inputsFromRequest,
  predictWithModel,
  type AdjustmentModel,
} from "./zurich-auto-adjustment";
import type {
  RequestFeatures,
  ZurichHistoricalFeatures,
} from "./zurich-auto-features";
import {
  DEFAULT_SIMILARITY_CONFIG,
  calculateSimilarity,
  deductibleCloseness,
  relativeDifference,
  tierCloseness,
  type SimilarityConfig,
  type SimilarityResult,
} from "./zurich-auto-similarity";

/*
 * Seleção de comparáveis em camadas (fallback progressivo) e estimativa.
 *
 * NIVEIS (cada nível ACRESCENTA apólices; só se avança se faltarem
 * comparáveis, nunca se começa por um conjunto largo):
 *
 *   0 EXCELENTE     mesmo tier, capital e franquia compatíveis (quando o
 *                   pedido os tem), idade e região próximas, mesmo produto
 *                   (quando indicado), viatura standard
 *   1 SEM CAPITAL   idem sem exigir capital/franquia compatíveis
 *   2 SEM PERFIL    idem sem exigir idade/região
 *   3 TIER VIZINHO  aceita tier adjacente (RC <-> RC_PLUS <-> danos próprios)
 *   4 CARTEIRA      todo o histórico elegível, ponderado pela semelhança
 *
 * Dentro do conjunto escolhido, cada apólice pesa
 *   score^kernelPower x completude x (cancelada ? fator : 1)
 * pelo que as menos parecidas contam pouco mesmo quando entram.
 * "Strong" = apólices que cumprem o nível 0; "secondary" = as restantes
 * (só as necessárias para atingir o mínimo).
 */

export type FallbackLevel = 0 | 1 | 2 | 3 | 4;

export const FALLBACK_LEVEL_LABEL: Record<FallbackLevel, string> = {
  0: "comparáveis excelentes",
  1: "capital e franquia relaxados",
  2: "idade e região relaxadas",
  3: "tier de cobertura vizinho",
  4: "carteira completa",
};

export type EstimationMethod =
  | "WEIGHTED_MEAN"
  | "WEIGHTED_MEDIAN"
  | "TRIMMED_MEAN"
  | "WINSORIZED_MEAN"
  | "GEOMETRIC_MEAN";

export type EstimatorConfig = {
  similarity: SimilarityConfig;
  method: EstimationMethod;

  /** Nº mínimo de comparáveis antes de deixar de relaxar. */
  minComparables: number;

  /** Teto de comparáveis (os mais semelhantes). */
  maxComparables: number;

  /**
   * Ajuste multiplicativo dos comparáveis (ver zurich-auto-adjustment.ts).
   * `ridgeLambda` regulariza o modelo log-linear; `modelBlend` em [0, 1]
   * mistura (em escala log) a estimativa dos comparáveis ajustados com a
   * previsão direta do modelo: 0 = só comparáveis, 1 = só modelo.
   */
  adjustment: boolean;
  ridgeLambda: number;
  modelBlend: number;

  /** Nível 0/1: diferença máxima de idade (anos) e de capital (relativa). */
  ageGateYears: number;
  capitalGate: number;
};

export const DEFAULT_ESTIMATOR_CONFIG: EstimatorConfig = {
  similarity: DEFAULT_SIMILARITY_CONFIG,
  // Média winsorizada: robusta a 1-2 prémios extremos sem os apagar.
  method: "WINSORIZED_MEAN",
  minComparables: 12,
  maxComparables: 25,
  adjustment: true,
  ridgeLambda: 5,
  modelBlend: 0.5,
  ageGateYears: 8,
  capitalGate: 0.35,
};

export type ComparableMatch = {
  policy: ZurichHistoricalFeatures;
  similarity: SimilarityResult;
  weight: number;

  /** Menor nível em que a apólice se qualifica. */
  level: FallbackLevel;
};

export type Selection = {
  comparables: ComparableMatch[];

  /** Nível de relaxamento necessário para atingir o mínimo. */
  fallbackLevel: FallbackLevel;

  strongCount: number;
  secondaryCount: number;

  /** Nº de apólices por nível de qualificação (antes do teto). */
  levelCounts: Record<FallbackLevel, number>;

  poolSize: number;
};

// ---------- predicados dos níveis ----------

function meetsProfile(
  target: RequestFeatures,
  policy: ZurichHistoricalFeatures,
  config: EstimatorConfig,
): boolean {
  if (
    target.driverAge !== null &&
    (policy.driverAge === null ||
      Math.abs(target.driverAge - policy.driverAge) > config.ageGateYears)
  ) {
    return false;
  }

  if (
    target.postalPrefix !== null &&
    (policy.postalPrefix === null ||
      policy.postalPrefix.slice(0, 2) !== target.postalPrefix.slice(0, 2))
  ) {
    return false;
  }

  return true;
}

function meetsCapitalAndDeductible(
  target: RequestFeatures,
  policy: ZurichHistoricalFeatures,
  config: EstimatorConfig,
): boolean {
  if (target.vehicleValue !== null) {
    if (
      policy.vehicleCapital === null ||
      relativeDifference(target.vehicleValue, policy.vehicleCapital) >
        config.capitalGate
    ) {
      return false;
    }
  }

  if (target.deductible !== null) {
    const closeness = deductibleCloseness(
      target.deductible,
      policy.coverageProfile.ownDamageDeductible,
    );

    if (closeness === null || closeness < 0.6) {
      return false;
    }
  }

  return true;
}

function meetsProduct(
  target: RequestFeatures,
  policy: ZurichHistoricalFeatures,
): boolean {
  return (
    target.productFamily === null ||
    policy.productFamily === target.productFamily
  );
}

/** Menor nível em que a apólice se qualifica (4 = só a carteira completa). */
function qualifyingLevel(
  target: RequestFeatures,
  policy: ZurichHistoricalFeatures,
  config: EstimatorConfig,
): FallbackLevel {
  const sameTier = policy.coverageTier === target.coverageTier;
  const standard = policy.vehicleClass === "STANDARD";
  const productOk = meetsProduct(target, policy);

  if (sameTier && standard && productOk) {
    const profileOk = meetsProfile(target, policy, config);

    if (profileOk && meetsCapitalAndDeductible(target, policy, config)) return 0;
    if (profileOk) return 1;

    return 2;
  }

  const neighbour =
    (tierCloseness(target.coverageTier, policy.coverageTier) ?? 0) > 0;

  if (neighbour && standard) return 3;

  return 4;
}

// ---------- seleção ----------

export function selectComparables(
  target: RequestFeatures,
  pool: readonly ZurichHistoricalFeatures[],
  config: EstimatorConfig = DEFAULT_ESTIMATOR_CONFIG,
): Selection {
  const matches: ComparableMatch[] = pool.map((policy) => {
    const similarity = calculateSimilarity(target, policy, config.similarity);

    const completeness =
      config.similarity.completenessFloor +
      (1 - config.similarity.completenessFloor) * policy.metadataCompleteness;

    return {
      policy,
      similarity,
      weight:
        Math.pow(similarity.score, config.similarity.kernelPower) *
        completeness *
        (policy.isCancelled ? config.similarity.cancelledFactor : 1),
      level: qualifyingLevel(target, policy, config),
    };
  });

  const levelCounts: Record<FallbackLevel, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };

  for (const match of matches) levelCounts[match.level] += 1;

  // Acumula níveis até atingir o mínimo (o nível 4 aceita tudo).
  let fallbackLevel: FallbackLevel = 4;
  let cumulative = 0;

  for (const level of [0, 1, 2, 3, 4] as const) {
    cumulative += levelCounts[level];

    if (cumulative >= config.minComparables) {
      fallbackLevel = level;
      break;
    }
  }

  const comparables = matches
    .filter((match) => match.level <= fallbackLevel && match.weight > 0)
    .sort(
      (a, b) =>
        b.similarity.score - a.similarity.score ||
        (a.policy.id < b.policy.id ? -1 : a.policy.id > b.policy.id ? 1 : 0),
    )
    .slice(0, config.maxComparables);

  const strongCount = comparables.filter((match) => match.level === 0).length;

  return {
    comparables,
    fallbackLevel,
    strongCount,
    secondaryCount: comparables.length - strongCount,
    levelCounts,
    poolSize: pool.length,
  };
}

// ---------- estimativa ----------

export type EstimateResult = {
  pointEstimate: number;
  method: EstimationMethod;

  effectiveSampleSize: number;
  meanSimilarity: number;
  minSimilarity: number;

  /** Dispersão relativa dos prémios comparáveis (desvio mediano / mediana). */
  dispersion: number | null;

  /** Observações trazidas para o limite pela winsorização (0 nos outros métodos). */
  outliersAdjusted: number;

  /** Estimativa só com os comparáveis (após ajuste), antes de misturar com o modelo. */
  comparablesEstimate: number;

  /** Previsão direta do modelo log-linear e peso com que entrou (0 se não houve). */
  modelPrediction: number | null;
  modelBlend: number;

  /** Modelo de ajuste usado (null = sem ajuste: pouca amostra ou desligado). */
  adjustmentModel: AdjustmentModel | null;
};

export type AdjustmentContext = {
  model: AdjustmentModel | null;
  target: RequestFeatures;
  blend: number;
};

function applyMethod(
  method: EstimationMethod,
  items: readonly WeightedValue[],
): { value: number | null; adjusted: number } {
  switch (method) {
    case "WEIGHTED_MEAN":
      return { value: weightedMean(items), adjusted: 0 };
    case "WEIGHTED_MEDIAN":
      return { value: weightedMedian(items), adjusted: 0 };
    case "TRIMMED_MEAN":
      return { value: trimmedWeightedMean(items), adjusted: 0 };
    case "GEOMETRIC_MEAN":
      return { value: weightedGeometricMean(items), adjusted: 0 };
    case "WINSORIZED_MEAN": {
      const result = winsorizedWeightedMean(items);

      return { value: result.value, adjusted: result.flagged };
    }
  }
}

/** null se não houver comparáveis com peso. */
export function calculateEstimate(
  selection: Pick<Selection, "comparables">,
  method: EstimationMethod,
  context?: AdjustmentContext,
): EstimateResult | null {
  const model = context?.model ?? null;
  const targetInputs = context ? inputsFromRequest(context.target) : null;

  // Cada prémio é levado ao perfil do pedido (idade, capital, tier, classe).
  const items: WeightedValue[] = selection.comparables
    .filter((match) => match.policy.targetPremium !== null)
    .map((match) => ({
      value:
        (match.policy.targetPremium as number) *
        (model && targetInputs
          ? adjustmentFactor(model, targetInputs, inputsFromHistorical(match.policy))
          : 1),
      weight: match.weight,
    }));

  const { value: comparablesEstimate, adjusted } = applyMethod(method, items);

  if (
    comparablesEstimate === null ||
    !Number.isFinite(comparablesEstimate) ||
    comparablesEstimate <= 0
  ) {
    return null;
  }

  const blend = model && context ? Math.min(1, Math.max(0, context.blend)) : 0;
  const modelPrediction =
    model && targetInputs ? predictWithModel(model, targetInputs) : null;

  const value =
    modelPrediction !== null && blend > 0
      ? Math.exp(
          (1 - blend) * Math.log(comparablesEstimate) +
            blend * Math.log(modelPrediction),
        )
      : comparablesEstimate;

  const weights = items.map((item) => item.weight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const scores = selection.comparables.map((match) => match.similarity.score);

  return {
    pointEstimate: value,
    method,
    effectiveSampleSize: effectiveSampleSize(weights),
    meanSimilarity:
      totalWeight === 0
        ? 0
        : selection.comparables.reduce(
            (sum, match) => sum + match.similarity.score * match.weight,
            0,
          ) / totalWeight,
    minSimilarity: scores.length === 0 ? 0 : Math.min(...scores),
    dispersion: relativeMedianAbsoluteDeviation(items, weightedMedian(items) ?? value),
    outliersAdjusted: adjusted,
    comparablesEstimate,
    modelPrediction,
    modelBlend: blend,
    adjustmentModel: model,
  };
}

/** Atalho: seleção + estimativa. */
export function estimatePremium(
  target: RequestFeatures,
  pool: readonly ZurichHistoricalFeatures[],
  config: EstimatorConfig = DEFAULT_ESTIMATOR_CONFIG,
): { selection: Selection; estimate: EstimateResult } | null {
  const selection = selectComparables(target, pool, config);

  const model = config.adjustment
    ? fitAdjustmentModel(pool, config.ridgeLambda)
    : null;

  const estimate = calculateEstimate(selection, config.method, {
    model,
    target,
    blend: config.modelBlend,
  });

  return estimate ? { selection, estimate } : null;
}
