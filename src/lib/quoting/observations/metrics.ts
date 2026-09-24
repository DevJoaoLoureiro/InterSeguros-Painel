import { quantile } from "../models/zurich/zurich-auto-validation";
import { readCalibrationSnapshot } from "./calibration-snapshot";
import type { MetricsFilters, MetricsRow } from "./types";

/*
 * Métricas de exatidão do simulador contra cotações reais Zurich.
 *
 * DUAS saídas, NUNCA misturadas:
 *
 *   BASE        erro da estimativa histórica: estimated_premium (SEMPRE a
 *               base) contra o preço real. É o que as colunas geradas da BD
 *               (signed_error, absolute_error, relative_error) medem.
 *   CALIBRADA   erro da estimativa calibrada: prediction_snapshot.calibration
 *               .calibratedEstimate contra o mesmo preço real. Só entra quem
 *               tem esse valor válido; nunca há fallback para a base.
 *
 * Só contam observações com status = VALID. Convenção do erro:
 *   erro = estimado - real; negativo = SUBESTIMOU, positivo = SOBRESTIMOU.
 *
 * A comparação base vs calibrada usa APENAS as observações que têm as duas
 * (o mesmo conjunto nos dois lados), e o valor calibrado guardado é o que
 * existia no momento da cotação (sem incluir a própria observação): é uma
 * medição fora da amostra.
 */

export type DerivedErrors = {
  signed: number;
  absolute: number;
  relative: number;
};

/** Erros de uma observação; null se o valor real não for > 0 ou algum valor não for finito. */
export function deriveErrors(
  estimated: number,
  real: number,
): DerivedErrors | null {
  if (!Number.isFinite(estimated) || !Number.isFinite(real) || real <= 0) {
    return null;
  }

  const signed = estimated - real;

  return {
    signed,
    absolute: Math.abs(signed),
    relative: Math.abs(signed) / real,
  };
}

export type AccuracyMetrics = {
  count: number;

  /** Média do erro absoluto (€). */
  mae: number | null;
  medianAbsoluteError: number | null;
  rmse: number | null;

  /** Média de (estimado - real); negativo = subestima em média. */
  meanSignedError: number | null;

  /** Média do erro relativo absoluto (|erro| / real). */
  meanRelativeError: number | null;

  /** Média do erro relativo COM sinal ((estimado - real) / real). */
  meanSignedRelativeError: number | null;

  absErrorP50: number | null;
  absErrorP75: number | null;
  absErrorP90: number | null;
  absErrorP95: number | null;

  /** Fração (0..1) com estimado < real / estimado > real / exatamente igual. */
  underestimationRate: number | null;
  overestimationRate: number | null;
  exactRate: number | null;

  /** Fração (0..1) dentro de ±10% / ±20% do preço real: mais fácil de ler que MAE em euros. */
  within10PctRate: number | null;
  within20PctRate: number | null;

  /**
   * Rácio A/E (Actual/Expected = real ÷ estimado), como as seguradoras o
   * usam: 1 = certo; >1 = o modelo subestimou; <1 = sobrestimou. Média e
   * mediana (a média é sensível a um único caso muito errado).
   */
  meanActualToEstimatedRatio: number | null;
  medianActualToEstimatedRatio: number | null;
};

const EMPTY_METRICS: AccuracyMetrics = {
  count: 0,
  mae: null,
  medianAbsoluteError: null,
  rmse: null,
  meanSignedError: null,
  meanRelativeError: null,
  meanSignedRelativeError: null,
  absErrorP50: null,
  absErrorP75: null,
  absErrorP90: null,
  absErrorP95: null,
  underestimationRate: null,
  overestimationRate: null,
  exactRate: null,
  within10PctRate: null,
  within20PctRate: null,
  meanActualToEstimatedRatio: null,
  medianActualToEstimatedRatio: null,
};

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

type ErrorPoint = { signed: number; absolute: number; relative: number; real: number };

