import { createAdminClient } from "@/lib/supabase/admin";
import { toFiniteNumber } from "./normalize";
import type {
  CalibrationRow,
  DuplicateCandidate,
  MetricsFilters,
  MetricsRow,
  ObservationStatus,
  ObservationStore,
  RealQuoteBasis,
  ZurichQuoteObservationInsert,
  ZurichQuoteObservationRow,
} from "./types";

/*
 * Implementação Supabase do ObservationStore, sobre a tabela EXISTENTE
 * public.zurich_quote_observations (sem migrations nem alterações de schema).
 *
 * Só server-side (cliente com service role). Não escreve as colunas geradas
 * (signed_error, absolute_error, relative_error).
 *
 * PRIVACIDADE: as mensagens de erro do Postgres/PostgREST podem incluir a
 * linha inteira ("Failing row contains ..."), ou seja, PII. Por isso nunca
 * se propaga nem regista `error.message`/`details`: só o código.
 */

const TABLE = "zurich_quote_observations";
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
const CANDIDATE_LIMIT = 200;

const ROW_COLUMNS = `
  id, created_at, quoted_at, client_id, policy_id, model_version,
  request_snapshot, prediction_snapshot, insurer_quote_snapshot,
  vehicle_registration, postal_code, birth_date, driving_licence_date,
  usage_type, coverage_tier, deductible, payment_frequency,
  estimated_premium, estimated_lower, estimated_upper, confidence_score,
  confidence_label, strong_comparables, secondary_comparables,
  effective_sample_size, mean_similarity, real_quote_amount, real_quote_basis,
  real_product_code, real_product_name, real_quote_reference,
  signed_error, absolute_error, relative_error, status, duplicate_of, notes
`;

const CANDIDATE_COLUMNS = `
  id, created_at, quoted_at, status, vehicle_registration, birth_date,
  driving_licence_date, postal_code, coverage_tier, deductible,
  payment_frequency, real_product_code, real_product_name,
  real_quote_reference, real_quote_amount, real_quote_basis
`;

// A calibração vai como sub-objeto do jsonb (não se transfere o snapshot inteiro).
const METRICS_COLUMNS = `
  id, status, model_version, quoted_at, coverage_tier, real_product_code,
  real_quote_basis, estimated_premium, real_quote_amount, signed_error,
  absolute_error, relative_error, calibration:prediction_snapshot->calibration
`;

const CALIBRATION_COLUMNS = `
  id, status, model_version, quoted_at, birth_date, driving_licence_date,
  postal_code, usage_type, coverage_tier, deductible, payment_frequency,
  real_product_code, real_product_name, real_quote_basis, estimated_premium,
  real_quote_amount, request_snapshot, prediction_snapshot
`;

export class ObservationStoreError extends Error {
  constructor(action: string, code: string | undefined) {
    // Sem detalhes da BD: podem conter dados pessoais.
    super(`Falha ao ${action} (código ${code ?? "desconhecido"}).`);
    this.name = "ObservationStoreError";
  }
}

type Client = ReturnType<typeof createAdminClient>;

type RawRecord = Record<string, unknown>;

const num = (value: unknown): number | null => toFiniteNumber(value);

function numberOrThrow(value: unknown): number {
  const parsed = toFiniteNumber(value);

  if (parsed === null) {
    throw new ObservationStoreError("ler uma observação", "valor numérico inválido");
  }

  return parsed;
}

function toRow(raw: RawRecord): ZurichQuoteObservationRow {
  return {
    ...(raw as unknown as ZurichQuoteObservationRow),
    deductible: num(raw.deductible),
    estimated_premium: numberOrThrow(raw.estimated_premium),
    estimated_lower: num(raw.estimated_lower),
    estimated_upper: num(raw.estimated_upper),
    confidence_score: num(raw.confidence_score),
    strong_comparables: num(raw.strong_comparables),
    secondary_comparables: num(raw.secondary_comparables),
    effective_sample_size: num(raw.effective_sample_size),
    mean_similarity: num(raw.mean_similarity),
    real_quote_amount: numberOrThrow(raw.real_quote_amount),
    signed_error: num(raw.signed_error),
    absolute_error: num(raw.absolute_error),
    relative_error: num(raw.relative_error),
  };
}

function toCandidate(raw: RawRecord): DuplicateCandidate {
  return {
    id: String(raw.id),
    created_at: String(raw.created_at),
    quoted_at: String(raw.quoted_at),
    status: raw.status as ObservationStatus,
    vehicle_registration: (raw.vehicle_registration as string | null) ?? null,
    birth_date: (raw.birth_date as string | null) ?? null,
    driving_licence_date: (raw.driving_licence_date as string | null) ?? null,
    postal_code: (raw.postal_code as string | null) ?? null,
    coverage_tier: (raw.coverage_tier as string | null) ?? null,
    deductible: num(raw.deductible),
    payment_frequency: (raw.payment_frequency as string | null) ?? null,
    real_product_code: (raw.real_product_code as string | null) ?? null,
    real_product_name: (raw.real_product_name as string | null) ?? null,
    real_quote_reference: (raw.real_quote_reference as string | null) ?? null,
    real_quote_amount: numberOrThrow(raw.real_quote_amount),
    real_quote_basis: raw.real_quote_basis as RealQuoteBasis,
  };
}

