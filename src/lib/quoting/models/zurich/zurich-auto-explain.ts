import type { EstimateDiagnostics, QuoteRequest } from "../../domain/types";
import type { EstimatorConfig } from "./zurich-auto-estimator";
import { FALLBACK_LEVEL_LABEL } from "./zurich-auto-estimator";
import type { EstimateAssessment } from "./zurich-auto-confidence";
import type { RequestFeatures } from "./zurich-auto-features";

/*
 * Explicação do resultado: razões, avisos, fatores e diagnóstico.
 *
 * Só descreve o que o modelo FEZ: um fator só aparece como "considerado" se
 * influenciou seleção, pesos ou ajuste; um dado do pedido que não existe no
 * histórico aparece como "não usado", nunca implicitamente como usado.
 */

// ---------- que inputs do pedido o modelo usa ----------

/*
 * Mapeamento INPUT do simulador -> uso pelo modelo -> existência no
 * histórico. Baseado na auditoria de 116 apólices Zurich Auto.
 */
export function buildInputUsage(): EstimateDiagnostics["inputUsage"] {
  return [
    {
      input: "Data de nascimento",
      usedByModel: true,
      existsInHistory: true,
      role: "ADJUSTMENT",
      note: "Idade do TITULAR (proxy do condutor). Nem todas as apólices a têm (empresas): essas entram com o efeito 'idade desconhecida'.",
    },
    {
      input: "Código postal",
      usedByModel: true,
      existsInHistory: true,
      role: "SIMILARITY",
      note: "Região por 4 e 2 dígitos. A carteira é quase toda do norte (começa por 4), pelo que o efeito medido é pequeno.",
    },
    {
      input: "Data da carta de condução",
      usedByModel: false,
      existsInHistory: false,
      role: "INFORMATIVE",
      note: "Não existe nas apólices históricas; não altera o valor.",
    },
    {
      input: "Matrícula",
      usedByModel: false,
      existsInHistory: false,
      role: "IDENTIFICATION_ONLY",
      note: "Identifica a viatura; nunca é sinal estatístico.",
    },
    {
      input: "Danos próprios / Colisão",
      usedByModel: true,
      existsInHistory: true,
      role: "ADJUSTMENT",
      note: "Define o tipo de cobertura, o sinal dominante: na carteira atual Choque/Colisão custa cerca de 2,2x uma apólice sem essa cobertura.",
    },
    {
      input: "Furto / Incêndio",
      usedByModel: true,
      existsInHistory: true,
      role: "ADJUSTMENT",
      note: "Sem danos próprios define o tipo RC+ (poucas apólices: baixa confiança).",
    },
    {
      input: "Quebra de vidros",
      usedByModel: true,
      existsInHistory: true,
      role: "SIMILARITY",
      note: "Peso baixo: presente na maioria das apólices e sem efeito mensurável no erro do backtest.",
    },
    {
      input: "Assistência / Proteção jurídica",
      usedByModel: false,
      existsInHistory: true,
      role: "INFORMATIVE",
      note: "Presentes em quase todas as apólices: não distinguem preços.",
    },
    {
      input: "Franquia",
      usedByModel: true,
      existsInHistory: true,
      role: "SIMILARITY",
      note: "Só em danos próprios, e só quando o ValorFranquia (euros) é conhecido; 0 e a Franquia bruta não se usam.",
    },
    {
      input: "Valor do veículo",
      usedByModel: true,
      existsInHistory: true,
      role: "ADJUSTMENT",
      note: "Só em danos próprios. Proxy: capital da cobertura Choque/Colisão. O capital do objeto (7 750 000 €) é o de RC e não é usado.",
    },
    {
      input: "Sinistros",
      usedByModel: false,
      existsInHistory: false,
      role: "INFORMATIVE",
      note: "Não existem no histórico.",
    },
    {
      input: "Uso do veículo",
      usedByModel: false,
      existsInHistory: false,
      role: "INFORMATIVE",
      note: "Não existe no histórico; o valor reflete sobretudo uso particular.",
    },
    {
      input: "Fracionamento",
      usedByModel: false,
      existsInHistory: true,
      role: "INFORMATIVE",
      note: "O prémio anual total não depende do fracionamento (confirmado com recibos); não altera o valor.",
    },
  ];
}

