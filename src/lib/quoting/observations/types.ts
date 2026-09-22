/*
 * Tipos da recolha de cotações reais Zurich (ground truth do simulador Auto).
 *
 * Espelham a tabela EXISTENTE public.zurich_quote_observations (criada fora
 * desta base de código; nenhuma migration aqui). O projeto não tem tipos
 * Supabase gerados, por isso definem-se só as colunas que a aplicação usa.
 *
 * ESTIMATIVA BASE vs CALIBRADA. `estimated_premium` é SEMPRE a estimativa BASE
 * do modelo histórico (nunca o valor calibrado, mesmo que a UI o tenha mostrado);
 * `model_version` é a versão do modelo BASE. A calibração vive só em
 * prediction_snapshot.calibration (ver ZurichCalibrationSnapshot), com a sua
 * própria versão. Assim os erros gerados pela BD medem a base e o erro
 * calibrado mede-se à parte.
 *
 * COLUNAS GERADAS PELA BD (signed_error, absolute_error, relative_error): nunca
 * se escrevem. Convenção: signed_error = estimated_premium - real_quote_amount
 *   negativo = o modelo SUBESTIMOU; positivo = SOBRESTIMOU
 *   absolute_error = |signed_error|; relative_error = absolute_error / real.
 */

export const OBSERVATION_STATUSES = [
  "VALID",
  "INVALID",
  "INCOMPLETE",
  "DUPLICATE",
  "TEST",
  "MANUAL_OVERRIDE",
  "EXPIRED",
] as const;

export type ObservationStatus = (typeof OBSERVATION_STATUSES)[number];

/** Estados que o utilizador pode escolher (DUPLICATE só o sistema atribui). */
export const USER_SELECTABLE_STATUSES: readonly ObservationStatus[] = [
  "VALID",
  "INCOMPLETE",
  "INVALID",
  "TEST",
  "MANUAL_OVERRIDE",
  "EXPIRED",
];

export const REAL_QUOTE_BASES = [
  "ANNUAL",
  "TOTAL",
  "INSTALLMENT",
  "COMMERCIAL",
  "UNKNOWN",
] as const;

export type RealQuoteBasis = (typeof REAL_QUOTE_BASES)[number];

/** Valor JSON seguro (sem undefined, NaN nem Infinity). */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

/**
 * Snapshot da calibração em prediction_snapshot.calibration. `calibratedEstimate`
 * é null quando não houve calibração (sem observações compatíveis, desativada):
 * nunca a base repetida.
 */
export type ZurichCalibrationSnapshot = {
  /** Versão da calibração (independente da model_version). */
  version: string;

  /** Modo de configuração no momento da cotação. */
  mode: "DISABLED" | "EXPERIMENTAL" | "PRODUCTION";

  /** Estratégia usada: NONE, GLOBAL, SEGMENT ou NEAREST_QUOTES. */
  strategy: "NONE" | "GLOBAL" | "SEGMENT" | "NEAREST_QUOTES";

  /** = estimated_premium. */
  baseEstimate: number;
  baseRange: { min: number; max: number } | null;

  calibratedEstimate: number | null;
  productionSafeEstimate: number | null;
  adjustmentAmount: number | null;
  adjustmentPercent: number | null;

  experimental: boolean;
  applied: boolean;
  eligibleForProduction: boolean;

  sampleSize: number;
  productionSampleSize: number;
  effectiveSampleSize: number | null;

  confidence: "LOW" | "MEDIUM" | "HIGH";
  meanSimilarity: number | null;
  reason: string;

  /** Versão do modelo base a que a calibração se refere. */
  modelVersion: string;
};

/** Cotação real introduzida pelo agente (já validada e normalizada). */
export type RealQuoteData = {
  amount: number;
  basis: RealQuoteBasis;
  productCode: string | null;
  productName: string | null;
  reference: string | null;
};

