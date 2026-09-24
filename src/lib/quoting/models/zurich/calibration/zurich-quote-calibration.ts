import type {
  CalibrationConfigMode,
  CalibrationMode,
  ConfidenceLevel,
  EstimateCalibration,
  QuoteRequest,
} from "../../../domain/types";
import type { CalibrationRow } from "../../../observations/types";
import {
  effectiveSampleSize,
  trimmedWeightedMean,
  weightedMean,
  weightedMedian,
  type WeightedValue,
} from "../weighted-stats";
import { quantile } from "../zurich-auto-validation";
import {
  BASIS_WEIGHT,
  HIGH_MAX_DISPERSION,
  HIGH_MIN_MEAN_SIMILARITY,
  HIGH_SAMPLE_MULTIPLIER,
  KERNEL_POWER,
  LICENCE_BANDS,
  MAX_HEADLINE_FACTOR,
  MAX_NEAREST_QUOTES,
  MAX_REDUNDANCY_COMPARISONS,
  MAX_PRODUCTION_FACTOR,
  MEDIAN_MIN_EFFECTIVE_SIZE,
  MEDIUM_MAX_DISPERSION,
  MIN_GLOBAL_QUOTES_FOR_PRODUCTION,
  MIN_NEAREST_QUOTES_FOR_PRODUCTION,
  MIN_QUOTES_FOR_EXPERIMENT,
  MIN_SEGMENT_QUOTES_FOR_PRODUCTION,
  MIN_SIMILARITY_FOR_NEAREST,
  PRODUCTION_BASES,
  REDUNDANCY_PRICE_SCALE,
  SEGMENT_MAX_AGE_DIFFERENCE,
  SHRINKAGE_K,
  TRIMMED_MIN_EFFECTIVE_SIZE,
  ZURICH_CALIBRATION_MODE,
} from "./config";
import {
  extractCalibrationTarget,
  toCalibrationObservation,
  type CalibrationObservation,
  type CalibrationTarget,
} from "./observation-features";
import {
  calculateRealQuoteSimilarity,
  recencyWeight,
  type RealQuoteSimilarity,
} from "./similarity";
import { ZURICH_CALIBRATION_VERSION } from "./version";

/*
 * CALIBRAÇÃO com cotações reais Zurich.
 *
 *   estimativa histórica base  +  correção aprendida  =  estimativa calibrada
 *
 * ALGORITMO (transparente, sem caixa-preta)
 *
 * 1. Só observações VALID. Cada uma dá um RESÍDUO = real - estimativa base.
 *    O resíduo em euros vê-se nos diagnósticos, mas a correção aplica-se em
 *    escala MULTIPLICATIVA (log da razão real/base): um erro de +900 EUR sobre
 *    uma base de 360 EUR não se soma a uma base de 3000 EUR; o erro do modelo
 *    é proporcional (~20% no backtest histórico).
 *
 * 2. Elegibilidade: mesma versão do modelo (o resíduo mede-se contra ESSA
 *    estimativa base; misturar versões contaminaria a correção) e base do
 *    preço comparável (ANNUAL/TOTAL; UNKNOWN só no modo experimental, com peso
 *    reduzido; INSTALLMENT/COMMERCIAL excluídas).
 *
 * 3. Estratégia progressiva (a primeira que atinge o mínimo de PRODUÇÃO; se
 *    nenhuma o atinge, a mais específica com pelo menos 1 cotação, e então a
 *    calibração é EXPERIMENTAL):
 *      NEAREST_QUOTES  mesmo tier e similaridade >= MIN_SIMILARITY_FOR_NEAREST
 *      SEGMENT         mesmo tier, idade próxima, mesma faixa de anos de carta
 *                      e mesmo uso
 *      GLOBAL          todas as elegíveis (qualquer tier): viés global
 *      NONE            sem cotações utilizáveis: nada se calcula
 *    Cobertura incompatível NUNCA calibra NEAREST/SEGMENT (RC vs danos próprios
 *    são preços de natureza diferente).
 *
 * 4. Resíduo estimado por média / mediana / média aparada ponderadas por
 *    similaridade^2 x recência x base do preço. Usa-se a mediana com amostra
 *    efetiva >= 3 e a aparada com >= 8; abaixo de 3 só há média (com 2 pontos
 *    não existe robustez: diz-se). Um valor absurdo isolado não domina.
 *
 * 5. Dois valores, sempre separados:
 *      calibratedEstimate      BRUTO: o que os dados apontam, sem limites
 *      productionSafeEstimate  correção encolhida por n/(n+K) e limitada a x2
 *    O bruto nunca se esconde; só o "safe" é candidato a produção.
 *
 * 6. Observações quase iguais (mesmo perfil, mesmo preço real) valem quase
 *    como uma: a amostra efetiva e os mínimos de produção contam observações
 *    INDEPENDENTES (ver independentCount), nunca linhas.
 *
 * 7. O que vai para o preço principal depende do modo (config.ts):
 *      PRODUCTION  o `productionSafeEstimate`, SÓ com amostra independente e
 *                  confiança suficientes.
 *      EXPERIMENTAL / DISABLED  nada se aplica: o pointEstimate é a base.
 */

