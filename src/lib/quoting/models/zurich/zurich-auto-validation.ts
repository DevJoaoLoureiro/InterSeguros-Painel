/*
 * Validação (backtest) do estimador Zurich Auto contra a própria carteira.
 *
 * Módulo PURO e genérico: não sabe o que é uma apólice. Recebe itens, uma
 * função que diz o valor real, o grupo (cliente) e um preditor. Assim o
 * mesmo harness mede o modelo antigo, o novo e as referências triviais
 * nas mesmas condições.
 *
 * METODOLOGIA
 *
 * - Leave-one-GROUP-out: para prever uma apólice retiram-se TODAS as do
 *   mesmo grupo (cliente). Retirar só a apólice deixaria a outra do mesmo
 *   cliente (mesma pessoa, mesma zona, carro parecido) a "ajudar", e o erro
 *   sairia otimista.
 * - Erros em euros e relativos (APE = |previsto - real| / real). O prémio
 *   tem estrutura multiplicativa, por isso os erros relativos comparam-se
 *   entre segmentos de preço muito diferentes.
 * - Quantis de resíduos com correção de amostra finita (estilo conformal):
 *   o quantil de ordem q usa a estatística de ordem ceil((n+1)q); com
 *   poucos resíduos o intervalo alarga em vez de fingir precisão.
 * - Nada aqui otimiza: a calibração de pesos usa validação cruzada
 *   aninhada (ver crossValidateSelection), nunca o mesmo conjunto onde se
 *   escolhe e onde se avalia.
 */

export type Prediction<T> = {
  item: T;
  actual: number;

  /** null = o modelo não conseguiu prever (não conta como erro 0). */
  predicted: number | null;

  /** Metadados opcionais do preditor (segmento, confiança, nº de comparáveis...). */
  meta?: Record<string, string | number | null>;
};

export type Predictor<T> = (
  target: T,
  pool: readonly T[],
) => { predicted: number | null; meta?: Record<string, string | number | null> };

export function leaveOneGroupOut<T>(
  items: readonly T[],
  actualOf: (item: T) => number,
  groupOf: (item: T) => string | null,
  predict: Predictor<T>,
): Prediction<T>[] {
  return items.map((item) => {
    const group = groupOf(item);

    const pool = items.filter(
      (other) => other !== item && (group === null || groupOf(other) !== group),
    );

    const { predicted, meta } = predict(item, pool);

    return { item, actual: actualOf(item), predicted, meta };
  });
}

// ---------- quantis ----------

/** Quantil por interpolação linear (para relatórios). */
export function quantile(values: readonly number[], q: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);

  if (sorted.length === 0) return null;

  const position = Math.min(1, Math.max(0, q)) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);

  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * Quantil "conservador" com correção de amostra finita: estatística de
 * ordem ceil((n+1)q), limitada ao máximo. Com n pequeno devolve valores
 * extremos (intervalo largo), que é o comportamento honesto.
 */
export function conformalQuantile(
  values: readonly number[],
  q: number,
): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);

  if (sorted.length === 0) return null;

  const rank = Math.min(sorted.length, Math.ceil((sorted.length + 1) * q));

  return sorted[Math.max(0, rank - 1)];
}

// ---------- métricas ----------

export type ErrorMetrics = {
  n: number;
  /** Alvos sem previsão (excluídos das métricas). */
  unpredicted: number;

  mae: number | null;
  medianAbsoluteError: number | null;
  rmse: number | null;
  mape: number | null;

  absErrorP50: number | null;
  absErrorP75: number | null;
  absErrorP90: number | null;
  absErrorP95: number | null;

  apeP50: number | null;
  apeP90: number | null;

  /** Média de (previsto - real): > 0 = tende a sobrestimar. */
  bias: number | null;
  biasPct: number | null;

  /** Previsto abaixo do real: o mediador diria menos do que a Zurich cobra. */
  underpricing: { share: number; meanAbsError: number | null };
  overpricing: { share: number; meanAbsError: number | null };
};

