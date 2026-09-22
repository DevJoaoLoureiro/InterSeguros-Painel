import { weightedMedian } from "./weighted-stats";
import type { CoverageTier } from "./zurich-auto-coverages";
import type {
  RequestFeatures,
  VehicleClass,
  ZurichHistoricalFeatures,
} from "./zurich-auto-features";

/*
 * Ajuste multiplicativo dos prémios comparáveis.
 *
 * PORQUÊ. Um kernel de semelhança só sabe "misturar" prémios vizinhos: não
 * consegue extrapolar (mais capital -> mais prémio; mais idade -> menos
 * prémio). No backtest da carteira (108 apólices, leave-one-client-out) o
 * kernel puro dava MAE ~110-114 EUR com viés de -48 EUR, enquanto um modelo
 * log-linear pequeno dava MAE ~94 EUR com viés ~0 (danos próprios: 170 EUR
 * vs 246 EUR). Por isso cada comparável é ajustado às diferenças de
 * tier/classe/idade/capital antes de ser ponderado.
 *
 * O MODELO. log(prémio) = b0 + sum(bj x xj), ajustado por regressão ridge
 * (penalização L2, intercepto livre) SÓ com o histórico da carteira, e com
 * poucos coeficientes, todos legíveis:
 *
 *   - danos próprios, RC+ (furto/incêndio)          (vs RC)
 *   - viatura comercial ligeira (<= 3500Kg), duas rodas   (vs standard)
 *   - idade do titular (por ano) e "idade desconhecida"
 *   - capital do veículo (por +10%), só em danos próprios
 *
 * Testados e REJEITADOS por não reduzirem o erro histórico: Quebra de
 * Vidros, produto Empresas, idade x danos próprios.
 *
 * Um comparável é ajustado por  exp( sum bj x (xj_pedido - xj_comparável) ).
 * O fator é limitado a [1/4, 4] como salvaguarda. Com pouca amostra
 * (< MIN_FIT_SIZE) não há modelo e não se ajusta nada.
 */

export const MIN_FIT_SIZE = 20;
export const MAX_ADJUSTMENT = 4;

/** Capital de referência (EUR) para o termo log-capital; só centra o valor. */
const CAPITAL_REFERENCE = 25_000;

export type AdjustmentInputs = {
  tier: CoverageTier;
  vehicleClass: VehicleClass;
  driverAge: number | null;

  /** Capital de Choque/Colisão (histórico) ou valor do veículo (pedido). */
  ownDamageCapital: number | null;
};

export function inputsFromHistorical(
  policy: ZurichHistoricalFeatures,
): AdjustmentInputs {
  return {
    tier: policy.coverageTier,
    vehicleClass: policy.vehicleClass,
    driverAge: policy.driverAge,
    ownDamageCapital: policy.vehicleCapital,
  };
}

/** O pedido é sempre tratado como viatura standard (a UI não pergunta o tipo). */
export function inputsFromRequest(request: RequestFeatures): AdjustmentInputs {
  return {
    tier: request.coverageTier,
    vehicleClass: "STANDARD",
    driverAge: request.driverAge,
    ownDamageCapital: request.vehicleValue,
  };
}

export const ADJUSTMENT_TERMS = [
  "Danos próprios",
  "RC+ (furto/incêndio)",
  "Comercial ligeiro (≤3500Kg)",
  "Duas rodas",
  "Idade do titular (por ano)",
  "Idade desconhecida",
  "Capital do veículo (por +10%)",
] as const;

/** Vetor de desenho; `meanAge` centra a idade (desconhecida = a média). */
function design(inputs: AdjustmentInputs, meanAge: number): number[] {
  const own = inputs.tier === "OWN_DAMAGE";

  return [
    own ? 1 : 0,
    inputs.tier === "RC_PLUS" ? 1 : 0,
    inputs.vehicleClass === "LIGHT_COMMERCIAL" ? 1 : 0,
    inputs.vehicleClass === "TWO_WHEELER" ? 1 : 0,
    (inputs.driverAge ?? meanAge) - meanAge,
    inputs.driverAge === null ? 1 : 0,
    // Capital desconhecido em danos próprios = valor de referência (efeito 0).
    own && inputs.ownDamageCapital !== null && inputs.ownDamageCapital > 0
      ? Math.log(inputs.ownDamageCapital / CAPITAL_REFERENCE)
      : 0,
  ];
}

