import type { QuoteRequest } from "../../../domain/types";
import {
  comparableText,
  normalizeText,
  toFiniteNumber,
} from "../../../observations/normalize";
import type {
  CalibrationRow,
  RealQuoteBasis,
} from "../../../observations/types";
import { tierFromRequestedCoverages } from "../zurich-auto-coverages";

/*
 * Features das cotações reais Zurich (e do pedido atual) para calibrar.
 *
 * Só se usam campos que EXISTEM: colunas da observação e o que o
 * request_snapshot realmente guardou. Desconhecido = null, nunca 0. NÃO são
 * features: NIF, client_id, policy_id, número de apólice; a matrícula não é
 * feature estatística (identifica a viatura, nada mais).
 *
 * A idade e os anos de carta calculam-se NA DATA DA COTAÇÃO (quoted_at), não
 * hoje: uma cotação de há um ano com 1,8 anos de carta valia 1,8 anos então.
 */

const YEAR_MS = 365.25 * 86_400_000;

export type VehicleFeatures = {
  marketValue: number | null;
  make: string | null;
  fuelType: string | null;
  powerKw: number | null;
  engineCc: number | null;
  firstRegistrationYear: number | null;
};

export type CalibrationTarget = {
  tier: string;
  ageYears: number | null;
  licenceYears: number | null;
  usage: string | null;
  productCode: string | null;
  productName: string | null;
  deductible: number | null;
  postal: string | null;
  paymentFrequency: string | null;
  claims3Y: number | null;
  vehicle: VehicleFeatures;
};

export type CalibrationObservation = CalibrationTarget & {
  id: string;
  modelVersion: string;

  /** Instante da cotação (ms); null se inválido. */
  quotedAtMs: number | null;

  basis: RealQuoteBasis;

  /** Estimativa BASE (histórica) que gerou o resíduo. */
  baseEstimate: number;
  realAmount: number;

  /** null = tier desconhecido. */
  tier: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMs(value: unknown): number | null {
  if (typeof value !== "string") return null;

  const ms = Date.parse(value);

  return Number.isNaN(ms) ? null : ms;
}

/** Anos entre duas datas; null se alguma faltar/for inválida ou o resultado for negativo. */
export function yearsBetween(fromDate: unknown, atMs: number | null): number | null {
  const from = parseMs(fromDate);

  if (from === null || atMs === null) return null;

  const years = (atMs - from) / YEAR_MS;

  return years >= 0 ? years : null;
}

function readVehicle(snapshot: unknown): VehicleFeatures {
  const vehicle =
    isRecord(snapshot) && isRecord(snapshot.vehicle) ? snapshot.vehicle : {};

  const first = parseMs(vehicle.firstRegistrationDate);

  return {
    marketValue: positive(toFiniteNumber(vehicle.marketValue)),
    make: normalizeText(vehicle.make),
    fuelType: normalizeText(vehicle.fuelType),
    powerKw: positive(toFiniteNumber(vehicle.powerKw)),
    engineCc: positive(toFiniteNumber(vehicle.engineCc)),
    firstRegistrationYear: first === null ? null : new Date(first).getUTCFullYear(),
  };
}

function positive(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

function readClaims3Y(snapshot: unknown): number | null {
  if (!isRecord(snapshot)) return null;

  const direct = toFiniteNumber(snapshot.claimsLast3Years);

  if (direct !== null) return direct;

  return isRecord(snapshot.claims) ? toFiniteNumber(snapshot.claims.claims3Y) : null;
}

/**
 * Estimativa BASE de uma observação. Se a previsão já trazia a calibração,
 * o resíduo mede-se contra a base (não contra o pointEstimate final, que
 * poderia já incluir uma correção: contá-la duas vezes).
 */
export function baseEstimateOf(row: CalibrationRow): number | null {
  const prediction = isRecord(row.prediction_snapshot) ? row.prediction_snapshot : {};
  const calibration = isRecord(prediction.calibration) ? prediction.calibration : null;
  const base = calibration ? toFiniteNumber(calibration.baseEstimate) : null;

  const value = base !== null && base > 0 ? base : row.estimated_premium;

  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Observação pronta a comparar; null se não tiver números utilizáveis. */
export function toCalibrationObservation(
  row: CalibrationRow,
): CalibrationObservation | null {
  const baseEstimate = baseEstimateOf(row);
  const realAmount = toFiniteNumber(row.real_quote_amount);

  if (baseEstimate === null || realAmount === null || realAmount <= 0) {
    return null;
  }

  const quotedAtMs = parseMs(row.quoted_at);

  return {
    id: row.id,
    modelVersion: normalizeText(row.model_version) ?? "",
    quotedAtMs,
    basis: row.real_quote_basis,
    baseEstimate,
    realAmount,

    tier: normalizeText(row.coverage_tier) ?? "",
    ageYears: yearsBetween(row.birth_date, quotedAtMs),
    licenceYears: yearsBetween(row.driving_licence_date, quotedAtMs),
    usage: normalizeText(row.usage_type),
    productCode: normalizeText(row.real_product_code),
    productName: normalizeText(row.real_product_name),
    deductible: toFiniteNumber(row.deductible),
    postal: normalizeText(row.postal_code),
    paymentFrequency: normalizeText(row.payment_frequency),
    claims3Y: readClaims3Y(row.request_snapshot),
    vehicle: readVehicle(row.request_snapshot),
  };
}

/** O pedido atual, no mesmo espaço das observações, à data `now`. */
export function extractCalibrationTarget(
  request: QuoteRequest,
  now: Date,
): CalibrationTarget {
  const nowMs = now.getTime();
  const coverages = request.requestedCoverages;
  const rawProduct = request.metadata?.productCode;
  const vehicle = request.vehicle;

  const first = vehicle ? parseMs(vehicle.firstRegistrationDate) : null;

  return {
    tier: coverages ? tierFromRequestedCoverages(coverages) : "",
    ageYears: yearsBetween(request.customer?.birthDate, nowMs),
    licenceYears: yearsBetween(request.customer?.drivingLicenceDate, nowMs),
    usage: normalizeText(request.customer?.usage),
    productCode: typeof rawProduct === "string" ? normalizeText(rawProduct) : null,
    productName: null,
    deductible: toFiniteNumber(coverages?.deductible),
    postal: normalizeText(request.customer?.postalCode),
    paymentFrequency: normalizeText(request.paymentFrequency),
    claims3Y: toFiniteNumber(request.claims?.claims3Y),
    vehicle: {
      marketValue: positive(toFiniteNumber(vehicle?.marketValue)),
      make: normalizeText(vehicle?.make),
      fuelType: normalizeText(vehicle?.fuelType),
      powerKw: positive(toFiniteNumber(vehicle?.powerKw)),
      engineCc: positive(toFiniteNumber(vehicle?.engineCc)),
      firstRegistrationYear: first === null ? null : new Date(first).getUTCFullYear(),
    },
  };
}

/** Texto comparável de uma marca/combustível/produto. */
export function sameText(a: string | null, b: string | null): boolean | null {
  const left = comparableText(a);
  const right = comparableText(b);

  return left === null || right === null ? null : left === right;
}