function mean(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function computeMetrics<T>(
  predictions: readonly Prediction<T>[],
): ErrorMetrics {
  const usable = predictions.filter(
    (item): item is Prediction<T> & { predicted: number } =>
      item.predicted !== null &&
      Number.isFinite(item.predicted) &&
      Number.isFinite(item.actual) &&
      item.actual > 0,
  );

  const errors = usable.map((item) => item.predicted - item.actual);
  const absErrors = errors.map(Math.abs);
  const apes = usable.map(
    (item) => Math.abs(item.predicted - item.actual) / item.actual,
  );

  const under = usable.filter((item) => item.predicted < item.actual);
  const over = usable.filter((item) => item.predicted > item.actual);

  return {
    n: usable.length,
    unpredicted: predictions.length - usable.length,

    mae: mean(absErrors),
    medianAbsoluteError: quantile(absErrors, 0.5),
    rmse:
      errors.length === 0
        ? null
        : Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0) / errors.length),
    mape: mean(apes),

    absErrorP50: quantile(absErrors, 0.5),
    absErrorP75: quantile(absErrors, 0.75),
    absErrorP90: quantile(absErrors, 0.9),
    absErrorP95: quantile(absErrors, 0.95),

    apeP50: quantile(apes, 0.5),
    apeP90: quantile(apes, 0.9),

    bias: mean(errors),
    biasPct: mean(
      usable.map((item) => (item.predicted - item.actual) / item.actual),
    ),

    underpricing: {
      share: usable.length === 0 ? 0 : under.length / usable.length,
      meanAbsError: mean(under.map((item) => item.actual - item.predicted)),
    },
    overpricing: {
      share: usable.length === 0 ? 0 : over.length / usable.length,
      meanAbsError: mean(over.map((item) => item.predicted - item.actual)),
    },
  };
}

/** Métricas por segmento (chave devolvida por `segmentOf`). */
export function metricsBySegment<T>(
  predictions: readonly Prediction<T>[],
  segmentOf: (prediction: Prediction<T>) => string,
): Record<string, ErrorMetrics> {
  const groups = new Map<string, Prediction<T>[]>();

  for (const prediction of predictions) {
    const key = segmentOf(prediction);

    (groups.get(key) ?? groups.set(key, []).get(key)!).push(prediction);
  }

  return Object.fromEntries(
    [...groups.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, items]) => [key, computeMetrics(items)]),
  );
}

// ---------- resíduos relativos e intervalos ----------

/** Resíduo relativo = real / previsto - 1 (multiplicativo, > -1). */
export function relativeResiduals<T>(
  predictions: readonly Prediction<T>[],
): number[] {
  return predictions
    .filter(
      (item): item is Prediction<T> & { predicted: number } =>
        item.predicted !== null && item.predicted > 0 && item.actual > 0,
    )
    .map((item) => item.actual / item.predicted - 1);
}

export type ResidualInterval = {
  /** Resíduo relativo inferior/superior (ex.: -0.18 e +0.31). */
  lower: number;
  upper: number;

  /** Cobertura nominal (ex.: 0.8 para P10–P90) e nº de resíduos usados. */
  nominalCoverage: number;
  n: number;
};

/**
 * Intervalo de resíduos relativos com cobertura nominal `coverage`
 * (ex.: 0.8 -> quantis 10% e 90%). Assimétrico por construção: cada lado
 * usa o seu próprio quantil, sem assumir normalidade. null se não houver
 * resíduos suficientes (minResiduals) para não inventar precisão.
 */
export function residualInterval(
  residuals: readonly number[],
  coverage = 0.8,
  minResiduals = 8,
): ResidualInterval | null {
  if (residuals.length < minResiduals) return null;

  const tail = (1 - coverage) / 2;
  const upper = conformalQuantile(residuals, 1 - tail);
  // Lado inferior: o mesmo quantil conservador, aplicado aos resíduos negados.
  const negatedLower = conformalQuantile(
    residuals.map((residual) => -residual),
    1 - tail,
  );

  if (upper === null || negatedLower === null) return null;

  return {
    lower: Math.min(-negatedLower, 0),
    upper: Math.max(upper, 0),
    nominalCoverage: coverage,
    n: residuals.length,
  };
}

