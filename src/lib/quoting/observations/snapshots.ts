import type { EstimatedQuote, QuoteRequest } from "../domain/types";
import { tierFromRequestedCoverages } from "../models/zurich/zurich-auto-coverages";
import { buildCalibrationSnapshot, calibrationSnapshotToJson } from "./calibration-snapshot";
import {
  isUuid,
  normalizeDate,
  normalizePlate,
  normalizePostalCode,
  normalizeText,
  normalizeTimestamp,
  toFiniteNumber,
  toJsonObject,
  toRoundedInteger,
} from "./normalize";
import { MAX_NOTES_LENGTH, MAX_REAL_QUOTE_AMOUNT } from "./validation";
import {
  OBSERVATION_STATUSES,
  REAL_QUOTE_BASES,
  type JsonObject,
  type ObservationStatus,
  type QuoteObservationSource,
  type RealQuoteData,
  type ZurichQuoteObservationInsert,
} from "./types";

/*
 * Snapshots imutáveis e mapeamento para as colunas de
 * zurich_quote_observations.
 *
 * Os snapshots guardam SÓ campos que existem em QuoteRequest/EstimatedQuote;
 * o que não existe é null (nunca um valor inventado, nunca 0). O NIF nunca
 * entra (PII sem utilidade para calibrar), e não há tokens nem segredos:
 * estes objetos não os contêm.
 */

export const SNAPSHOT_SCHEMA_VERSION = 1;

// ---------- snapshots ----------

export function buildRequestSnapshot(request: QuoteRequest): JsonObject {
  const coverages = request.requestedCoverages;
  const vehicle = request.vehicle;
  const claims = request.claims;

  return toJsonObject({
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,

    requestId: request.requestId,
    requestedAt: request.requestedAt,
    clientId: request.clientId ?? null,
    productLine: request.productLine,

    customer: {
      birthDate: request.customer?.birthDate ?? null,
      postalCode: request.customer?.postalCode ?? null,
      drivingLicenceDate: request.customer?.drivingLicenceDate ?? null,
      usage: request.customer?.usage ?? null,
    },

    vehicle: vehicle
      ? {
          registration: vehicle.registration,
          make: vehicle.make,
          model: vehicle.model,
          version: vehicle.version,
          firstRegistrationDate: vehicle.firstRegistrationDate,
          fuelType: vehicle.fuelType,
          engineCc: vehicle.engineCc,
          powerKw: vehicle.powerKw,
          marketValue: vehicle.marketValue,
          annualKm: vehicle.annualKm,
        }
      : null,

    coverageTier: coverages ? tierFromRequestedCoverages(coverages) : null,
    requestedCoverages: coverages ?? null,
    deductible: coverages?.deductible ?? null,
    paymentFrequency: request.paymentFrequency ?? null,

    claims: claims ?? null,
    claimsLast3Years: claims?.claims3Y ?? null,
    bonusMalus: request.bonusMalus ?? null,
  });
}

/**
 * Valores da estimativa BASE de uma previsão, sejam quais forem os que a UI
 * mostrou. Se houve calibração, a base vem de `calibration.baseEstimate` e
 * `calibration.baseRange` (o priceRange do resultado pode estar escalado);
 * senão o pointEstimate/priceRange já são a base. Nunca se mistura o
 * calibrado nestas colunas.
 */
export function baseValuesOf(prediction: EstimatedQuote): {
  estimate: number | null;
  lower: number | null;
  upper: number | null;
} {
  const calibration = prediction.calibration;
  const calibratedBase = toFiniteNumber(calibration?.baseEstimate);
  const estimate =
    calibratedBase !== null && calibratedBase > 0
      ? calibratedBase
      : toFiniteNumber(prediction.pointEstimate);

  if (calibration?.applied) {
    return {
      estimate,
      lower: toFiniteNumber(calibration.baseRange?.min),
      upper: toFiniteNumber(calibration.baseRange?.max),
    };
  }

  return {
    estimate,
    lower: toFiniteNumber(prediction.priceRange?.min),
    upper: toFiniteNumber(prediction.priceRange?.max),
  };
}