const MODE_LABEL: Record<Exclude<CalibrationMode, "NONE">, string> = {
  NEAREST_QUOTES: "Cotações reais mais parecidas",
  SEGMENT: "Segmento comparável",
  GLOBAL: "Viés global",
};

const REQUIRED_FOR_PRODUCTION: Record<Exclude<CalibrationMode, "NONE">, number> = {
  NEAREST_QUOTES: MIN_NEAREST_QUOTES_FOR_PRODUCTION,
  SEGMENT: MIN_SEGMENT_QUOTES_FOR_PRODUCTION,
  GLOBAL: MIN_GLOBAL_QUOTES_FOR_PRODUCTION,
};

type Prepared = {
  observation: CalibrationObservation;
  similarity: RealQuoteSimilarity;
  recency: number;
  basisWeight: number;

  /** ln(real / base). */
  logResidual: number;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

function isProductionBasis(observation: CalibrationObservation): boolean {
  return PRODUCTION_BASES.includes(observation.basis);
}

function licenceBand(years: number | null): number | null {
  if (years === null) return null;

  const index = LICENCE_BANDS.findIndex((limit) => years < limit);

  return index === -1 ? LICENCE_BANDS.length : index;
}

/** Mesmo segmento: idade próxima, mesma faixa de carta, mesmo uso (só onde o pedido sabe). */
function inSegment(target: CalibrationTarget, observation: CalibrationObservation): boolean {
  if (
    target.ageYears !== null &&
    (observation.ageYears === null ||
      Math.abs(target.ageYears - observation.ageYears) > SEGMENT_MAX_AGE_DIFFERENCE)
  ) {
    return false;
  }

  if (
    target.licenceYears !== null &&
    licenceBand(target.licenceYears) !== licenceBand(observation.licenceYears)
  ) {
    return false;
  }

  if (target.usage !== null && observation.usage !== target.usage) {
    return false;
  }

  return true;
}

// ---------- estatísticas de diagnóstico ----------

type ResidualStats = {
  globalBias: number | null;
  medianResidual: number | null;
  meanAbsoluteError: number | null;
  residualPercentiles: { p10: number; p50: number; p90: number } | null;
};

function residualStats(observations: readonly CalibrationObservation[]): ResidualStats {
  if (observations.length === 0) {
    return { globalBias: null, medianResidual: null, meanAbsoluteError: null, residualPercentiles: null };
  }

  const euros = observations.map((o) => o.realAmount - o.baseEstimate);
  const relative = observations.map((o) => o.realAmount / o.baseEstimate - 1);

  const p10 = quantile(relative, 0.1);
  const p50 = quantile(relative, 0.5);
  const p90 = quantile(relative, 0.9);

  return {
    globalBias: euros.reduce((sum, v) => sum + v, 0) / euros.length,
    medianResidual: quantile(euros, 0.5),
    meanAbsoluteError: euros.reduce((sum, v) => sum + Math.abs(v), 0) / euros.length,
    // Com menos de 3 pontos não há distribuição a mostrar.
    residualPercentiles:
      observations.length >= 3 && p10 !== null && p50 !== null && p90 !== null
        ? { p10, p50, p90 }
        : null,
  };
}

type Classified = {
  totalValid: number;
  usable: CalibrationObservation[];
  rejected: EstimateCalibration["diagnostics"]["rejected"];
};

/** Observações VALID elegíveis (versão do modelo e base do preço), com a contagem dos descartes. */
function classify(rows: readonly CalibrationRow[], modelVersion: string): Classified {
  const rejected = { modelVersion: 0, basis: 0, tier: 0, invalid: 0, retroactive: 0 };
  const usable: CalibrationObservation[] = [];
  let totalValid = 0;

  for (const row of rows) {
    if (row.status !== "VALID") continue;

    totalValid += 1;

    // Recalculado a partir de uma apólice já emitida (leave-one-out), não uma
    // cotação vista por um agente: nunca calibra o valor principal (ver
    // retroactive-backfill.ts). Fica de fora ANTES de qualquer outra checagem.
    if (row.source === "RETROACTIVE_PORTFOLIO") {
      rejected.retroactive += 1;
      continue;
    }

    const observation = toCalibrationObservation(row);

    if (!observation || BASIS_WEIGHT[observation.basis] === undefined) {
      rejected.invalid += 1;
      continue;
    }

    if (observation.modelVersion !== modelVersion) {
      rejected.modelVersion += 1;
      continue;
    }

    if (BASIS_WEIGHT[observation.basis] <= 0) {
      rejected.basis += 1;
      continue;
    }

    usable.push(observation);
  }

  return { totalValid, usable, rejected };
}

// ---------- resíduo robusto ----------

type ResidualEstimate = {
  value: number;
  robustness: "NONE" | "MEDIAN" | "TRIMMED";
  mean: number;
  median: number;
  trimmed: number;
  effectiveSize: number;
  dispersion: number | null;
};

/**
 * `effective` é a amostra efetiva já descontada da redundância (ver
 * calibrateZurichEstimate); decide a robustez e se há dispersão a afirmar.
 */
function estimateResidual(
  items: readonly WeightedValue[],
  effective: number,
): ResidualEstimate | null {
  const mean = weightedMean(items);
  const median = weightedMedian(items);

  if (mean === null || median === null) return null;

  const trimmed = trimmedWeightedMean(items, 0.1, TRIMMED_MIN_EFFECTIVE_SIZE) ?? mean;

  const robustness =
    effective >= TRIMMED_MIN_EFFECTIVE_SIZE
      ? "TRIMMED"
      : effective >= MEDIAN_MIN_EFFECTIVE_SIZE
        ? "MEDIAN"
        : "NONE";

  // Dispersão: desvio absoluto mediano em log (~ erro relativo típico). Com
  // menos de 3 pontos não há dispersão que se possa afirmar.
  const dispersion =
    items.length >= MEDIAN_MIN_EFFECTIVE_SIZE && effective >= MEDIAN_MIN_EFFECTIVE_SIZE
      ? weightedMedian(
          items.map((item) => ({
            value: Math.abs(item.value - median),
            weight: item.weight,
          })),
        )
      : null;

  return {
    value: robustness === "TRIMMED" ? trimmed : robustness === "MEDIAN" ? median : mean,
    robustness,
    mean,
    median,
    trimmed,
    effectiveSize: effective,
    dispersion,
  };
}

function confidenceOf(params: {
  mode: Exclude<CalibrationMode, "NONE">;
  productionCount: number;
  effectiveSize: number;
  dispersion: number | null;
  meanSimilarity: number | null;
}): ConfidenceLevel {
  const required = REQUIRED_FOR_PRODUCTION[params.mode];

  const meetsProduction =
    params.productionCount >= required &&
    params.effectiveSize >= MEDIAN_MIN_EFFECTIVE_SIZE &&
    params.dispersion !== null &&
    params.dispersion <= MEDIUM_MAX_DISPERSION;

  if (!meetsProduction) return "LOW";

  const high =
    params.productionCount >= HIGH_SAMPLE_MULTIPLIER * required &&
    (params.dispersion as number) <= HIGH_MAX_DISPERSION &&
    (params.mode === "GLOBAL" ||
      (params.meanSimilarity !== null && params.meanSimilarity >= HIGH_MIN_MEAN_SIMILARITY));

  return high ? "HIGH" : "MEDIUM";
}

// ---------- redundância ----------

/**
 * Quanto uma observação repete outra: 0 (independentes) a 1 (a mesma).
 * Tiers diferentes nunca se repetem. Similaridade do perfil x concordância do
 * preço real (a ±2%, em log): dois clientes parecidos com preços diferentes
 * não são redundantes; a mesma cotação repetida com o mesmo preço é.
 */
export function redundancyBetween(
  a: CalibrationObservation,
  b: CalibrationObservation,
): number {
  if (a.tier !== b.tier) return 0;

  const profile = calculateRealQuoteSimilarity(a, b).score;
  const price = Math.exp(
    -Math.abs(Math.log(a.realAmount / b.realAmount)) / REDUNDANCY_PRICE_SCALE,
  );

  return profile * price;
}

/** c_i = 1 + soma da redundância de i com as outras (>= 1). */
function redundancyTotals(observations: readonly CalibrationObservation[]): number[] {
  const n = observations.length;
  const totals = new Array<number>(n).fill(1);

  if (n <= 1 || n > MAX_REDUNDANCY_COMPARISONS) return totals;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const redundancy = redundancyBetween(observations[i], observations[j]);

      totals[i] += redundancy;
      totals[j] += redundancy;
    }
  }

  return totals;
}