function pointOf(row: MetricsRow): ErrorPoint | null {
  const derived = deriveErrors(row.estimated_premium, row.real_quote_amount);

  if (!derived) return null;

  const signed = row.signed_error ?? derived.signed;
  const absolute = row.absolute_error ?? Math.abs(signed);
  const relative = row.relative_error ?? absolute / row.real_quote_amount;

  if (![signed, absolute, relative].every(Number.isFinite)) return null;

  return { signed, absolute, relative, real: row.real_quote_amount };
}

/**
 * Métricas BASE: usa estimated_premium (a estimativa base) e as colunas
 * geradas quando existem.
 */
export function computeAccuracyMetrics(rows: readonly MetricsRow[]): AccuracyMetrics {
  const points = rows
    .filter((row) => row.status === "VALID")
    .map(pointOf)
    .filter((point): point is ErrorPoint => point !== null);

  if (points.length === 0) return { ...EMPTY_METRICS };

  const absolute = points.map((point) => point.absolute);
  const count = points.length;

  // estimado = real + erro assinado (signed = estimado - real); evita
  // guardar mais um campo só para isto.
  const ratios = points
    .map((point) => point.real / (point.real + point.signed))
    .filter((ratio) => Number.isFinite(ratio) && ratio > 0);

  return {
    count,
    mae: mean(absolute),
    medianAbsoluteError: quantile(absolute, 0.5),
    rmse: Math.sqrt(mean(points.map((point) => point.signed ** 2))),
    meanSignedError: mean(points.map((point) => point.signed)),
    meanRelativeError: mean(points.map((point) => point.relative)),
    meanSignedRelativeError: mean(points.map((point) => point.signed / point.real)),
    absErrorP50: quantile(absolute, 0.5),
    absErrorP75: quantile(absolute, 0.75),
    absErrorP90: quantile(absolute, 0.9),
    absErrorP95: quantile(absolute, 0.95),
    underestimationRate: points.filter((point) => point.signed < 0).length / count,
    overestimationRate: points.filter((point) => point.signed > 0).length / count,
    exactRate: points.filter((point) => point.signed === 0).length / count,
    within10PctRate: points.filter((point) => point.relative <= 0.1).length / count,
    within20PctRate: points.filter((point) => point.relative <= 0.2).length / count,
    meanActualToEstimatedRatio: ratios.length > 0 ? mean(ratios) : null,
    medianActualToEstimatedRatio: ratios.length > 0 ? quantile(ratios, 0.5) : null,
  };
}

/**
 * A observação vista como se a estimativa fosse a CALIBRADA, ou null se não
 * tem calibratedEstimate válido. As colunas geradas (que medem a base) não se
 * reutilizam: o erro recalcula-se a partir do valor calibrado.
 */
export function asCalibratedRow(row: MetricsRow): MetricsRow | null {
  const snapshot = readCalibrationSnapshot(row.calibration);

  if (!snapshot || snapshot.calibratedEstimate === null) return null;

  return {
    ...row,
    estimated_premium: snapshot.calibratedEstimate,
    signed_error: null,
    absolute_error: null,
    relative_error: null,
  };
}

/** Métricas CALIBRADAS: só observações com calibratedEstimate válido. */
export function computeCalibratedMetrics(rows: readonly MetricsRow[]): AccuracyMetrics {
  return computeAccuracyMetrics(
    rows.map(asCalibratedRow).filter((row): row is MetricsRow => row !== null),
  );
}

// ---------- comparação base vs calibrada ----------

/** Nº mínimo de observações emparelhadas para a comparação deixar de ser só indicativa. */
export const MIN_COMPARISON_SAMPLE = 10;

export type CalibrationComparison = {
  /** Observações com valor calibrado válido (as mesmas nos dois lados). */
  pairedCount: number;

  /** Erro da estimativa BASE nessas mesmas observações. */
  base: AccuracyMetrics;

  /** Erro da estimativa CALIBRADA nessas observações. */
  calibrated: AccuracyMetrics;

  /**
   * Variação relativa do erro: (calibrada - base) / base. NEGATIVA = a
   * calibração REDUZIU o erro (ex.: -0,548 = -54,8%). null se a base for 0/desconhecida.
   */
  maeChange: number | null;
  medianAbsoluteErrorChange: number | null;
  rmseChange: number | null;
  p90Change: number | null;

  /** false = amostra insuficiente: os valores são só indicativos. */
  sufficient: boolean;
  minRequired: number;
};