export function buildPredictionSnapshot(prediction: EstimatedQuote): JsonObject {
  const selection = prediction.diagnostics?.selection;
  const base = baseValuesOf(prediction);
  const calibrationSnapshot = buildCalibrationSnapshot(prediction.calibration);

  return toJsonObject({
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,

    insurerCode: prediction.insurerCode,
    productLine: prediction.productLine,
    modelVersion: prediction.modelVersion,
    generatedAt: prediction.generatedAt,
    premiumBasis: prediction.premiumBasis,

    // Estes três são SEMPRE a estimativa BASE (= estimated_premium/estimated_lower/
    // estimated_upper). O que a UI mostrou está em `displayed`.
    pointEstimate: base.estimate,
    baseEstimate: base.estimate,
    lowerEstimate: base.lower,
    upperEstimate: base.upper,

    displayed: {
      pointEstimate: prediction.pointEstimate,
      lowerEstimate: prediction.priceRange?.min ?? null,
      upperEstimate: prediction.priceRange?.max ?? null,
      calibrationApplied: prediction.calibration?.applied ?? false,
      // O valor mostrado em grande («Calibração com cotações reais»), se houve.
      headlineEstimate: prediction.calibration?.headlineEstimate ?? null,
    },

    confidence: prediction.confidence,
    confidenceScore: prediction.confidenceScore ?? null,

    comparablePolicies: prediction.comparablePolicies,
    strongComparables: selection?.strongComparables ?? null,
    secondaryComparables: selection?.secondaryComparables ?? null,
    effectiveSampleSize: selection?.effectiveSampleSize ?? null,
    meanSimilarity: selection?.meanSimilarity ?? null,

    consideredFactors: prediction.consideredFactors ?? null,
    reasons: prediction.reasons,
    warnings: prediction.warnings,

    // Diagnóstico completo (erro histórico, intervalo, ajustes): útil para
    // calibrar mais tarde e já vem calculado, não se reconstrói.
    diagnostics: prediction.diagnostics ?? null,

    // Calibração (versão, modo, valor calibrado, amostra): separada da base.
    calibration: calibrationSnapshot ? calibrationSnapshotToJson(calibrationSnapshot) : null,
  });
}

export const REAL_QUOTE_SOURCE: QuoteObservationSource = "MANUAL_ENTRY";

/** Recalculado a partir de uma apólice já emitida (leave-one-out), não visto por ninguém. */
export const RETROACTIVE_SOURCE: QuoteObservationSource = "RETROACTIVE_PORTFOLIO";

export function buildInsurerQuoteSnapshot(
  real: RealQuoteData,
  enteredAt: string,
  source: QuoteObservationSource = REAL_QUOTE_SOURCE,
): JsonObject {
  return toJsonObject({
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    source,
    insurer: "ZURICH",
    enteredAt,
    amount: real.amount,
    basis: real.basis,
    productCode: real.productCode,
    productName: real.productName,
    reference: real.reference,
  });
}

// ---------- validação + mapeamento para colunas ----------

export type BuildObservationParams = {
  clientId?: string | null;
  policyId?: string | null;

  request: QuoteRequest;
  prediction: EstimatedQuote;
  realQuote: RealQuoteData;

  status: ObservationStatus;
  duplicateOf?: string | null;
  notes?: string | null;

  /** Momento em que a cotação real foi introduzida (ISO). */
  quotedAt: string;

  /** Por omissão MANUAL_ENTRY (o agente viu o preço no portal). */
  source?: QuoteObservationSource;
};

export type BuildObservationResult =
  | { ok: true; row: ZurichQuoteObservationInsert }
  | { ok: false; errors: string[] };

const MAX_ESTIMATE = 1_000_000;

/**
 * Valida (no servidor, sem confiar na UI) e constrói a linha a inserir.
 * Rejeita: valor real <= 0, previsão inexistente/inválida, versão do modelo
 * vazia, snapshot do pedido vazio, base/estado desconhecidos.
 */