/**
 * Nº de observações INDEPENDENTES: soma de 1/c_i. Duas iguais dão 1; n
 * independentes dão n. As cotações redundantes não se apagam: só deixam de
 * contar em duplicado.
 */
export function independentCount(observations: readonly CalibrationObservation[]): number {
  return redundancyTotals(observations).reduce((sum, total) => sum + 1 / total, 0);
}

// ---------- API ----------

export type CalibrateZurichEstimateParams = {
  request: QuoteRequest;

  /** O pointEstimate BASE do modelo (sem calibração). */
  baseEstimate: number;

  /** O intervalo BASE do modelo (para o guardar junto da base). */
  baseRange?: { min: number; max: number } | null;

  /** Versão do modelo que produziu a estimativa base. */
  modelVersion: string;

  observations: readonly CalibrationRow[];

  now?: Date;
  configMode?: CalibrationConfigMode;
};

function emptyCalibration(
  params: {
    baseEstimate: number;
    baseRange: { min: number; max: number } | null;
    modelVersion: string;
    configMode: CalibrationConfigMode;
    reason: string;
    totalValid: number;
    rejected: EstimateCalibration["diagnostics"]["rejected"];
    stats: ResidualStats;
  },
): EstimateCalibration {
  return {
    version: ZURICH_CALIBRATION_VERSION,
    configMode: params.configMode,
    mode: "NONE",
    experimental: true,
    applied: false,
    eligibleForProduction: false,
    baseEstimate: params.baseEstimate,
    baseRange: params.baseRange,
    calibratedEstimate: params.baseEstimate,
    headlineEstimate: null,
    productionSafeEstimate: params.baseEstimate,
    clamped: false,
    adjustment: { amount: 0, percent: null },
    sampleSize: 0,
    productionSampleSize: 0,
    effectiveSampleSize: null,
    confidence: "LOW",
    reason: params.reason,
    modelVersion: params.modelVersion,
    diagnostics: {
      totalValidObservations: params.totalValid,
      consideredObservations: 0,
      rejected: params.rejected,
      ...params.stats,
      weightedResidual: null,
      meanSimilarity: null,
      independentObservations: null,
      independentProductionObservations: null,
      robustness: "NONE",
      methods: { weightedMean: null, weightedMedian: null, trimmedMean: null },
      requiredForProduction: null,
    },
  };
}

