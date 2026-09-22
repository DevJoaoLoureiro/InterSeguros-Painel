/*
 * Relatório de backtest (dev): mede o estimador Zurich Auto contra a própria
 * carteira com leave-one-client-out e imprime erro, calibração do intervalo
 * e relação confiança/erro. Não faz parte do runtime.
 *
 *   compilar com tsc (imports sem extensão) e correr:
 *   node run-backtest.js <dataset.json> [eligible-out.json]
 *
 * O dataset vem de extract-dataset.mjs (só leitura, des-identificado).
 */
import { writeFileSync } from "node:fs";

import {
  DEFAULT_ESTIMATOR_CONFIG,
  type EstimatorConfig,
} from "../zurich-auto-estimator";
import {
  assessEstimate,
  buildCalibration,
  runLeaveOneOut,
  type EstimateAssessment,
} from "../zurich-auto-confidence";
import type { ZurichHistoricalFeatures } from "../zurich-auto-features";
import {
  computeMetrics,
  intervalCoverage,
  leaveOneGroupOut,
  metricsBySegment,
  type ErrorMetrics,
  type Prediction,
} from "../zurich-auto-validation";
import { loadDataset, requestFromHistorical } from "./dataset";

const dataset = loadDataset(process.argv[2]);
const items = dataset.eligible;
const config: EstimatorConfig = DEFAULT_ESTIMATOR_CONFIG;
const NOW = dataset.referenceDate;

if (process.argv[3]) {
  writeFileSync(process.argv[3], JSON.stringify(items.map((f) => f.id)));
}

const fmt = (x: number | null, d = 1) => (x === null ? "—" : x.toFixed(d));

const row = (name: string, m: ErrorMetrics) =>
  `${name.padEnd(26)} n=${String(m.n).padStart(3)} MAE=${fmt(m.mae)}€ MedAE=${fmt(m.medianAbsoluteError)}€ RMSE=${fmt(m.rmse)}€ MAPE=${fmt((m.mape ?? 0) * 100)}% P50=${fmt(m.absErrorP50)}€ P75=${fmt(m.absErrorP75)}€ P90=${fmt(m.absErrorP90)}€ P95=${fmt(m.absErrorP95)}€ bias=${fmt(m.bias)}€ under=${fmt(m.underpricing.share * 100, 0)}%(${fmt(m.underpricing.meanAbsError, 0)}€) over=${fmt(m.overpricing.share * 100, 0)}%(${fmt(m.overpricing.meanAbsError, 0)}€)`;

console.log(
  `itens=${items.length} (de ${dataset.all.length} Auto) | clientes=${new Set(items.map((i) => i.groupKey)).size}`,
);

// ---- 1. previsões leave-one-client-out (com avaliação completa) ----

const assessments = new Map<string, EstimateAssessment | null>();

// Passo A: erro histórico (resíduos) de todos os itens, para calibrar.
const raw = runLeaveOneOut(items, config, requestFromHistorical);

// Passo B: para CADA alvo, calibração feita SEM o próprio alvo (honesta).
const predictions: Prediction<ZurichHistoricalFeatures>[] = leaveOneGroupOut(
  items,
  (f) => f.targetPremium as number,
  (f) => f.groupKey,
  (target, pool) => {
    const calibration = buildCalibration(raw.filter((p) => p.item !== target));
    const assessment = assessEstimate(
      requestFromHistorical(target),
      pool,
      config,
      calibration,
      NOW,
    );

    assessments.set(target.id, assessment);

    return { predicted: assessment?.pointEstimate ?? null };
  },
);

const assessmentOf = (p: Prediction<ZurichHistoricalFeatures>) =>
  assessments.get(p.item.id) ?? null;

console.log("\n== ERRO (leave-one-client-out) ==");
console.log(row("TODAS", computeMetrics(predictions)));
console.log(
  row(
    "só viatura STANDARD",
    computeMetrics(predictions.filter((p) => p.item.vehicleClass === "STANDARD")),
  ),
);