function change(calibrated: number | null, base: number | null): number | null {
  return calibrated === null || base === null || base === 0
    ? null
    : (calibrated - base) / base;
}

export function compareBaseAndCalibrated(rows: readonly MetricsRow[]): CalibrationComparison {
  const paired = rows.filter(
    (row) => row.status === "VALID" && asCalibratedRow(row) !== null,
  );

  const base = computeAccuracyMetrics(paired);
  const calibrated = computeCalibratedMetrics(paired);

  return {
    pairedCount: calibrated.count,
    base,
    calibrated,
    maeChange: change(calibrated.mae, base.mae),
    medianAbsoluteErrorChange: change(calibrated.medianAbsoluteError, base.medianAbsoluteError),
    rmseChange: change(calibrated.rmse, base.rmse),
    p90Change: change(calibrated.absErrorP90, base.absErrorP90),
    sufficient: calibrated.count >= MIN_COMPARISON_SAMPLE,
    minRequired: MIN_COMPARISON_SAMPLE,
  };
}

// ---------- agrupamentos ----------

function groupBy(
  rows: readonly MetricsRow[],
  keyOf: (row: MetricsRow) => string,
): Record<string, AccuracyMetrics> {
  const groups = new Map<string, MetricsRow[]>();

  for (const row of rows) {
    const key = keyOf(row);

    (groups.get(key) ?? groups.set(key, []).get(key)!).push(row);
  }

  return Object.fromEntries(
    [...groups.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, items]) => [key, computeAccuracyMetrics(items)]),
  );
}

// ---------- a confiança significa alguma coisa? ----------

const CONFIDENCE_ORDER = ["LOW", "MEDIUM", "HIGH"] as const;

export type ConfidenceCalibration = {
  /** Uma linha por banda de confiança (LOW/MEDIUM/HIGH), na ordem certa. */
  byBand: { label: string; metrics: AccuracyMetrics }[];

  /**
   * true = as bandas estão na ordem esperada (LOW tem MedianAE maior que
   * MEDIUM, que tem maior que HIGH). false = a confiança NÃO prevê o erro
   * com estes dados; null = amostra insuficiente para dizer.
   */
  wellOrdered: boolean | null;
};

/**
 * A confiança (LOW/MEDIUM/HIGH) guardada em cada observação prevê mesmo o
 * erro? Só é possível responder com amostra: cada banda usa o seu próprio
 * MedianAE (mais robusto que MAE a um único caso extremo).
 */
export function computeConfidenceCalibration(
  rows: readonly MetricsRow[],
): ConfidenceCalibration {
  const byBand = CONFIDENCE_ORDER.map((label) => ({
    label,
    metrics: computeAccuracyMetrics(rows.filter((row) => row.confidence_label === label)),
  }));

  const known = byBand.filter((band) => band.metrics.medianAbsoluteError !== null);

  const wellOrdered =
    known.length < 2
      ? null
      : known.every(
          (band, index) =>
            index === 0 ||
            (known[index - 1].metrics.medianAbsoluteError as number) >=
              (band.metrics.medianAbsoluteError as number),
        );

  return { byBand, wellOrdered };
}

/** Uma "saída" do simulador: modelo base + calibração (ou a falta dela). */
export type OutputGroup = {
  modelVersion: string;

  /** null = sem snapshot de calibração. */
  calibrationVersion: string | null;
  calibrationMode: string | null;

  /** Ex.: "zurich-auto-v3 + sem calibração" / "zurich-auto-v3 + zurich-calibration-v1 (EXPERIMENTAL)". */
  label: string;

  base: AccuracyMetrics;

  /** null = nenhuma observação do grupo tem calibratedEstimate válido. */
  calibrated: AccuracyMetrics | null;
};

