/*
 * Calibração (dev): pesquisa aleatória controlada de configurações do
 * estimador, avaliada com validação cruzada ANINHADA por grupos de cliente.
 *
 * Para cada dobra externa a melhor configuração é escolhida SÓ com o treino
 * (leave-one-client-out dentro do treino) e avaliada nos itens de teste que
 * nunca influenciaram a escolha. O erro reportado no fim é, portanto, uma
 * estimativa honesta do desempenho da PRÓPRIA escolha de configuração.
 *
 * Uso (depois de compilar; ver __tests__): node calibrate.js <dataset.json> [configs] [repeats]
 */
import {
  computeMetrics,
  crossValidateSelection,
  leaveOneGroupOut,
  seededRandom,
  type Prediction,
  type Predictor,
} from "../zurich-auto-validation";
import {
  DEFAULT_ESTIMATOR_CONFIG,
  estimatePremium,
  type EstimationMethod,
  type EstimatorConfig,
} from "../zurich-auto-estimator";
import { SIMILARITY_FEATURES } from "../zurich-auto-similarity";
import type { ZurichHistoricalFeatures } from "../zurich-auto-features";
import { loadDataset, requestFromHistorical } from "./dataset";

const ds = loadDataset(process.argv[2]);
const CONFIGS = Number(process.argv[3] ?? 60);
const REPEATS = Number(process.argv[4] ?? 1);

const items = ds.eligible;
const actualOf = (f: ZurichHistoricalFeatures) => f.targetPremium as number;
const groupOf = (f: ZurichHistoricalFeatures) => f.groupKey;

const predictorFor =
  (config: EstimatorConfig): Predictor<ZurichHistoricalFeatures> =>
  (target, pool) => {
    const result = estimatePremium(requestFromHistorical(target), pool, config);

    return { predicted: result?.estimate.pointEstimate ?? null };
  };

/** Erro logarítmico absoluto médio: simétrico em razão, pouco sensível a extremos. */
const logError = (predictions: readonly Prediction<ZurichHistoricalFeatures>[]) => {
  const errors = predictions
    .filter((p) => p.predicted !== null && p.predicted > 0)
    .map((p) => Math.abs(Math.log((p.predicted as number) / p.actual)));

  return errors.length === 0
    ? Infinity
    : errors.reduce((a, b) => a + b, 0) / errors.length;
};

const random = seededRandom(20260921);
const pick = <T,>(values: readonly T[]): T => values[Math.floor(random() * values.length)];

function randomConfig(): EstimatorConfig {
  const base = DEFAULT_ESTIMATOR_CONFIG;
  const weights = { ...base.similarity.weights };

  for (const feature of SIMILARITY_FEATURES) {
    weights[feature] = base.similarity.weights[feature] * pick([0, 0.5, 1, 2]);
  }
  weights.tier = pick([3, 5, 8]);

  return {
    ...base,
    method: pick<EstimationMethod>(["WEIGHTED_MEAN", "WINSORIZED_MEAN", "GEOMETRIC_MEAN", "TRIMMED_MEAN", "WEIGHTED_MEDIAN"]),
    minComparables: pick([8, 12, 16, 24]),
    maxComparables: pick([15, 25, 40]),
    ridgeLambda: pick([1, 5, 15]),
    modelBlend: pick([0, 0.25, 0.5, 0.75, 1]),
    similarity: {
      ...base.similarity,
      weights,
      kernelPower: pick([1, 2, 3, 5]),
      missingTolerance: pick([0, 0.6, 1]),
      cancelledFactor: pick([0.5, 0.7, 1]),
      ageScaleYears: pick([5, 10, 20]),
    },
  };
}

const configs: EstimatorConfig[] = [
  DEFAULT_ESTIMATOR_CONFIG,
  { ...DEFAULT_ESTIMATOR_CONFIG, method: "WINSORIZED_MEAN", modelBlend: 0.5 },
  ...Array.from({ length: CONFIGS }, randomConfig),
];

const fmt = (x: number | null, d = 1) => (x === null ? "—" : x.toFixed(d));

console.log(`itens=${items.length} configs=${configs.length} repeats=${REPEATS}`);

// 1) Escolha "ingénua" no conjunto todo (otimista: escolhe e avalia nos mesmos casos).
const started = Date.now();
const naive = configs
  .map((config, index) => ({
    index,
    score: logError(leaveOneGroupOut(items, actualOf, groupOf, predictorFor(config))),
  }))
  .sort((a, b) => a.score - b.score);

console.log(`pesquisa completa em ${((Date.now() - started) / 1000).toFixed(0)}s`);
console.log("top 5 (otimista, escolha e avaliação no mesmo conjunto):");
for (const { index, score } of naive.slice(0, 5)) {
  const c = configs[index];

  console.log(`  #${index} logErr=${score.toFixed(4)} ${c.method} blend=${c.modelBlend} λ=${c.ridgeLambda} kp=${c.similarity.kernelPower} min=${c.minComparables} max=${c.maxComparables} w=${JSON.stringify(c.similarity.weights)}`);
}

const defaultScore = naive.find((entry) => entry.index === 0)?.score ?? NaN;

console.log(`config inicial: logErr=${defaultScore.toFixed(4)} | melhor: ${naive[0].score.toFixed(4)}`);

// 2) Validação cruzada aninhada: o erro HONESTO da escolha.
const nested = crossValidateSelection({
  items,
  groupOf,
  actualOf,
  configs,
  predictorFor,
  score: logError,
  folds: 5,
  repeats: REPEATS,
  seed: 7,
});

const m = computeMetrics(nested.predictions);

console.log(
  `\nNESTED CV (${nested.chosen.length} escolhas): MAE=${fmt(m.mae)} MedAE=${fmt(m.medianAbsoluteError)} MAPE=${fmt((m.mape ?? 0) * 100)}% P90=${fmt(m.absErrorP90)} P95=${fmt(m.absErrorP95)} bias=${fmt(m.bias)} logErr=${logError(nested.predictions).toFixed(4)}`,
);

const chosenCount = new Map<number, number>();

for (const choice of nested.chosen) {
  const index = configs.indexOf(choice.config);

  chosenCount.set(index, (chosenCount.get(index) ?? 0) + 1);
}

console.log(
  "configurações escolhidas por dobra (índice: vezes):",
  JSON.stringify([...chosenCount.entries()].sort((a, b) => b[1] - a[1])),
);
console.log(
  "métodos escolhidos:",
  JSON.stringify(
    nested.chosen.reduce<Record<string, number>>((acc, choice) => {
      acc[choice.config.method] = (acc[choice.config.method] ?? 0) + 1;

      return acc;
    }, {}),
  ),
);
console.log(
  "blend escolhido:",
  JSON.stringify(
    nested.chosen.reduce<Record<string, number>>((acc, choice) => {
      const key = String(choice.config.modelBlend);

      acc[key] = (acc[key] ?? 0) + 1;

      return acc;
    }, {}),
  ),
);
