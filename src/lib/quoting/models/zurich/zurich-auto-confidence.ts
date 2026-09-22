import type { ConfidenceLevel } from "../../domain/types";
import {
  estimatePremium,
  type EstimateResult,
  type EstimatorConfig,
  type FallbackLevel,
  type Selection,
} from "./zurich-auto-estimator";
import type {
  RequestFeatures,
  ZurichHistoricalFeatures,
} from "./zurich-auto-features";
import {
  quantile,
  relativeResiduals,
  residualInterval,
  type Prediction,
  type ResidualInterval,
} from "./zurich-auto-validation";

/*
 * Incerteza (intervalo) e confiança do estimador, calibradas com o
 * ERRO HISTÓRICO do próprio modelo.
 *
 * ERRO HISTÓRICO. Para cada apólice elegível prevê-se o seu prémio com as
 * restantes (leave-one-client-out) e comparam-se previsto e real. Os
 * resíduos relativos (real/previsto - 1) dão o erro típico por tier de
 * cobertura, ou global se o tier tiver poucas apólices.
 *
 * INTERVALO. previsão x (1 + quantil inferior) .. previsão x (1 + quantil
 * superior) dos resíduos, com cobertura nominal de 80% (P10-P90) e correção
 * de amostra finita. É assimétrico se os erros o forem; não assume
 * distribuição normal. NÃO é um intervalo de confiança do prémio real da
 * Zurich: descreve onde o modelo errou historicamente.
 *
 * CONFIANÇA. Score 0-100 = média ponderada de 9 componentes em [0, 1]
 * (ver CONFIDENCE_WEIGHTS). O erro histórico é o componente mais pesado
 * (25%): um modelo com erro típico de 25% não pode ter confiança alta por
 * ter muitos comparáveis.
 */

/** Cobertura nominal do intervalo (P10-P90). */
export const INTERVAL_COVERAGE = 0.8;

/** Nº mínimo de resíduos num segmento para usar o seu erro (senão o global). */
export const MIN_SEGMENT_RESIDUALS = 15;

/** Teto de alvos no cálculo do erro histórico (custo O(n x pool)). */
export const MAX_CALIBRATION_TARGETS = 400;

/** Intervalo de recurso (relativo) quando não há resíduos suficientes. */
export const FALLBACK_INTERVAL = { lower: -0.3, upper: 0.4 };

export type SegmentError = {
  segment: string;
  n: number;

  mae: number | null;
  medianAbsoluteError: number | null;
  absErrorP90: number | null;

  /** Mediana do erro percentual absoluto (0.2 = 20%). */
  medianApe: number | null;
  biasPct: number | null;

  interval: ResidualInterval | null;
};

export type Calibration = {
  overall: SegmentError;
  byTier: Record<string, SegmentError>;
};

function segmentError(
  segment: string,
  predictions: readonly Prediction<ZurichHistoricalFeatures>[],
): SegmentError {
  const usable = predictions.filter(
    (p): p is Prediction<ZurichHistoricalFeatures> & { predicted: number } =>
      p.predicted !== null && p.predicted > 0 && p.actual > 0,
  );

  const absErrors = usable.map((p) => Math.abs(p.predicted - p.actual));
  const apes = usable.map((p) => Math.abs(p.predicted - p.actual) / p.actual);

  return {
    segment,
    n: usable.length,
    mae:
      absErrors.length === 0
        ? null
        : absErrors.reduce((sum, value) => sum + value, 0) / absErrors.length,
    medianAbsoluteError: quantile(absErrors, 0.5),
    absErrorP90: quantile(absErrors, 0.9),
    medianApe: quantile(apes, 0.5),
    biasPct:
      usable.length === 0
        ? null
        : usable.reduce(
            (sum, p) => sum + (p.predicted - p.actual) / p.actual,
            0,
          ) / usable.length,
    interval: residualInterval(
      relativeResiduals(usable),
      INTERVAL_COVERAGE,
      MIN_SEGMENT_RESIDUALS,
    ),
  };
}

export function buildCalibration(
  predictions: readonly Prediction<ZurichHistoricalFeatures>[],
): Calibration {
  const byTier: Record<string, SegmentError> = {};

  for (const tier of ["RC", "RC_PLUS", "OWN_DAMAGE"]) {
    byTier[tier] = segmentError(
      tier,
      predictions.filter((p) => p.item.coverageTier === tier),
    );
  }

  return { overall: segmentError("GLOBAL", predictions), byTier };
}