function toMetricsRow(raw: RawRecord): MetricsRow | null {
  const estimated = num(raw.estimated_premium);
  const real = num(raw.real_quote_amount);

  // Linhas sem números utilizáveis não entram (nunca viram 0).
  if (estimated === null || real === null) return null;

  return {
    id: String(raw.id),
    status: raw.status as ObservationStatus,
    model_version: String(raw.model_version),
    quoted_at: String(raw.quoted_at),
    coverage_tier: (raw.coverage_tier as string | null) ?? null,
    real_product_code: (raw.real_product_code as string | null) ?? null,
    real_quote_basis: raw.real_quote_basis as RealQuoteBasis,
    estimated_premium: estimated,
    real_quote_amount: real,
    signed_error: num(raw.signed_error),
    absolute_error: num(raw.absolute_error),
    relative_error: num(raw.relative_error),
    calibration: (raw.calibration as MetricsRow["calibration"]) ?? null,
  };
}

/** Escapa % _ \ para usar o valor num ilike como igualdade sem maiúsculas/minúsculas. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function toCalibrationRow(raw: RawRecord): CalibrationRow | null {
  const estimated = num(raw.estimated_premium);
  const real = num(raw.real_quote_amount);

  // Sem números utilizáveis a observação não serve (nunca vira 0).
  if (estimated === null || real === null) return null;

  return {
    id: String(raw.id),
    status: raw.status as ObservationStatus,
    model_version: String(raw.model_version),
    quoted_at: String(raw.quoted_at),
    birth_date: (raw.birth_date as string | null) ?? null,
    driving_licence_date: (raw.driving_licence_date as string | null) ?? null,
    postal_code: (raw.postal_code as string | null) ?? null,
    usage_type: (raw.usage_type as string | null) ?? null,
    coverage_tier: (raw.coverage_tier as string | null) ?? null,
    deductible: num(raw.deductible),
    payment_frequency: (raw.payment_frequency as string | null) ?? null,
    real_product_code: (raw.real_product_code as string | null) ?? null,
    real_product_name: (raw.real_product_name as string | null) ?? null,
    real_quote_basis: raw.real_quote_basis as RealQuoteBasis,
    estimated_premium: estimated,
    real_quote_amount: real,
    request_snapshot:
      (raw.request_snapshot as CalibrationRow["request_snapshot"]) ?? {},
    prediction_snapshot:
      (raw.prediction_snapshot as CalibrationRow["prediction_snapshot"]) ?? {},
  };
}

export function createSupabaseObservationStore(
  client: Client = createAdminClient(),
): ObservationStore {
  return {
    async insert(row: ZurichQuoteObservationInsert) {
      const { data, error } = await client
        .from(TABLE)
        .insert(row)
        .select(ROW_COLUMNS)
        .single();

      if (error || !data) {
        throw new ObservationStoreError("guardar a observação", error?.code);
      }

      return toRow(data as unknown as RawRecord);
    },

    async findDuplicateCandidates({ plate, reference }) {
      const found = new Map<string, DuplicateCandidate>();

      const collect = (
        result: { data: unknown; error: { code?: string } | null },
      ) => {
        if (result.error) {
          throw new ObservationStoreError("procurar duplicados", result.error.code);
        }

        for (const raw of (result.data as RawRecord[] | null) ?? []) {
          const candidate = toCandidate(raw);

          found.set(candidate.id, candidate);
        }
      };

      // No máximo 2 consultas (matrícula, referência), nunca uma por linha.
      if (plate !== null) {
        collect(
          await client
            .from(TABLE)
            .select(CANDIDATE_COLUMNS)
            .in("status", ["VALID", "MANUAL_OVERRIDE"])
            .eq("vehicle_registration", plate)
            .order("created_at", { ascending: true })
            .limit(CANDIDATE_LIMIT),
        );
      }

      if (reference !== null) {
        collect(
          await client
            .from(TABLE)
            .select(CANDIDATE_COLUMNS)
            .in("status", ["VALID", "MANUAL_OVERRIDE"])
            .ilike("real_quote_reference", escapeLike(reference))
            .order("created_at", { ascending: true })
            .limit(CANDIDATE_LIMIT),
        );
      }

      return [...found.values()];
    },

    async listValidForMetrics(
      filters: Omit<MetricsFilters, "modelVersion" | "calibrationVersion" | "calibrationMode">,
    ) {
      const rows: MetricsRow[] = [];

      for (let page = 0; page < MAX_PAGES; page++) {
        let query = client
          .from(TABLE)
          .select(METRICS_COLUMNS)
          .eq("status", "VALID");

        if (filters.from) query = query.gte("quoted_at", filters.from);
        if (filters.to) query = query.lt("quoted_at", filters.to);
        if (filters.coverageTier) query = query.eq("coverage_tier", filters.coverageTier);
        if (filters.productCode) query = query.eq("real_product_code", filters.productCode);
        if (filters.basis) query = query.eq("real_quote_basis", filters.basis);

        const { data, error } = await query
          .order("quoted_at", { ascending: false })
          .order("id")
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

        if (error) {
          throw new ObservationStoreError("ler as métricas", error.code);
        }

        const batch = (data as unknown as RawRecord[] | null) ?? [];

        for (const raw of batch) {
          const row = toMetricsRow(raw);

          if (row) rows.push(row);
        }

        if (batch.length < PAGE_SIZE) break;
      }

      return rows;
    },

    async listForCalibration() {
      const rows: CalibrationRow[] = [];

      for (let page = 0; page < MAX_PAGES; page++) {
        const { data, error } = await client
          .from(TABLE)
          .select(CALIBRATION_COLUMNS)
          .eq("status", "VALID")
          .order("quoted_at", { ascending: false })
          .order("id")
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

        if (error) {
          throw new ObservationStoreError("ler as cotações reais", error.code);
        }

        const batch = (data as unknown as RawRecord[] | null) ?? [];

        for (const raw of batch) {
          const row = toCalibrationRow(raw);

          if (row) rows.push(row);
        }

        if (batch.length < PAGE_SIZE) break;
      }

      return rows;
    },
  };
}