function outputKey(row: MetricsRow): {
  key: string;
  calibrationVersion: string | null;
  calibrationMode: string | null;
} {
  const snapshot = readCalibrationSnapshot(row.calibration);

  return {
    key: `${row.model_version}|${snapshot?.version ?? "-"}|${snapshot?.mode ?? "-"}`,
    calibrationVersion: snapshot?.version ?? null,
    calibrationMode: snapshot?.mode ?? null,
  };
}

function groupByOutput(rows: readonly MetricsRow[]): OutputGroup[] {
  const groups = new Map<string, { info: ReturnType<typeof outputKey>; modelVersion: string; rows: MetricsRow[] }>();

  for (const row of rows) {
    const info = outputKey(row);
    const existing = groups.get(info.key);

    if (existing) existing.rows.push(row);
    else groups.set(info.key, { info, modelVersion: row.model_version, rows: [row] });
  }

  return [...groups.values()]
    .sort((a, b) => (a.info.key < b.info.key ? -1 : a.info.key > b.info.key ? 1 : 0))
    .map(({ info, modelVersion, rows: items }) => {
      const calibrated = computeCalibratedMetrics(items);

      return {
        modelVersion,
        calibrationVersion: info.calibrationVersion,
        calibrationMode: info.calibrationMode,
        label:
          info.calibrationVersion === null
            ? `${modelVersion} + sem calibração`
            : `${modelVersion} + ${info.calibrationVersion} (${info.calibrationMode})`,
        base: computeAccuracyMetrics(items),
        calibrated: calibrated.count === 0 ? null : calibrated,
      };
    });
}

// ---------- relatório ----------

export type AccuracyReport = {
  filters: MetricsFilters;

  /**
   * Métricas da estimativa BASE do conjunto filtrado (estimated_premium
   * contra o preço real). NÃO inclui o efeito da calibração.
   */
  overall: AccuracyMetrics;

  /** Base vs calibrada nas observações que têm as duas. */
  calibration: CalibrationComparison;

  /** Uma linha por (versão do modelo base + calibração): nunca misturadas. */
  byOutput: OutputGroup[];

  /** Uma linha por versão do modelo base (métricas BASE), sem o filtro de versão. */
  byModelVersion: Record<string, AccuracyMetrics>;

  /** Quebras (métricas BASE) do conjunto filtrado. */
  byBasis: Record<string, AccuracyMetrics>;
  byCoverageTier: Record<string, AccuracyMetrics>;
  byProduct: Record<string, AccuracyMetrics>;

  /**
   * MANUAL_ENTRY (cotações genuínas, validação externa) vs
   * RETROACTIVE_PORTFOLIO (recalculado do histórico, é o próprio backtest).
   * Sem isto, uma carteira retroativa grande esconde o erro real: ver
   * warnings quando as duas aparecem misturadas no `overall`.
   */
  bySource: Record<string, AccuracyMetrics>;

  /** A confiança (LOW/MEDIUM/HIGH) prevê mesmo o erro, nestes dados? */
  confidenceCalibration: ConfidenceCalibration;

  warnings: string[];
};

/** Amostra abaixo da qual as métricas são só indicativas. */
export const SMALL_SAMPLE = 30;

const COMPARABLE_BASES = ["ANNUAL", "TOTAL"];

/** Valor de filtro que seleciona as observações SEM snapshot de calibração. */
export const NO_CALIBRATION = "NONE";

function describeFilters(filters: MetricsFilters): MetricsFilters {
  return {
    modelVersion: filters.modelVersion ?? null,
    calibrationVersion: filters.calibrationVersion ?? null,
    calibrationMode: filters.calibrationMode ?? null,
    source: filters.source ?? null,
    from: filters.from ?? null,
    to: filters.to ?? null,
    coverageTier: filters.coverageTier ?? null,
    productCode: filters.productCode ?? null,
    basis: filters.basis ?? null,
  };
}