/** O que o modelo prevê para um histórico como se fosse um pedido. */
export type HistoricalAsRequest = (
  policy: ZurichHistoricalFeatures,
) => RequestFeatures;

/**
 * Erro histórico do modelo (leave-one-client-out). Com mais de
 * MAX_CALIBRATION_TARGETS apólices avalia-se uma amostra determinística
 * (passo fixo), com o pool sempre completo.
 */
export function runLeaveOneOut(
  pool: readonly ZurichHistoricalFeatures[],
  config: EstimatorConfig,
  asRequest: HistoricalAsRequest,
): Prediction<ZurichHistoricalFeatures>[] {
  const step = Math.max(1, Math.ceil(pool.length / MAX_CALIBRATION_TARGETS));
  const targets = pool.filter((_, index) => index % step === 0);

  return targets.map((target) => {
    const group = target.groupKey;
    const others = pool.filter(
      (other) =>
        other !== target && (group === null || other.groupKey !== group),
    );

    const result = estimatePremium(asRequest(target), others, config);

    return {
      item: target,
      actual: target.targetPremium as number,
      predicted: result?.estimate.pointEstimate ?? null,
    };
  });
}

// ---------- intervalo ----------

export type PriceInterval = {
  min: number;
  max: number;

  /** Erro relativo aplicado (real/previsto - 1) em cada lado. */
  lowerError: number;
  upperError: number;

  nominalCoverage: number;

  /** Origem do erro usado: segmento, global ou regra de recurso (sem histórico). */
  source: "SEGMENT" | "GLOBAL" | "FALLBACK_RULE";
  residuals: number;
};

export function calculateUncertainty(
  pointEstimate: number,
  calibration: Calibration | null,
  tier: string,
): { interval: PriceInterval; error: SegmentError | null } {
  const segment = calibration?.byTier[tier] ?? null;

  const usable =
    segment?.interval && segment.n >= MIN_SEGMENT_RESIDUALS
      ? { error: segment, source: "SEGMENT" as const }
      : calibration?.overall.interval
        ? { error: calibration.overall, source: "GLOBAL" as const }
        : null;

  const bounds = usable?.error.interval ?? {
    ...FALLBACK_INTERVAL,
    nominalCoverage: INTERVAL_COVERAGE,
    n: 0,
  };

  // Garante min <= estimativa <= max mesmo com resíduos todos do mesmo sinal.
  const lowerError = Math.min(bounds.lower, 0);
  const upperError = Math.max(bounds.upper, 0);

  return {
    interval: {
      min: pointEstimate * (1 + Math.max(lowerError, -0.95)),
      max: pointEstimate * (1 + upperError),
      lowerError,
      upperError,
      nominalCoverage: bounds.nominalCoverage,
      source: usable?.source ?? "FALLBACK_RULE",
      residuals: bounds.n,
    },
    error: usable?.error ?? null,
  };
}

// ---------- confiança ----------

export const CONFIDENCE_WEIGHTS = {
  sampleSize: 0.15,
  similarity: 0.15,
  minSimilarity: 0.05,
  dispersion: 0.15,
  historicalError: 0.25,
  completeness: 0.05,
  fallback: 0.15,
  dataAge: 0.03,
  targetQuality: 0.02,
} as const;

/*
 * NÍVEIS. Dois critérios têm de se verificar ao mesmo tempo:
 *
 *  1. o SCORE (cobertura e qualidade dos dados): HIGH >= 70, MEDIUM >= 45;
 *  2. o ERRO HISTÓRICO do segmento (mediana do erro percentual absoluto no
 *     backtest): HIGH exige <= 12%, MEDIUM exige <= 30%; acima de 30% ou
 *     sem histórico o nível é LOW.
 *
 * Porque o critério 2 existe: no backtest da carteira o score sozinho dava
 * HIGH a 75% das estimativas, mas o erro mediano ronda 22% e o P90 40%.
 * Muitos comparáveis bem descritos não tornam o preço mais previsível se os
 * fatores que realmente o determinam (sinistralidade, bónus-malus, valor
 * comercial, potência, carta) não existem no histórico. Uma estimativa que
 * historicamente falha ~1/5 do valor não pode chamar-se "confiança alta".
 * 12% e 30% são limites de negócio (um erro típico de 12% cabe numa
 * negociação; 30% já muda a decisão do cliente), não estatísticos.
 */