export type AdjustmentEffect = {
  term: string;

  /** Coeficiente na escala log (por unidade do termo). */
  coefficient: number;

  /** Efeito multiplicativo legível: idade = por ano; capital = por +10%; resto = por presença. */
  percentEffect: number;
};

export type AdjustmentModel = {
  /** Nº de apólices usadas no ajuste. */
  n: number;
  lambda: number;

  meanAge: number;

  /** Intercepto na escala log (média de y - x.b, dado b). */
  intercept: number;

  /** Correção de Duan: média de exp(resíduo), para voltar da escala log ao euro. */
  smearing: number;

  /** Coeficientes na escala original de cada termo. */
  coefficients: number[];

  effects: AdjustmentEffect[];

  /** Prémios trazidos para o limite por serem outliers do ajuste (não apagados). */
  outliersClipped: number;
};

/** Resolve o sistema linear A x = b (eliminação de Gauss com pivô). */
function solveLinear(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const m = matrix.map((row, i) => [...row, vector[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;

    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }

    if (Math.abs(m[pivot][col]) < 1e-12) return null;

    [m[col], m[pivot]] = [m[pivot], m[col]];

    for (let row = 0; row < n; row++) {
      if (row === col) continue;

      const factor = m[row][col] / m[col][col];

      for (let k = col; k <= n; k++) m[row][k] -= factor * m[col][k];
    }
  }

  return m.map((row, i) => row[n] / row[i]);
}

/** Limiar (em desvios robustos) a partir do qual um resíduo é aparado. */
const OUTLIER_THRESHOLD = 3.5;

type RawFit = {
  coefficients: number[];
  intercept: number;
  offsets: number[];
};

function fitRidge(x: number[][], y: number[], lambda: number): RawFit | null {
  const k = x[0].length;

  const mean = Array.from(
    { length: k },
    (_, j) => x.reduce((sum, row) => sum + row[j], 0) / x.length,
  );
  const sd = Array.from({ length: k }, (_, j) => {
    const variance =
      x.reduce((sum, row) => sum + (row[j] - mean[j]) ** 2, 0) / x.length;

    return Math.sqrt(variance) || 1;
  });

  // Padroniza para a penalização ser igual entre termos; intercepto livre.
  const z = x.map((row) => [1, ...row.map((v, j) => (v - mean[j]) / sd[j])]);

  const gram = Array.from({ length: k + 1 }, (_, i) =>
    Array.from(
      { length: k + 1 },
      (_, j) =>
        z.reduce((sum, row) => sum + row[i] * row[j], 0) +
        (i === j && i > 0 ? lambda : 0),
    ),
  );
  const rhs = Array.from({ length: k + 1 }, (_, i) =>
    z.reduce((sum, row, index) => sum + row[i] * y[index], 0),
  );

  const beta = solveLinear(gram, rhs);

  if (!beta) {
    return null;
  }

  const coefficients = beta.slice(1).map((value, j) => value / sd[j]);

  // Intercepto na escala original (o ridge deixa-o livre): média de y - x.b.
  const offsets = x.map(
    (row, index) =>
      y[index] - row.reduce((sum, value, j) => sum + value * coefficients[j], 0),
  );

  return {
    coefficients,
    intercept: offsets.reduce((sum, value) => sum + value, 0) / offsets.length,
    offsets,
  };
}

/**
 * Ajusta o modelo log-linear às apólices elegíveis. null se houver menos de
 * MIN_FIT_SIZE apólices utilizáveis ou o sistema for singular.
 *
 * ROBUSTEZ. Os mínimos quadrados são sensíveis a prémios extremos (um único
 * 6000 EUR entre 30 apólices deslocava a previsão >10%). Depois do 1.º ajuste,
 * resíduos a mais de 3,5 desvios robustos (MAD) são TRAZIDOS para o limite
 * (winsorizados, não apagados) e o modelo é reajustado uma vez.
 */
export function fitAdjustmentModel(
  pool: readonly ZurichHistoricalFeatures[],
  lambda = 5,
): AdjustmentModel | null {
  const rows = pool.filter(
    (policy) =>
      policy.targetPremium !== null &&
      policy.targetPremium > 0 &&
      policy.coverageTier !== "UNKNOWN",
  );

  if (rows.length < MIN_FIT_SIZE) {
    return null;
  }

  const ages = rows
    .map((policy) => policy.driverAge)
    .filter((age): age is number => age !== null);

  const meanAge =
    ages.length > 0 ? ages.reduce((sum, age) => sum + age, 0) / ages.length : 40;

  const x = rows.map((policy) => design(inputsFromHistorical(policy), meanAge));
  const y = rows.map((policy) => Math.log(policy.targetPremium as number));

  const first = fitRidge(x, y, lambda);

  if (!first) {
    return null;
  }

  let fit = first;
  let outliersClipped = 0;

  const residuals = first.offsets.map((offset) => offset - first.intercept);
  const center =
    weightedMedian(residuals.map((value) => ({ value, weight: 1 }))) ?? 0;
  const mad =
    weightedMedian(
      residuals.map((value) => ({ value: Math.abs(value - center), weight: 1 })),
    ) ?? 0;
  const limit = OUTLIER_THRESHOLD * 1.4826 * mad;

  if (limit > 0) {
    const winsorized = y.map((value, index) => {
      const deviation = residuals[index] - center;

      if (Math.abs(deviation) <= limit) return value;

      outliersClipped += 1;

      // Traz o valor para (previsão + centro) +- limite.
      return value - deviation + center + Math.sign(deviation) * limit;
    });

    if (outliersClipped > 0) {
      fit = fitRidge(x, winsorized, lambda) ?? first;
    }
  }

  const { coefficients, intercept, offsets } = fit;

  const effects: AdjustmentEffect[] = coefficients.map((coefficient, j) => {
    // Idade: por ano. Capital: por +10%. Restantes: por presença.
    const unit = j === 6 ? Math.log(1.1) : 1;

    return {
      term: ADJUSTMENT_TERMS[j],
      coefficient,
      percentEffect: Math.exp(coefficient * unit) - 1,
    };
  });

  const smearing =
    offsets.reduce((sum, value) => sum + Math.exp(value - intercept), 0) /
    offsets.length;

  return {
    n: rows.length,
    lambda,
    meanAge,
    intercept,
    smearing,
    coefficients,
    effects,
    outliersClipped,
  };
}

function linearPredictor(
  model: AdjustmentModel,
  inputs: AdjustmentInputs,
): number {
  const row = design(inputs, model.meanAge);

  // Reconstrói o preditor na escala original a partir da forma padronizada.
  return row.reduce((sum, value, j) => sum + value * model.coefficients[j], 0);
}

/** Fator para levar o prémio de um comparável ao perfil do pedido. */
export function adjustmentFactor(
  model: AdjustmentModel,
  target: AdjustmentInputs,
  comparable: AdjustmentInputs,
): number {
  const raw = Math.exp(
    linearPredictor(model, target) - linearPredictor(model, comparable),
  );

  return Math.min(MAX_ADJUSTMENT, Math.max(1 / MAX_ADJUSTMENT, raw));
}

/**
 * Prémio previsto pelo modelo para o pedido (sem comparáveis). Usa a
 * correção de Duan (smearing) para voltar da escala log ao euro sem viés
 * sistemático de subestimação.
 */
export function predictWithModel(
  model: AdjustmentModel,
  target: AdjustmentInputs,
): number {
  return (
    Math.exp(model.intercept + linearPredictor(model, target)) * model.smearing
  );
}