/** Colunas escritas na inserção (as geradas e as com default ficam de fora). */
export type ZurichQuoteObservationInsert = {
  quoted_at: string;

  client_id: string | null;
  policy_id: string | null;

  model_version: string;
  request_snapshot: JsonObject;
  prediction_snapshot: JsonObject;
  insurer_quote_snapshot: JsonObject;

  vehicle_registration: string | null;
  postal_code: string | null;
  birth_date: string | null;
  driving_licence_date: string | null;
  usage_type: string | null;
  coverage_tier: string | null;
  deductible: number | null;
  payment_frequency: string | null;

  estimated_premium: number;
  estimated_lower: number | null;
  estimated_upper: number | null;
  confidence_score: number | null;
  confidence_label: string | null;
  strong_comparables: number | null;
  secondary_comparables: number | null;
  effective_sample_size: number | null;
  mean_similarity: number | null;

  real_quote_amount: number;
  real_quote_basis: RealQuoteBasis;
  real_product_code: string | null;
  real_product_name: string | null;
  real_quote_reference: string | null;

  status: ObservationStatus;
  duplicate_of: string | null;
  notes: string | null;
};

/** Linha devolvida após inserir (inclui o que a BD gera). */
export type ZurichQuoteObservationRow = ZurichQuoteObservationInsert & {
  id: string;
  created_at: string;
  signed_error: number | null;
  absolute_error: number | null;
  relative_error: number | null;
};

/** Só o que o dedupe precisa de uma linha existente. */
export type DuplicateCandidate = Pick<
  ZurichQuoteObservationRow,
  | "id"
  | "created_at"
  | "quoted_at"
  | "status"
  | "vehicle_registration"
  | "birth_date"
  | "driving_licence_date"
  | "postal_code"
  | "coverage_tier"
  | "deductible"
  | "payment_frequency"
  | "real_product_code"
  | "real_product_name"
  | "real_quote_reference"
  | "real_quote_amount"
  | "real_quote_basis"
>;

/** Só o que as métricas precisam. */
export type MetricsRow = Pick<
  ZurichQuoteObservationRow,
  | "id"
  | "status"
  | "model_version"
  | "quoted_at"
  | "coverage_tier"
  | "real_product_code"
  | "real_quote_basis"
  | "estimated_premium"
  | "real_quote_amount"
  | "signed_error"
  | "absolute_error"
  | "relative_error"
> & {
  /** prediction_snapshot.calibration (jsonb) ou null: para as métricas calibradas. */
  calibration: JsonValue | null;
};

/** O que a calibração precisa de uma observação (inclui os snapshots). */
export type CalibrationRow = Pick<
  ZurichQuoteObservationRow,
  | "id"
  | "status"
  | "model_version"
  | "quoted_at"
  | "birth_date"
  | "driving_licence_date"
  | "postal_code"
  | "usage_type"
  | "coverage_tier"
  | "deductible"
  | "payment_frequency"
  | "real_product_code"
  | "real_product_name"
  | "real_quote_basis"
  | "estimated_premium"
  | "real_quote_amount"
  | "request_snapshot"
  | "prediction_snapshot"
>;

export type MetricsFilters = {
  /** Versão do modelo BASE. */
  modelVersion?: string | null;

  /** Versão da calibração; "NONE" = observações sem calibração. */
  calibrationVersion?: string | null;

  /** Modo da calibração (DISABLED/EXPERIMENTAL/PRODUCTION); "NONE" = sem calibração. */
  calibrationMode?: string | null;

  /** ISO (inclusivo) sobre quoted_at. */
  from?: string | null;
  /** ISO (exclusivo) sobre quoted_at. */
  to?: string | null;
  coverageTier?: string | null;
  productCode?: string | null;
  basis?: RealQuoteBasis | null;
};

/**
 * Acesso à BD, injetável. A implementação Supabase vive à parte
 * (supabase-store.ts); os testes usam uma em memória.
 */
export type ObservationStore = {
  insert(row: ZurichQuoteObservationInsert): Promise<ZurichQuoteObservationRow>;

  /** Linhas VALID/MANUAL_OVERRIDE com a mesma matrícula ou referência (max. 2 queries). */
  findDuplicateCandidates(query: {
    plate: string | null;
    reference: string | null;
  }): Promise<DuplicateCandidate[]>;

  /** Linhas com status = VALID que cumprem os filtros (sem o de versão do modelo). */
  listValidForMetrics(
    filters: Omit<MetricsFilters, "modelVersion" | "calibrationVersion" | "calibrationMode">,
  ): Promise<MetricsRow[]>;

  /** Observações com status = VALID, com snapshots, para calibrar (uma leitura paginada). */
  listForCalibration(): Promise<CalibrationRow[]>;
};