/**
 * Calibra uma estimativa histórica com cotações reais. PURA: as observações
 * vêm de fora (ver service.ts). Nunca altera `baseEstimate`.
 */
export function calibrateZurichEstimate(
  params: CalibrateZurichEstimateParams,
): EstimateCalibration {
  const configMode = params.configMode ?? ZURICH_CALIBRATION_MODE;
  const now = params.now ?? new Date();
  const base = params.baseEstimate;
  const baseRange = params.baseRange ?? null;
  const noStats: ResidualStats = {
    globalBias: null,
    medianResidual: null,
    meanAbsoluteError: null,
    residualPercentiles: null,
  };
  const noRejections = { modelVersion: 0, basis: 0, tier: 0, invalid: 0, retroactive: 0 };

  if (configMode === "DISABLED") {
    return emptyCalibration({
      baseEstimate: base,
      baseRange,
      modelVersion: params.modelVersion,
      configMode,
      reason: "Calibração desativada.",
      totalValid: 0,
      rejected: noRejections,
      stats: noStats,
    });
  }

  if (!Number.isFinite(base) || base <= 0) {
    return emptyCalibration({
      baseEstimate: Number.isFinite(base) ? base : 0,
      baseRange,
      modelVersion: params.modelVersion,
      configMode,
      reason: "Estimativa base inválida: não é possível calibrar.",
      totalValid: 0,
      rejected: noRejections,
      stats: noStats,
    });
  }

  const target = extractCalibrationTarget(params.request, now);
  const { totalValid, usable, rejected } = classify(params.observations, params.modelVersion);
  const stats = residualStats(usable);

  const nowMs = now.getTime();

  const prepared: Prepared[] = usable.map((observation) => ({
    observation,
    similarity: calculateRealQuoteSimilarity(target, observation),
    recency: recencyWeight(observation.quotedAtMs, nowMs),
    basisWeight: BASIS_WEIGHT[observation.basis],
    logResidual: Math.log(observation.realAmount / observation.baseEstimate),
  }));

  // Cobertura incompatível nunca calibra NEAREST/SEGMENT.
  const sameTier = prepared.filter(
    (item) => item.observation.tier !== "" && item.observation.tier === target.tier,
  );

  rejected.tier = prepared.length - sameTier.length;

  const nearest = sameTier
    .filter((item) => item.similarity.score >= MIN_SIMILARITY_FOR_NEAREST)
    .sort((a, b) => b.similarity.score - a.similarity.score)
    .slice(0, MAX_NEAREST_QUOTES);
  const segment = sameTier.filter((item) => inSegment(target, item.observation));

  const candidates: { mode: Exclude<CalibrationMode, "NONE">; set: Prepared[] }[] = [
    { mode: "NEAREST_QUOTES", set: nearest },
    { mode: "SEGMENT", set: segment },
    { mode: "GLOBAL", set: prepared },
  ];

  // Os mínimos de produção contam observações INDEPENDENTES com base ANNUAL/TOTAL:
  // cinco linhas do mesmo perfil e do mesmo preço são uma evidência, não cinco.
  const productionObservations = (set: readonly Prepared[]) =>
    set.filter((item) => isProductionBasis(item.observation)).map((item) => item.observation);
  const independentProduction = (set: readonly Prepared[]) =>
    independentCount(productionObservations(set));

  const chosen =
    candidates.find(
      (candidate) =>
        independentProduction(candidate.set) >= REQUIRED_FOR_PRODUCTION[candidate.mode],
    ) ??
    candidates.find((candidate) => candidate.set.length >= MIN_QUOTES_FOR_EXPERIMENT) ??
    null;

  if (!chosen) {
    return emptyCalibration({
      baseEstimate: base,
      baseRange,
      modelVersion: params.modelVersion,
      configMode,
      reason:
        totalValid === 0
          ? "Ainda não existem cotações reais suficientes."
          : "Nenhuma cotação real é comparável com este pedido (versão do modelo, base do preço ou tipo de cobertura).",
      totalValid,
      rejected,
      stats,
    });
  }

  const { mode, set } = chosen;

  // Redundância dentro do conjunto escolhido: cada observação pesa 1/c_i.
  const totals = redundancyTotals(set.map((item) => item.observation));
  const independent = totals.reduce((sum, total) => sum + 1 / total, 0);

  const weighted = set
    .map((item, index) => {
      const own =
        (mode === "GLOBAL" ? 1 : item.similarity.score ** KERNEL_POWER) *
        item.recency *
        item.basisWeight;

      return { item, weight: own, adjusted: own / totals[index] };
    })
    .filter((entry) => entry.weight > 0);

  const items: WeightedValue[] = weighted.map((entry) => ({
    value: entry.item.logResidual,
    weight: entry.adjusted,
  }));

  // Amostra efetiva = concentração de pesos (Kish) x fração independente.
  const effective =
    effectiveSampleSize(weighted.map((entry) => entry.weight)) *
    Math.min(1, independent / set.length);

  const residual = estimateResidual(items, effective);

  if (!residual) {
    return emptyCalibration({
      baseEstimate: base,
      baseRange,
      modelVersion: params.modelVersion,
      configMode,
      reason: "As cotações reais comparáveis têm peso nulo: não é possível calibrar.",
      totalValid,
      rejected,
      stats,
    });
  }

  const totalWeight = weighted.reduce((sum, entry) => sum + entry.adjusted, 0);
  const meanSimilarity =
    totalWeight === 0
      ? null
      : weighted.reduce((sum, entry) => sum + entry.item.similarity.score * entry.adjusted, 0) /
        totalWeight;

  const required = REQUIRED_FOR_PRODUCTION[mode];
  const productionSampleSize = productionObservations(set).length;
  const independentProductionSize = independentProduction(set);

  const confidence = confidenceOf({
    mode,
    productionCount: independentProductionSize,
    effectiveSize: residual.effectiveSize,
    dispersion: residual.dispersion,
    meanSimilarity,
  });

  // Elegível = amostra INDEPENDENTE e qualidade suficientes (nunca só por a config o pedir).
  const eligibleForProduction =
    independentProductionSize >= required && confidence !== "LOW";

  const applied = configMode === "PRODUCTION" && eligibleForProduction;

  const raw = base * Math.exp(residual.value);

  // Valor principal a apresentar: sempre que há qualquer cotação real utilizável
  // (por decisão explícita: nunca mostrar a estimativa histórica como principal
  // quando existe pelo menos uma cotação real, mesmo vindo do viés GLOBAL entre
  // tipos de cobertura diferentes), e se a calibração ainda não alterou o
  // pointEstimate (PRODUCTION já o faz). `mode` nunca é "NONE" aqui (esse caso
  // devolve-se mais acima, em emptyCalibration, sem chegar a este ponto).
  const headlineLimit = Math.log(MAX_HEADLINE_FACTOR);
  const headlineAllowed = !applied;
  const headlineClamped = headlineAllowed && Math.abs(residual.value) > headlineLimit;
  const headline = headlineAllowed
    ? base * Math.exp(Math.max(-headlineLimit, Math.min(headlineLimit, residual.value)))
    : null;

  const shrink = residual.effectiveSize / (residual.effectiveSize + SHRINKAGE_K);
  const shrunk = residual.value * shrink;
  const limit = Math.log(MAX_PRODUCTION_FACTOR);
  const clamped = Math.abs(shrunk) > limit;
  const safe = base * Math.exp(Math.max(-limit, Math.min(limit, shrunk)));

  const reasons = [
    `${MODE_LABEL[mode]}: ${set.length} ${set.length === 1 ? "cotação real" : "cotações reais"} (≈ ${independent.toFixed(1)} independentes; ${productionSampleSize} com base ANNUAL/TOTAL).`,
  ];

  if (independent < set.length - 0.5) {
    reasons.push("Há cotações praticamente iguais (mesmo perfil e preço real): contam quase como uma.");
  }

  if (set.some((item) => item.observation.basis === "UNKNOWN")) {
    reasons.push("Inclui cotações com base do preço UNKNOWN, com peso reduzido e sem contar para produção.");
  }

  if (residual.robustness === "NONE") {
    reasons.push("Amostra efetiva inferior a 3: sem robustez estatística possível.");
  }

  if (applied) {
    reasons.push("Calibração aplicada (valor com encolhimento e limite de segurança).");
  } else if (independentProductionSize < required) {
    reasons.push(
      `Amostra insuficiente para produção (${independentProductionSize.toFixed(1)} de ${required} observações independentes com base ANNUAL/TOTAL).`,
    );
  } else if (confidence === "LOW") {
    reasons.push("Confiança da calibração baixa: não elegível para produção.");
  } else {
    reasons.push("Amostra suficiente, mas o modo é EXPERIMENTAL: não altera o preço principal.");
  }

  if (headline !== null) {
    reasons.push(
      mode === "GLOBAL"
        ? "Mostrada como valor principal (Calibração com cotações reais), a partir do viés global: não há cotações reais deste tipo de cobertura, usou-se o desvio médio de outros tipos. A estimativa histórica base continua registada e inalterada."
        : "Mostrada como valor principal (Calibração com cotações reais); a estimativa histórica base continua registada e inalterada.",
    );

    if (headlineClamped) {
      reasons.push(`Valor principal limitado a x${MAX_HEADLINE_FACTOR} da base pelo teto de sanidade.`);
    }
  }

  return {
    version: ZURICH_CALIBRATION_VERSION,
    configMode,
    mode,
    experimental: !applied,
    applied,
    eligibleForProduction,
    baseEstimate: round2(base),
    baseRange,
    calibratedEstimate: round2(raw),
    headlineEstimate: headline === null ? null : round2(headline),
    productionSafeEstimate: round2(safe),
    clamped,
    adjustment: { amount: round2(raw - base), percent: raw / base - 1 },
    sampleSize: set.length,
    productionSampleSize,
    effectiveSampleSize: residual.effectiveSize,
    confidence,
    reason: reasons.join(" "),
    modelVersion: params.modelVersion,
    diagnostics: {
      totalValidObservations: totalValid,
      consideredObservations: set.length,
      rejected,
      ...stats,
      weightedResidual: Math.exp(residual.value) - 1,
      meanSimilarity,
      independentObservations: independent,
      independentProductionObservations: independentProductionSize,
      robustness: residual.robustness,
      methods: {
        weightedMean: Math.exp(residual.mean) - 1,
        weightedMedian: Math.exp(residual.median) - 1,
        trimmedMean: Math.exp(residual.trimmed) - 1,
      },
      requiredForProduction: required,
    },
  };
}

