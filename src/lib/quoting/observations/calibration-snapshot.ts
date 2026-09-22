import type { EstimateCalibration } from "../domain/types";
import { normalizeText, toFiniteNumber } from "./normalize";
import type { JsonObject, ZurichCalibrationSnapshot } from "./types";

/*
 * Snapshot TIPADO da calibração, guardado em
 * prediction_snapshot.calibration.
 *
 * SEPARAÇÃO (a regra que este ficheiro protege):
 *
 *   estimated_premium (coluna)      = estimativa BASE do modelo histórico,
 *                                      SEMPRE (é contra ela que a BD gera
 *                                      signed_error/absolute_error/relative_error)
 *   calibration.baseEstimate         = a mesma base
 *   calibration.calibratedEstimate   = valor calibrado (null se não houve
 *                                      calibração: sem observações, desativada)
 *   model_version (coluna)           = versão do modelo BASE
 *   calibration.version              = versão da calibração
 *
 * Assim o erro base é comparável ao longo do tempo e o erro calibrado mede-se
 * à parte, sem nunca os misturar.
 */

const CONFIG_MODES = ["DISABLED", "EXPERIMENTAL", "PRODUCTION"] as const;
const STRATEGIES = ["NONE", "GLOBAL", "SEGMENT", "NEAREST_QUOTES"] as const;
const CONFIDENCES = ["LOW", "MEDIUM", "HIGH"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function positiveOrNull(value: unknown): number | null {
  const number = toFiniteNumber(value);

  return number !== null && number > 0 ? number : null;
}

function readRange(value: unknown): { min: number; max: number } | null {
  if (!isRecord(value)) return null;

  const min = positiveOrNull(value.min);
  const max = positiveOrNull(value.max);

  return min !== null && max !== null ? { min, max } : null;
}

/** null se não houve calibração (o resultado não traz o campo). */
export function buildCalibrationSnapshot(
  calibration: EstimateCalibration | null | undefined,
): ZurichCalibrationSnapshot | null {
  if (!calibration) return null;

  // Sem observações utilizáveis (NONE) ou desativada não há valor calibrado:
  // fica null (nunca a base repetida como se fosse calibrada).
  const calculated = calibration.mode !== "NONE" && calibration.configMode !== "DISABLED";
  const calibrated = calculated ? positiveOrNull(calibration.calibratedEstimate) : null;
  const safe = calculated ? positiveOrNull(calibration.productionSafeEstimate) : null;

  return {
    version: calibration.version,
    mode: calibration.configMode,
    strategy: calibration.mode,

    baseEstimate: calibration.baseEstimate,
    baseRange: calibration.baseRange,

    calibratedEstimate: calibrated,
    productionSafeEstimate: safe,
    adjustmentAmount: calibrated === null ? null : toFiniteNumber(calibration.adjustment.amount),
    adjustmentPercent:
      calibrated === null ? null : toFiniteNumber(calibration.adjustment.percent),

    experimental: calibration.experimental,
    applied: calibration.applied,
    eligibleForProduction: calibration.eligibleForProduction,

    sampleSize: calibration.sampleSize,
    productionSampleSize: calibration.productionSampleSize,
    effectiveSampleSize: toFiniteNumber(calibration.effectiveSampleSize),

    confidence: calibration.confidence,
    meanSimilarity: toFiniteNumber(calibration.diagnostics.meanSimilarity),
    reason: calibration.reason,
    modelVersion: calibration.modelVersion,
  };
}

export function calibrationSnapshotToJson(snapshot: ZurichCalibrationSnapshot): JsonObject {
  return {
    version: snapshot.version,
    mode: snapshot.mode,
    strategy: snapshot.strategy,
    baseEstimate: snapshot.baseEstimate,
    baseRange: snapshot.baseRange
      ? { min: snapshot.baseRange.min, max: snapshot.baseRange.max }
      : null,
    calibratedEstimate: snapshot.calibratedEstimate,
    productionSafeEstimate: snapshot.productionSafeEstimate,
    adjustmentAmount: snapshot.adjustmentAmount,
    adjustmentPercent: snapshot.adjustmentPercent,
    experimental: snapshot.experimental,
    applied: snapshot.applied,
    eligibleForProduction: snapshot.eligibleForProduction,
    sampleSize: snapshot.sampleSize,
    productionSampleSize: snapshot.productionSampleSize,
    effectiveSampleSize: snapshot.effectiveSampleSize,
    confidence: snapshot.confidence,
    meanSimilarity: snapshot.meanSimilarity,
    reason: snapshot.reason,
    modelVersion: snapshot.modelVersion,
  };
}

/**
 * Lê `prediction_snapshot.calibration` com defesa total. `calibratedEstimate`
 * só é válido se for finito e > 0; sem ele a observação NÃO entra nas métricas
 * calibradas (nunca há fallback para a estimativa base). Aceita também a forma
 * antiga do snapshot (config em `configMode`, estratégia em `mode`).
 */
export function readCalibrationSnapshot(value: unknown): ZurichCalibrationSnapshot | null {
  if (!isRecord(value)) return null;

  const version = normalizeText(value.version);
  const legacy = value.strategy === undefined && value.configMode !== undefined;
  const mode = pick(legacy ? value.configMode : value.mode, CONFIG_MODES);
  const strategy = pick(legacy ? value.mode : value.strategy, STRATEGIES) ?? "NONE";
  const baseEstimate = positiveOrNull(value.baseEstimate);

  if (mode === null || baseEstimate === null) return null;

  return {
    version: version ?? "unknown",
    mode,
    strategy,
    baseEstimate,
    baseRange: readRange(value.baseRange),
    calibratedEstimate: strategy === "NONE" ? null : positiveOrNull(value.calibratedEstimate),
    productionSafeEstimate: positiveOrNull(value.productionSafeEstimate),
    adjustmentAmount: toFiniteNumber(value.adjustmentAmount),
    adjustmentPercent: toFiniteNumber(value.adjustmentPercent),
    experimental: value.experimental !== false,
    applied: value.applied === true,
    eligibleForProduction: value.eligibleForProduction === true,
    sampleSize: toFiniteNumber(value.sampleSize) ?? 0,
    productionSampleSize: toFiniteNumber(value.productionSampleSize) ?? 0,
    effectiveSampleSize: toFiniteNumber(value.effectiveSampleSize),
    confidence: pick(value.confidence, CONFIDENCES) ?? "LOW",
    meanSimilarity: toFiniteNumber(value.meanSimilarity),
    reason: normalizeText(value.reason) ?? "",
    modelVersion: normalizeText(value.modelVersion) ?? "",
  };
}