/** Fração dos valores reais dentro de [min, max] (calibração do intervalo). */
export function intervalCoverage<T>(
  predictions: readonly Prediction<T>[],
  intervalOf: (prediction: Prediction<T>) => { min: number; max: number } | null,
): { coverage: number | null; meanRelativeWidth: number | null; n: number } {
  let inside = 0;
  let counted = 0;
  const widths: number[] = [];

  for (const prediction of predictions) {
    const interval = intervalOf(prediction);

    if (!interval || prediction.predicted === null) continue;

    counted += 1;
    if (prediction.actual >= interval.min && prediction.actual <= interval.max) {
      inside += 1;
    }
    widths.push((interval.max - interval.min) / prediction.predicted);
  }

  return {
    coverage: counted === 0 ? null : inside / counted,
    meanRelativeWidth: mean(widths),
    n: counted,
  };
}

// ---------- validação cruzada aninhada ----------

/** Gerador pseudo-aleatório determinístico (mulberry32). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Divide GRUPOS (clientes) em k dobras, de forma determinística. Devolve,
 * por dobra, os itens de teste; o resto é treino. Grupos nunca se partem.
 */
export function groupKFolds<T>(
  items: readonly T[],
  groupOf: (item: T) => string | null,
  k: number,
  seed: number,
): T[][] {
  const random = seededRandom(seed);
  const groups = new Map<string, T[]>();

  items.forEach((item, index) => {
    const key = groupOf(item) ?? `__solo_${index}`;

    (groups.get(key) ?? groups.set(key, []).get(key)!).push(item);
  });

  const keys = [...groups.keys()].sort();

  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));

    [keys[i], keys[j]] = [keys[j], keys[i]];
  }

  const folds: T[][] = Array.from({ length: k }, () => []);

  keys.forEach((key, index) => {
    folds[index % k].push(...(groups.get(key) ?? []));
  });

  return folds;
}

export type SelectionOutcome<C> = {
  config: C;
  /** Erro usado para escolher (dentro do treino, leave-one-group-out). */
  trainScore: number;
};

/**
 * Validação cruzada ANINHADA da escolha de configuração.
 *
 * Para cada dobra externa: escolhe-se a melhor configuração usando SÓ o
 * treino (leave-one-group-out dentro do treino) e avalia-se essa escolha
 * nos itens de teste, que nunca influenciaram a escolha. Devolve as
 * previsões de teste (honestas) e as configurações escolhidas por dobra
 * (a sua estabilidade diz se a escolha é sólida ou ruído).
 *
 * `score` deve ser um erro a minimizar (ex.: MAE ou mediana do APE).
 */
export function crossValidateSelection<T, C>(params: {
  items: readonly T[];
  groupOf: (item: T) => string | null;
  actualOf: (item: T) => number;
  configs: readonly C[];
  predictorFor: (config: C) => Predictor<T>;
  score: (predictions: readonly Prediction<T>[]) => number;
  folds: number;
  repeats: number;
  seed: number;
}): {
  predictions: Prediction<T>[];
  chosen: SelectionOutcome<C>[];
} {
  const predictions: Prediction<T>[] = [];
  const chosen: SelectionOutcome<C>[] = [];

  for (let repeat = 0; repeat < params.repeats; repeat++) {
    const folds = groupKFolds(
      params.items,
      params.groupOf,
      params.folds,
      params.seed + repeat,
    );

    for (const test of folds) {
      const testSet = new Set(test);
      const train = params.items.filter((item) => !testSet.has(item));

      let best: SelectionOutcome<C> | null = null;

      for (const config of params.configs) {
        const trainPredictions = leaveOneGroupOut(
          train,
          params.actualOf,
          params.groupOf,
          params.predictorFor(config),
        );
        const trainScore = params.score(trainPredictions);

        if (best === null || trainScore < best.trainScore) {
          best = { config, trainScore };
        }
      }

      if (!best) continue;

      chosen.push(best);

      const predictor = params.predictorFor(best.config);

      for (const item of test) {
        // Pool = treino (sem o grupo do próprio item, já fora por construção).
        const group = params.groupOf(item);
        const pool = train.filter(
          (other) => group === null || params.groupOf(other) !== group,
        );
        const { predicted, meta } = predictor(item, pool);

        predictions.push({
          item,
          actual: params.actualOf(item),
          predicted,
          meta: { ...meta, repeat },
        });
      }
    }
  }

  return { predictions, chosen };
}
