import type { ConfidenceLevel } from "../domain/types";

export type SafetyBufferInput = {
  pointEstimate: number;
  comparablePolicies: number;

  /**
   * Tamanho efetivo da amostra quando os comparáveis são ponderados
   * (<= comparablePolicies). Sem valor, usa-se comparablePolicies.
   */
  effectiveSampleSize?: number | null;
  positiveErrorP95?: number | null;
  medianAbsoluteError?: number | null;
  modelAgeDays?: number | null;
};

export function calculateSafetyBuffer(input: SafetyBufferInput): {
  range: { min: number; max: number };
  confidence: ConfidenceLevel;
  appliedBufferPct: number;
} {
  const sampleSize =
    input.effectiveSampleSize != null && Number.isFinite(input.effectiveSampleSize)
      ? Math.min(input.comparablePolicies, input.effectiveSampleSize)
      : input.comparablePolicies;

  let bufferPct = input.positiveErrorP95 ?? input.medianAbsoluteError ?? 0.05;
  if (sampleSize < 30) bufferPct = Math.max(bufferPct, 0.10);
  else if (sampleSize < 100) bufferPct = Math.max(bufferPct, 0.07);
  else if (sampleSize < 300) bufferPct = Math.max(bufferPct, 0.05);

  if (input.modelAgeDays != null) {
    if (input.modelAgeDays > 90) bufferPct += 0.03;
    else if (input.modelAgeDays > 30) bufferPct += 0.015;
  }

  bufferPct = Math.min(0.20, Math.max(0.02, bufferPct));
  const lowerBuffer = Math.min(bufferPct * 0.5, 0.05);

  let confidence: ConfidenceLevel = "LOW";
  if (sampleSize >= 300 && bufferPct <= 0.05) confidence = "HIGH";
  else if (sampleSize >= 100 && bufferPct <= 0.10) confidence = "MEDIUM";

  return {
    range: {
      min: Number((input.pointEstimate * (1 - lowerBuffer)).toFixed(2)),
      max: Number((input.pointEstimate * (1 + bufferPct)).toFixed(2)),
    },
    confidence,
    appliedBufferPct: bufferPct,
  };
}