function matchesCalibration(row: MetricsRow, filters: MetricsFilters): boolean {
  if (!filters.calibrationVersion && !filters.calibrationMode) return true;

  const snapshot = readCalibrationSnapshot(row.calibration);

  const version = snapshot?.version ?? NO_CALIBRATION;
  const mode = snapshot?.mode ?? NO_CALIBRATION;

  return (
    (!filters.calibrationVersion || filters.calibrationVersion === version) &&
    (!filters.calibrationMode || filters.calibrationMode === mode)
  );
}

/**
 * Relatório a partir das linhas já filtradas pela BD (período, cobertura,
 * produto, base). A versão do modelo e a calibração filtram-se aqui, para
 * mostrar todas as versões lado a lado. Só conta status = VALID.
 */
export function buildAccuracyReport(
  rows: readonly MetricsRow[],
  filters: MetricsFilters = {},
): AccuracyReport {
  const valid = rows.filter(
    (row) => row.status === "VALID" && matchesCalibration(row, filters),
  );
  const withVersion = filters.modelVersion
    ? valid.filter((row) => row.model_version === filters.modelVersion)
    : valid;
  const selected = filters.source
    ? withVersion.filter((row) => row.source === filters.source)
    : withVersion;

  const overall = computeAccuracyMetrics(selected);
  const calibration = compareBaseAndCalibrated(selected);
  const byOutput = groupByOutput(selected);
  const confidenceCalibration = computeConfidenceCalibration(selected);
  const warnings: string[] = [];

  if (overall.count === 0) {
    warnings.push("Sem observações válidas para estes filtros.");
  } else if (overall.count < SMALL_SAMPLE) {
    warnings.push(
      `Amostra pequena (${overall.count} < ${SMALL_SAMPLE}): as métricas são apenas indicativas.`,
    );
  }

  if (calibration.pairedCount > 0 && !calibration.sufficient) {
    warnings.push(
      `Comparação base vs calibrada com amostra insuficiente (${calibration.pairedCount} < ${calibration.minRequired}): valores só indicativos, não concluem que a calibração melhora ou piora.`,
    );
  }

  const bases = new Set(selected.map((row) => row.real_quote_basis));
  const nonComparable = [...bases].filter((basis) => !COMPARABLE_BASES.includes(basis));

  if (nonComparable.length > 0) {
    warnings.push(
      `Há observações com base ${nonComparable.join(", ")}: a estimativa é o prémio anual total, por isso INSTALLMENT e COMMERCIAL não são equivalentes e UNKNOWN não está confirmado. Filtre por base para uma leitura limpa.`,
    );
  }

  if (!filters.modelVersion && Object.keys(groupBy(valid, (row) => row.model_version)).length > 1) {
    warnings.push(
      "Há várias versões do modelo: leia a tabela por saída em vez do total.",
    );
  }

  if (byOutput.length > 1) {
    warnings.push(
      "Há saídas com e sem calibração: são outputs diferentes e lêem-se separadamente na tabela por saída.",
    );
  }

  const sources = new Set(selected.map((row) => row.source ?? "MANUAL_ENTRY"));

  if (!filters.source && sources.size > 1) {
    warnings.push(
      "Os números acima MISTURAM cotações reais (MANUAL_ENTRY) com apólices recalculadas do histórico (RETROACTIVE_PORTFOLIO, que é o próprio backtest, não validação independente). Filtre por origem para uma leitura honesta; ver «Por origem» abaixo.",
    );
  }

  return {
    filters: describeFilters(filters),
    overall,
    calibration,
    byOutput,
    byModelVersion: groupBy(valid, (row) => row.model_version),
    byBasis: groupBy(selected, (row) => row.real_quote_basis),
    byCoverageTier: groupBy(selected, (row) => row.coverage_tier ?? "—"),
    byProduct: groupBy(selected, (row) => row.real_product_code ?? "—"),
    bySource: groupBy(withVersion, (row) => row.source ?? "MANUAL_ENTRY"),
    confidenceCalibration,
    warnings,
  };
}