export function buildObservationInsert(
  params: BuildObservationParams,
): BuildObservationResult {
  const { request, prediction, realQuote } = params;
  const errors: string[] = [];

  // ---- previsão ----
  if (!prediction || typeof prediction !== "object") {
    errors.push("Previsão inexistente.");
  } else {
    if (prediction.status !== "ESTIMATED" || prediction.insurerCode !== "ZURICH") {
      errors.push("A previsão não é uma estimativa Zurich.");
    }

    const estimate = baseValuesOf(prediction).estimate;

    if (estimate === null || estimate <= 0 || estimate > MAX_ESTIMATE) {
      errors.push("Estimativa interna inválida.");
    }

    if (normalizeText(prediction.modelVersion) === null) {
      errors.push("Versão do modelo em falta.");
    }
  }

  // ---- pedido ----
  const requestSnapshot = request ? buildRequestSnapshot(request) : {};

  if (!request || Object.keys(requestSnapshot).length === 0) {
    errors.push("Snapshot do pedido vazio.");
  }

  // ---- cotação real ----
  const amount = toFiniteNumber(realQuote?.amount);

  if (amount === null || amount <= 0) {
    errors.push("O valor real da Zurich tem de ser superior a 0.");
  } else if (amount > MAX_REAL_QUOTE_AMOUNT) {
    errors.push("O valor real da Zurich é demasiado elevado.");
  }

  if (!realQuote || !REAL_QUOTE_BASES.includes(realQuote.basis)) {
    errors.push("Base do preço inválida.");
  }

  if (!OBSERVATION_STATUSES.includes(params.status)) {
    errors.push("Estado inválido.");
  }

  const notes = normalizeText(params.notes);

  if (notes !== null && notes.length > MAX_NOTES_LENGTH) {
    errors.push("Notas demasiado longas.");
  }

  const quotedAt = normalizeTimestamp(params.quotedAt);

  if (quotedAt === null) {
    errors.push("Data da cotação inválida.");
  }

  const clientId = params.clientId ?? request?.clientId ?? null;

  if (clientId !== null && !isUuid(clientId)) {
    errors.push("Cliente inválido.");
  }

  const policyId = params.policyId ?? null;

  if (policyId !== null && !isUuid(policyId)) {
    errors.push("Apólice inválida.");
  }

  const duplicateOf = params.duplicateOf ?? null;

  if (duplicateOf !== null && !isUuid(duplicateOf)) {
    errors.push("Referência de duplicado inválida.");
  }

  if (params.status === "DUPLICATE" && duplicateOf === null) {
    errors.push("Um duplicado tem de indicar a observação original.");
  }

  if (errors.length > 0 || quotedAt === null || amount === null) {
    return { ok: false, errors };
  }

  const coverages = request.requestedCoverages;
  const selection = prediction.diagnostics?.selection;
  // estimated_premium = estimativa BASE, sempre (nunca o valor calibrado).
  const base = baseValuesOf(prediction);
  const estimate = base.estimate as number;

  const real: RealQuoteData = {
    amount,
    basis: realQuote.basis,
    productCode: normalizeText(realQuote.productCode),
    productName: normalizeText(realQuote.productName),
    reference: normalizeText(realQuote.reference),
  };

  return {
    ok: true,
    row: {
      quoted_at: quotedAt,

      client_id: clientId,
      policy_id: policyId,

      model_version: normalizeText(prediction.modelVersion) as string,
      request_snapshot: requestSnapshot,
      prediction_snapshot: buildPredictionSnapshot(prediction),
      insurer_quote_snapshot: buildInsurerQuoteSnapshot(
        real,
        quotedAt,
        params.source ?? REAL_QUOTE_SOURCE,
      ),

      vehicle_registration: normalizePlate(request.vehicle?.registration),
      postal_code: normalizePostalCode(request.customer?.postalCode),
      birth_date: normalizeDate(request.customer?.birthDate),
      // Guardada SEMPRE que existir (não é usada pelo modelo histórico).
      driving_licence_date: normalizeDate(request.customer?.drivingLicenceDate),
      usage_type: normalizeText(request.customer?.usage),
      coverage_tier: coverages ? tierFromRequestedCoverages(coverages) : null,
      deductible: toFiniteNumber(coverages?.deductible),
      payment_frequency: normalizeText(request.paymentFrequency),

      estimated_premium: estimate,
      estimated_lower: base.lower,
      estimated_upper: base.upper,
      confidence_score: toFiniteNumber(prediction.confidenceScore),
      confidence_label: normalizeText(prediction.confidence),
      strong_comparables: toRoundedInteger(selection?.strongComparables),
      secondary_comparables: toRoundedInteger(selection?.secondaryComparables),
      effective_sample_size: toFiniteNumber(selection?.effectiveSampleSize),
      mean_similarity: toFiniteNumber(selection?.meanSimilarity),

      real_quote_amount: real.amount,
      real_quote_basis: real.basis,
      real_product_code: real.productCode,
      real_product_name: real.productName,
      real_quote_reference: real.reference,

      status: params.status,
      duplicate_of: duplicateOf,
      notes,
    },
  };
}