export const UNAVAILABLE_HISTORICAL_DATA: readonly string[] = [
  "Antiguidade da carta de condução",
  "Potência, cilindrada e combustível do veículo",
  "Sinistralidade",
  "Bónus-malus",
  "Uso do veículo (particular/profissional/TVDE)",
  "Valor comercial real do veículo",
];

// ---------- fatores ----------

function weightedShare<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  test: (item: T) => boolean,
): number {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);

  return total === 0
    ? 0
    : items.reduce((sum, item) => sum + (test(item) ? weightOf(item) : 0), 0) /
        total;
}

/**
 * Dados do pedido que efetivamente influenciaram o valor (para o
 * `consideredFactors` que a UI já mostra). Um fator só entra se pesou na
 * seleção, nos pesos ou no ajuste.
 */
export function buildConsideredFactors(
  target: RequestFeatures,
  assessment: EstimateAssessment,
  config: EstimatorConfig,
): string[] {
  const factors: string[] = [];
  const { comparables } = assessment.selection;
  const weights = config.similarity.weights;
  const hasModel = assessment.estimate.adjustmentModel !== null;

  if (target.coverageTier !== "UNKNOWN" && assessment.selection.fallbackLevel < 4) {
    factors.push("Tipo de cobertura");
  }

  if (target.driverAge !== null && (hasModel || weights.age > 0)) {
    factors.push("Idade do titular");
  }

  if (target.postalPrefix !== null && weights.postalRegion > 0) {
    factors.push("Região do código postal");
  }

  if (target.vehicleValue !== null && (hasModel || weights.vehicleCapital > 0)) {
    factors.push("Valor do veículo");
  }

  if (
    target.deductible !== null &&
    weights.deductible > 0 &&
    comparables.some((m) => m.policy.coverageProfile.ownDamageDeductible !== null)
  ) {
    factors.push("Franquia");
  }

  const glassValues = new Set(
    comparables.map((m) => m.policy.coverageProfile.hasGlass),
  );

  if (weights.glass > 0 && glassValues.size > 1) {
    factors.push("Quebra de Vidros");
  }

  if (target.productCode !== null) {
    factors.push("Produto");
  }

  return factors;
}

/** Fatores em linguagem positiva ("o que tornou os comparáveis parecidos"). */
export function buildMainFactors(
  target: RequestFeatures,
  assessment: EstimateAssessment,
): string[] {
  const { comparables } = assessment.selection;
  const weightOf = (m: (typeof comparables)[number]) => m.weight;
  const close = (
    feature: keyof (typeof comparables)[number]["similarity"]["contributions"],
    minimum: number,
  ) =>
    weightedShare(comparables, weightOf, (m) => {
      const value = m.similarity.contributions[feature].closeness;

      return value !== null && value >= minimum;
    });

  const factors: string[] = [];

  if (close("tier", 1) >= 0.5) {
    factors.push(
      target.coverageTier === "OWN_DAMAGE"
        ? "Mesmo tipo de cobertura (com danos próprios)"
        : target.coverageTier === "RC_PLUS"
          ? "Mesmo tipo de cobertura (RC com furto/incêndio)"
          : "Mesmo tipo de cobertura (responsabilidade civil)",
    );
  }

  if (target.productCode !== null && close("product", 1) >= 0.5) {
    factors.push("Mesmo produto Zurich");
  }

  if (target.vehicleValue !== null && close("vehicleCapital", 0.7) >= 0.5) {
    factors.push("Valor do veículo semelhante");
  }

  if (target.deductible !== null && close("deductible", 0.6) >= 0.5) {
    factors.push("Franquia semelhante");
  }

  if (target.driverAge !== null && close("age", 0.6) >= 0.5) {
    factors.push("Idade do titular semelhante");
  }

  if (target.postalPrefix !== null && close("postalRegion", 0.5) >= 0.5) {
    factors.push("Mesma região");
  }

  if (assessment.estimate.adjustmentModel) {
    factors.push("Prémios ajustados por idade, tipo de cobertura e valor do veículo");
  }

  return factors;
}