const segments = (title: string, segmentOf: (p: Prediction<ZurichHistoricalFeatures>) => string) => {
  console.log(`\n-- por ${title} --`);

  for (const [key, m] of Object.entries(metricsBySegment(predictions, segmentOf))) {
    console.log(row(key, m));
  }
};

segments("tier de cobertura", (p) => p.item.coverageTier);
segments("produto", (p) => p.item.productCode ?? "?");
segments("nível de fallback", (p) => `L${assessmentOf(p)?.selection.fallbackLevel ?? "?"}`);
segments("capital (danos próprios)", (p) => {
  const capital = p.item.vehicleCapital;

  return capital === null
    ? "sem capital"
    : capital < 15_000
      ? "<15k"
      : capital < 25_000
        ? "15k-25k"
        : capital < 40_000
          ? "25k-40k"
          : ">=40k";
});
segments("nº de comparáveis", (p) => {
  const n = assessmentOf(p)?.selection.comparables.length ?? 0;

  return n < 12 ? "<12" : n < 20 ? "12-19" : ">=20";
});
segments("banda de confiança", (p) => assessmentOf(p)?.confidence.level ?? "?");

// ---- 2. intervalo: cobertura real vs nominal ----

const covered = intervalCoverage(predictions, (p) => {
  const interval = assessmentOf(p)?.interval;

  return interval ? { min: interval.min, max: interval.max } : null;
});

console.log(
  `\n== INTERVALO P10-P90 (nominal 80%) ==\ncobertura real=${fmt((covered.coverage ?? 0) * 100, 1)}% em n=${covered.n} | largura relativa média=${fmt((covered.meanRelativeWidth ?? 0) * 100, 0)}% da estimativa`,
);

for (const tier of ["RC", "OWN_DAMAGE", "RC_PLUS"]) {
  const subset = predictions.filter((p) => p.item.coverageTier === tier);
  const c = intervalCoverage(subset, (p) => {
    const interval = assessmentOf(p)?.interval;

    return interval ? { min: interval.min, max: interval.max } : null;
  });
  const sources = new Set(subset.map((p) => assessmentOf(p)?.interval.source));

  console.log(
    `  ${tier.padEnd(11)} cobertura=${fmt((c.coverage ?? 0) * 100, 0)}% largura=${fmt((c.meanRelativeWidth ?? 0) * 100, 0)}% n=${c.n} origem=${[...sources].join(",")}`,
  );
}

// ---- 3. confiança: o score ordena o erro? ----

console.log("\n== CONFIANÇA vs ERRO ==");

const scored = predictions
  .map((p) => ({ p, a: assessmentOf(p) }))
  .filter((x): x is { p: Prediction<ZurichHistoricalFeatures>; a: EstimateAssessment } => x.a !== null)
  .sort((x, y) => y.a.confidence.score - x.a.confidence.score);

const third = Math.floor(scored.length / 3);

for (const [name, slice] of [
  ["1/3 mais confiante", scored.slice(0, third)],
  ["1/3 do meio", scored.slice(third, 2 * third)],
  ["1/3 menos confiante", scored.slice(2 * third)],
] as const) {
  const m = computeMetrics(slice.map((x) => x.p));
  const scores = slice.map((x) => x.a.confidence.score);

  console.log(
    `${name.padEnd(22)} score ${fmt(Math.min(...scores), 0)}-${fmt(Math.max(...scores), 0)} | MAE=${fmt(m.mae)}€ MedAPE=${fmt((m.apeP50 ?? 0) * 100)}% P90 APE=${fmt((m.apeP90 ?? 0) * 100)}%`,
  );
}

// ---- 4. modelo de ajuste ajustado a toda a carteira ----

const example = assessments.get(items[0].id);

if (example?.estimate.adjustmentModel) {
  console.log("\n== EFEITOS DO AJUSTE (ajustado a uma amostra) ==");

  for (const effect of example.estimate.adjustmentModel.effects) {
    console.log(`  ${effect.term.padEnd(34)} ${effect.percentEffect >= 0 ? "+" : ""}${fmt(effect.percentEffect * 100)}%`);
  }
}