export const CONFIDENCE_HIGH_MIN = 70;
export const CONFIDENCE_MEDIUM_MIN = 45;
export const HIGH_MAX_MEDIAN_APE = 0.12;
export const MEDIUM_MAX_MEDIAN_APE = 0.3;

export type ConfidenceInputs = {
  effectiveSampleSize: number;
  meanSimilarity: number;
  minSimilarity: number;

  /** Dispersão relativa dos prémios comparáveis (null = desconhecida). */
  dispersion: number | null;

  /** Mediana do erro percentual absoluto do segmento (null = sem histórico). */
  historicalMedianApe: number | null;

  /** 0..1, média da completude dos comparáveis. */
  completeness: number;

  fallbackLevel: FallbackLevel;

  /** Dias desde o último sync da carteira (dados desatualizados). */
  dataAgeDays: number | null;

  /** Idade média (dias, ponderada) das observações dos comparáveis. */
  observationAgeDays: number | null;

  /** Fração (0..1) dos comparáveis com target confirmado por recibos. */
  confirmedTargetShare: number;
};

export type ConfidenceResult = {
  /** 0..100. */
  score: number;
  level: ConfidenceLevel;
  components: Record<keyof typeof CONFIDENCE_WEIGHTS, number>;

  /** Regra que limitou o nível, se alguma. */
  cap: string | null;
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const FALLBACK_COMPONENT: Record<FallbackLevel, number> = {
  0: 1,
  1: 0.75,
  2: 0.5,
  3: 0.25,
  4: 0,
};

export function calculateConfidence(input: ConfidenceInputs): ConfidenceResult {
  const components: ConfidenceResult["components"] = {
    // ESS >= 15 dá erro-padrão da estimativa pequeno face à dispersão típica.
    sampleSize: clamp01(input.effectiveSampleSize / 15),
    similarity: clamp01((input.meanSimilarity - 0.4) / 0.5),
    minSimilarity: clamp01((input.minSimilarity - 0.2) / 0.5),
    dispersion:
      input.dispersion === null ? 0.3 : 1 - clamp01(input.dispersion / 0.35),
    // Sem erro histórico não se pode afirmar precisão: valor neutro-baixo.
    historicalError:
      input.historicalMedianApe === null
        ? 0.2
        : 1 - clamp01((input.historicalMedianApe - 0.1) / 0.25),
    completeness: clamp01(input.completeness),
    fallback: FALLBACK_COMPONENT[input.fallbackLevel],
    // Pior de dois: a carteira estar desatualizada (sync) OU os melhores
    // comparáveis serem antigos (até 1 ano = 1; 3 anos ou mais = 0).
    dataAge: Math.min(
      input.dataAgeDays === null
        ? 0.5
        : 1 - clamp01((input.dataAgeDays - 45) / 320),
      input.observationAgeDays === null
        ? 0.5
        : 1 - clamp01((input.observationAgeDays - 365) / 730),
    ),
    targetQuality: clamp01(input.confirmedTargetShare),
  };

  const score =
    100 *
    (Object.keys(CONFIDENCE_WEIGHTS) as (keyof typeof CONFIDENCE_WEIGHTS)[]).reduce(
      (sum, key) => sum + CONFIDENCE_WEIGHTS[key] * components[key],
      0,
    );

  let level: ConfidenceLevel =
    score >= CONFIDENCE_HIGH_MIN
      ? "HIGH"
      : score >= CONFIDENCE_MEDIUM_MIN
        ? "MEDIUM"
        : "LOW";

  // Regras duras: um fallback largo ou uma amostra efetiva minúscula
  // nunca dão confiança acima de LOW, qualquer que seja o resto.
  let cap: string | null = null;

  if (input.fallbackLevel >= 3) {
    cap = "Comparáveis só de tier vizinho ou da carteira completa.";
  } else if (input.effectiveSampleSize < 5) {
    cap = "Amostra efetiva inferior a 5 apólices.";
  } else if (input.historicalMedianApe === null) {
    cap = "Sem erro histórico para este tipo de cobertura.";
  }

  if (cap !== null && level !== "LOW") {
    level = "LOW";
  }

  // Teto pelo erro histórico (critério 2 acima).
  const historicalError = input.historicalMedianApe;

  if (level === "HIGH" && historicalError !== null && historicalError > HIGH_MAX_MEDIAN_APE) {
    level = "MEDIUM";
    cap ??= `Erro histórico típico de ${(historicalError * 100).toFixed(0)}% (> ${(HIGH_MAX_MEDIAN_APE * 100).toFixed(0)}%).`;
  }

  if (level === "MEDIUM" && historicalError !== null && historicalError > MEDIUM_MAX_MEDIAN_APE) {
    level = "LOW";
    cap = `Erro histórico típico de ${(historicalError * 100).toFixed(0)}% (> ${(MEDIUM_MAX_MEDIAN_APE * 100).toFixed(0)}%).`;
  }

  return { score: Math.round(score * 10) / 10, level, components, cap };
}

// ---------- avaliação completa de uma estimativa ----------

export type EstimateAssessment = {
  pointEstimate: number;
  interval: PriceInterval;
  confidence: ConfidenceResult;

  /** Erro histórico do segmento usado no intervalo (null = sem histórico). */
  historicalError: SegmentError | null;

  selection: Selection;
  estimate: EstimateResult;

  completeness: number;
  confirmedTargetShare: number;
  dataAgeDays: number | null;
  observationAgeDays: number | null;
};

function newestSyncAgeDays(
  pool: readonly ZurichHistoricalFeatures[],
  now: Date,
): number | null {
  let newest: number | null = null;

  for (const policy of pool) {
    const time = policy.lastSyncedAt ? Date.parse(policy.lastSyncedAt) : NaN;

    if (!Number.isNaN(time) && (newest === null || time > newest)) {
      newest = time;
    }
  }

  return newest === null
    ? null
    : Math.max(0, Math.floor((now.getTime() - newest) / 86_400_000));
}

/**
 * Estimativa + intervalo + confiança para um pedido. Pura: o erro
 * histórico (`calibration`) vem de fora (calculado uma vez por snapshot).
 * null se não for possível estimar.
 */
export function assessEstimate(
  request: RequestFeatures,
  pool: readonly ZurichHistoricalFeatures[],
  config: EstimatorConfig,
  calibration: Calibration | null,
  now: Date = new Date(),
): EstimateAssessment | null {
  const result = estimatePremium(request, pool, config);

  if (!result) {
    return null;
  }

  const { selection, estimate } = result;

  const totalWeight = selection.comparables.reduce(
    (sum, match) => sum + match.weight,
    0,
  );
  const weightedShare = (predicate: (m: (typeof selection.comparables)[number]) => number) =>
    totalWeight === 0
      ? 0
      : selection.comparables.reduce(
          (sum, match) => sum + predicate(match) * match.weight,
          0,
        ) / totalWeight;

  const completeness = weightedShare((m) => m.policy.metadataCompleteness);
  const confirmedTargetShare = weightedShare((m) =>
    m.policy.target.confidence === "CONFIRMED" ? 1 : 0,
  );
  const dataAgeDays = newestSyncAgeDays(pool, now);

  const dated = selection.comparables.filter(
    (m) => m.policy.ageOfObservationDays !== null,
  );
  const datedWeight = dated.reduce((sum, m) => sum + m.weight, 0);
  const observationAgeDays =
    datedWeight === 0
      ? null
      : dated.reduce(
          (sum, m) => sum + (m.policy.ageOfObservationDays as number) * m.weight,
          0,
        ) / datedWeight;

  const { interval, error } = calculateUncertainty(
    estimate.pointEstimate,
    calibration,
    request.coverageTier,
  );

  const confidence = calculateConfidence({
    effectiveSampleSize: estimate.effectiveSampleSize,
    meanSimilarity: estimate.meanSimilarity,
    minSimilarity: estimate.minSimilarity,
    dispersion: estimate.dispersion,
    historicalMedianApe: error?.medianApe ?? null,
    completeness,
    fallbackLevel: selection.fallbackLevel,
    dataAgeDays,
    observationAgeDays,
    confirmedTargetShare,
  });

  return {
    pointEstimate: estimate.pointEstimate,
    interval,
    confidence,
    historicalError: error,
    selection,
    estimate,
    completeness,
    confirmedTargetShare,
    dataAgeDays,
    observationAgeDays,
  };
}
