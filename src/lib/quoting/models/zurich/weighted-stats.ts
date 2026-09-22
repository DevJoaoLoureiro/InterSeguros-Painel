/*
 * Estatística ponderada mínima para o modelo Zurich Auto.
 *
 * Funções puras, sem I/O. Pesos inválidos (não finitos ou <= 0) e valores
 * não finitos são ignorados; nunca se convertem em 0.
 */

export type WeightedValue = {
  value: number;
  weight: number;
};

function usable(items: readonly WeightedValue[]): WeightedValue[] {
  return items.filter(
    (item) =>
      Number.isFinite(item.value) &&
      Number.isFinite(item.weight) &&
      item.weight > 0,
  );
}

/**
 * Mediana ponderada. Com pesos iguais coincide com a mediana simples (num
 * número par de valores devolve a média dos dois centrais). null se não
 * houver valores utilizáveis.
 */
export function weightedMedian(items: readonly WeightedValue[]): number | null {
  const sorted = usable(items).sort((a, b) => a.value - b.value);

  if (sorted.length === 0) {
    return null;
  }

  const total = sorted.reduce((sum, item) => sum + item.weight, 0);
  const half = total / 2;
  const tolerance = total * 1e-9;

  let cumulative = 0;

  for (let index = 0; index < sorted.length; index++) {
    cumulative += sorted[index].weight;

    if (Math.abs(cumulative - half) <= tolerance) {
      const next = sorted[index + 1];

      return next ? (sorted[index].value + next.value) / 2 : sorted[index].value;
    }

    if (cumulative > half) {
      return sorted[index].value;
    }
  }

  return sorted[sorted.length - 1].value;
}

/**
 * Tamanho efetivo da amostra de Kish: (Σw)² / Σw². Igual ao nº de valores
 * com pesos iguais; menor quando poucos valores concentram o peso.
 */
export function effectiveSampleSize(weights: readonly number[]): number {
  const valid = weights.filter((weight) => Number.isFinite(weight) && weight > 0);

  if (valid.length === 0) {
    return 0;
  }

  const sum = valid.reduce((total, weight) => total + weight, 0);
  const sumOfSquares = valid.reduce((total, weight) => total + weight * weight, 0);

  return (sum * sum) / sumOfSquares;
}

/**
 * Desvio absoluto mediano (ponderado) em relação à mediana, em fração da
 * mediana. É a dispersão dos valores comparáveis, NÃO o erro medido do
 * modelo contra preços reais (esses dados não existem). null se a mediana
 * não for positiva ou não houver valores.
 */
export function relativeMedianAbsoluteDeviation(
  items: readonly WeightedValue[],
  median: number,
): number | null {
  if (!Number.isFinite(median) || median <= 0) {
    return null;
  }

  const deviation = weightedMedian(
    usable(items).map((item) => ({
      value: Math.abs(item.value - median),
      weight: item.weight,
    })),
  );

  return deviation === null ? null : deviation / median;
}

// ---------- estimadores robustos ----------

/** Média ponderada. null sem valores utilizáveis. */
export function weightedMean(items: readonly WeightedValue[]): number | null {
  const valid = usable(items);

  if (valid.length === 0) {
    return null;
  }

  const total = valid.reduce((sum, item) => sum + item.weight, 0);

  return valid.reduce((sum, item) => sum + item.value * item.weight, 0) / total;
}

/** Média geométrica ponderada (média em escala logarítmica); só valores > 0. */
export function weightedGeometricMean(
  items: readonly WeightedValue[],
): number | null {
  const mean = weightedMean(
    usable(items)
      .filter((item) => item.value > 0)
      .map((item) => ({ value: Math.log(item.value), weight: item.weight })),
  );

  return mean === null ? null : Math.exp(mean);
}

/**
 * Média ponderada aparada: retira `trimShare` da MASSA de peso em cada
 * cauda (cortando o peso da observação de fronteira, não a observação
 * inteira). Com pouca amostra efetiva não apara nada: cortar 10% de 5
 * observações seria arbitrário.
 */
export function trimmedWeightedMean(
  items: readonly WeightedValue[],
  trimShare = 0.1,
  minEffectiveSize = 8,
): number | null {
  const valid = usable(items).sort((a, b) => a.value - b.value);

  if (valid.length === 0) {
    return null;
  }

  if (effectiveSampleSize(valid.map((item) => item.weight)) < minEffectiveSize) {
    return weightedMean(valid);
  }

  const total = valid.reduce((sum, item) => sum + item.weight, 0);
  const cut = total * trimShare;

  let low = 0;
  let sum = 0;
  let kept = 0;

  for (const item of valid) {
    const start = low;
    const end = low + item.weight;

    // Parte do peso desta observação que fica entre [cut, total - cut].
    const overlap = Math.max(0, Math.min(end, total - cut) - Math.max(start, cut));

    sum += item.value * overlap;
    kept += overlap;
    low = end;
  }

  return kept > 0 ? sum / kept : weightedMean(valid);
}

export type WinsorizedResult = {
  value: number | null;

  /** Observações cujo valor foi trazido para o limite (não são apagadas). */
  flagged: number;
};

/**
 * Média ponderada winsorizada por regra MAD: valores a mais de
 * `threshold` desvios robustos da mediana (z modificado de Iglewicz-
 * Hoaglin, limiar padrão 3,5) são TRAZIDOS para o limite, não removidos.
 * Sem dispersão (MAD = 0) ou sem amostra mínima não altera nada.
 */
export function winsorizedWeightedMean(
  items: readonly WeightedValue[],
  threshold = 3.5,
  minCount = 6,
): WinsorizedResult {
  const valid = usable(items);
  const median = weightedMedian(valid);

  if (median === null) {
    return { value: null, flagged: 0 };
  }

  if (valid.length < minCount) {
    return { value: weightedMean(valid), flagged: 0 };
  }

  const mad = weightedMedian(
    valid.map((item) => ({
      value: Math.abs(item.value - median),
      weight: item.weight,
    })),
  );

  if (mad === null || mad === 0) {
    return { value: weightedMean(valid), flagged: 0 };
  }

  // 1,4826 converte MAD em desvio-padrão sob normalidade.
  const limit = threshold * 1.4826 * mad;
  let flagged = 0;

  const adjusted = valid.map((item) => {
    const clamped = Math.min(median + limit, Math.max(median - limit, item.value));

    if (clamped !== item.value) flagged += 1;

    return { value: clamped, weight: item.weight };
  });

  return { value: weightedMean(adjusted), flagged };
}