// ---------- aplicação ao resultado (só em produção) ----------

export type EstimateWithRange = {
  pointEstimate: number;
  priceRange: { min: number; max: number };
};

/**
 * Aplica a calibração ao resultado SÓ se `calibration.applied` (modo
 * PRODUCTION e amostra independente elegível), com o `productionSafeEstimate`.
 * Caso contrário devolve a estimativa base intacta.
 * O intervalo escala com o mesmo fator, para continuar a conter a estimativa
 * e a refletir o erro relativo do modelo.
 */
export function applyCalibrationToEstimate(
  estimate: EstimateWithRange,
  calibration: EstimateCalibration | null | undefined,
): EstimateWithRange & { applied: boolean } {
  if (
    !calibration ||
    !calibration.applied ||
    calibration.configMode !== "PRODUCTION" ||
    // Defesa: a correção foi calculada sobre ESTA estimativa base?
    Math.abs(calibration.baseEstimate - estimate.pointEstimate) > 0.01 * estimate.pointEstimate
  ) {
    return { ...estimate, applied: false };
  }

  const factor = calibration.productionSafeEstimate / calibration.baseEstimate;

  return {
    pointEstimate: round2(estimate.pointEstimate * factor),
    priceRange: {
      min: round2(estimate.priceRange.min * factor),
      max: round2(estimate.priceRange.max * factor),
    },
    applied: true,
  };
}

// ---------- diagnóstico global (sem pedido) ----------

export type ObservationResidualSummary = {
  totalValidObservations: number;
  eligibleObservations: number;
  rejected: Omit<EstimateCalibration["diagnostics"]["rejected"], "tier">;
  byBasis: Record<string, number>;
} & ResidualStats;

/** Resumo dos resíduos das observações elegíveis (para a página de métricas). */
export function summarizeObservationResiduals(
  rows: readonly CalibrationRow[],
  modelVersion: string,
): ObservationResidualSummary {
  const { totalValid, usable, rejected } = classify(rows, modelVersion);
  const byBasis: Record<string, number> = {};

  for (const observation of usable) {
    byBasis[observation.basis] = (byBasis[observation.basis] ?? 0) + 1;
  }

  return {
    totalValidObservations: totalValid,
    eligibleObservations: usable.length,
    rejected: {
      modelVersion: rejected.modelVersion,
      basis: rejected.basis,
      invalid: rejected.invalid,
      retroactive: rejected.retroactive,
    },
    byBasis,
    ...residualStats(usable),
  };
}