// ---------- texto ----------

const eur = (value: number): string => `${value.toFixed(0)} €`;
const pct = (value: number): string => `${(value * 100).toFixed(0)}%`;

/** Efeitos do ajuste relevantes para este pedido, em texto. */
function describeAdjustments(
  target: RequestFeatures,
  assessment: EstimateAssessment,
): string[] {
  const model = assessment.estimate.adjustmentModel;

  if (!model) return [];

  const sign = (value: number) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;

  return model.effects
    .filter((effect) => {
      if (effect.term === "Danos próprios") return target.coverageTier === "OWN_DAMAGE";
      if (effect.term.startsWith("Capital")) return target.vehicleValue !== null;
      if (effect.term.startsWith("Idade do titular")) return target.driverAge !== null;

      return false;
    })
    .map((effect) => `${effect.term}: ${sign(effect.percentEffect)}`);
}

export function describeAssessment(
  target: RequestFeatures,
  assessment: EstimateAssessment,
): { reasons: string[]; warnings: string[]; diagnostics: EstimateDiagnostics } {
  const { selection, estimate, interval, confidence, historicalError } = assessment;

  const level = selection.fallbackLevel;
  const adjustments = describeAdjustments(target, assessment);

  const reasons: string[] = [
    `Estimativa histórica Zurich Auto: ${assessment.pointEstimate.toFixed(2)} € por ano (prémio anual total).`,
    `Intervalo histórico ${pct(interval.nominalCoverage)}: ${eur(interval.min)}–${eur(interval.max)} (a partir do erro do modelo no histórico, não do preço real da Zurich).`,
    `Comparáveis: ${selection.strongCount} fortes e ${selection.secondaryCount} secundários (amostra efetiva ${estimate.effectiveSampleSize.toFixed(1)}); semelhança média ${estimate.meanSimilarity.toFixed(2)}.`,
    `Seleção: nível ${level} (${FALLBACK_LEVEL_LABEL[level]}).`,
  ];

  if (historicalError) {
    reasons.push(
      `Erro histórico deste tipo de cobertura (${historicalError.n} apólices): mediana ${historicalError.medianApe === null ? "—" : pct(historicalError.medianApe)}, MAE ${historicalError.mae === null ? "—" : eur(historicalError.mae)}, P90 ${historicalError.absErrorP90 === null ? "—" : eur(historicalError.absErrorP90)}.`,
    );
  }

  if (adjustments.length > 0) {
    reasons.push(`Ajustes aplicados aos comparáveis — ${adjustments.join("; ")}.`);
  }

  reasons.push(
    `Confiança ${confidence.level} (score ${confidence.score.toFixed(0)}/100)${confidence.cap ? `: ${confidence.cap}` : "."}`,
  );

  const warnings: string[] = [];

  if (level >= 2) {
    warnings.push(
      `Poucas apólices muito parecidas: foi preciso relaxar a seleção (${FALLBACK_LEVEL_LABEL[level]}).`,
    );
  }

  if (estimate.effectiveSampleSize < 8) {
    warnings.push(
      "Amostra efetiva pequena: o valor depende de poucas apólices; intervalo e confiança refletem-no.",
    );
  }

  if (interval.source !== "SEGMENT") {
    warnings.push(
      interval.source === "GLOBAL"
        ? "Poucas apólices deste tipo de cobertura para medir o erro específico; usado o erro global do modelo."
        : "Sem histórico suficiente para medir o erro do modelo; intervalo por regra de recurso.",
    );
  }

  if (target.coverageTier === "OWN_DAMAGE" && target.vehicleValue === null) {
    warnings.push(
      "Valor do veículo não indicado: a estimativa com danos próprios não foi ajustada ao valor do veículo.",
    );
  }

  if (target.coverageTier === "OWN_DAMAGE" && target.deductible !== null) {
    const known = selection.comparables.filter(
      (m) => m.policy.coverageProfile.ownDamageDeductible !== null,
    ).length;

    if (known < 5) {
      warnings.push(
        "Poucas apólices com franquia conhecida: a franquia pedida quase não influenciou o valor.",
      );
    }
  }

  if (assessment.confirmedTargetShare < 0.9) {
    warnings.push(
      "Parte dos prémios históricos não pôde ser confirmada por recibos (base anual total provável mas não verificada).",
    );
  }

  warnings.push(
    "Assumida uma viatura ligeira de passageiros (o simulador não pergunta o tipo); apólices de duas rodas e de comerciais até 3500Kg pesam menos.",
  );

  const diagnostics: EstimateDiagnostics = {
    target: {
      basis: "ANNUAL_TOTAL",
      source: "policies.annualized_premium (PremioApolice)",
      confirmedShare: assessment.confirmedTargetShare,
      note: "Prémio anual total (com encargos e impostos), independente do fracionamento; validado com os recibos.",
    },
    selection: {
      fallbackLevel: level,
      fallbackLabel: FALLBACK_LEVEL_LABEL[level],
      strongComparables: selection.strongCount,
      secondaryComparables: selection.secondaryCount,
      effectiveSampleSize: estimate.effectiveSampleSize,
      meanSimilarity: estimate.meanSimilarity,
      minSimilarity: estimate.minSimilarity,
      poolSize: selection.poolSize,
    },
    estimator: {
      method: estimate.method,
      comparablesEstimate: estimate.comparablesEstimate,
      modelPrediction: estimate.modelPrediction,
      modelBlend: estimate.modelBlend,
      dispersion: estimate.dispersion,
      outliersAdjusted: estimate.outliersAdjusted,
    },
    interval: {
      nominalCoverage: interval.nominalCoverage,
      lowerError: interval.lowerError,
      upperError: interval.upperError,
      source: interval.source,
      residuals: interval.residuals,
    },
    historicalError: historicalError
      ? {
          segment: historicalError.segment,
          n: historicalError.n,
          mae: historicalError.mae,
          medianAbsoluteError: historicalError.medianAbsoluteError,
          absErrorP90: historicalError.absErrorP90,
          medianApe: historicalError.medianApe,
          biasPct: historicalError.biasPct,
        }
      : null,
    confidence: {
      score: confidence.score,
      components: confidence.components,
      cap: confidence.cap,
    },
    adjustments:
      estimate.adjustmentModel?.effects.map((effect) => ({
        term: effect.term,
        percentEffect: effect.percentEffect,
      })) ?? [],
    mainFactors: buildMainFactors(target, assessment),
    unavailableData: [...UNAVAILABLE_HISTORICAL_DATA],
    inputUsage: buildInputUsage(),
  };

  return { reasons, warnings, diagnostics };
}

/** Avisos sobre dados do pedido que este modelo nunca usa. */
export function describeIgnoredRequestData(request: QuoteRequest): string[] {
  const warnings: string[] = [];

  warnings.push(
    request.claims
      ? "O histórico de sinistros indicado não altera o valor: as apólices Zurich guardadas não o registam."
      : "Histórico de sinistros não disponível; a estimativa não inclui ajuste específico de sinistralidade.",
  );

  if (request.customer.drivingLicenceDate) {
    warnings.push(
      "A data da carta de condução não altera o valor: as apólices Zurich guardadas não a registam.",
    );
  }

  if (request.customer.usage !== "PRIVATE") {
    warnings.push(
      `O uso do veículo (${request.customer.usage}) não é distinguido no histórico; o valor reflete sobretudo uso particular.`,
    );
  }

  if (request.bonusMalus) {
    warnings.push(
      "O bónus-malus indicado não altera o valor: as apólices Zurich guardadas não o registam.",
    );
  }

  return warnings;
}
