import type { EstimatedQuote, QuoteRequest } from "../domain/types";
import { findPossibleDuplicate, type DuplicateMatch } from "./dedupe";
import { buildAccuracyReport, type AccuracyReport } from "./metrics";
import { normalizeDate, normalizeText } from "./normalize";
import { buildObservationInsert } from "./snapshots";
import type {
  MetricsFilters,
  ObservationStatus,
  ObservationStore,
  RealQuoteData,
  ZurichQuoteObservationRow,
} from "./types";

/*
 * Serviço de recolha de cotações reais Zurich (ground truth).
 *
 *   pedido do simulador -> previsão interna -> cotação real -> observation
 *
 * NÃO altera o preço do simulador: só regista e mede. A futura calibração
 * (estimativa base + ajuste calibrado = estimativa final) ficará noutra
 * camada, aplicada só depois de validada em backtest; nada aqui a antecipa.
 *
 * Toda a I/O passa pelo `ObservationStore` (injeção), por isso este módulo é
 * puro e testável; a implementação Supabase está em supabase-store.ts.
 */

export type SaveZurichQuoteObservationParams = {
  clientId?: string | null;
  policyId?: string | null;

  /** Pedido e previsão tal como existiam no momento da simulação. */
  request: QuoteRequest;
  prediction: EstimatedQuote;

  realQuote: RealQuoteData;

  /** Por omissão VALID. DUPLICATE só é atribuído pelo dedupe. */
  status?: ObservationStatus;
  notes?: string | null;

  /** Por omissão, agora. */
  quotedAt?: string;

  store: ObservationStore;
};

export type SaveZurichQuoteObservationResult =
  | {
      ok: true;
      observation: ZurichQuoteObservationRow;

      /** Preenchido quando a linha foi marcada como duplicado (nada foi apagado). */
      duplicate: DuplicateMatch | null;
    }
  | { ok: false; errors: string[] };

export async function saveZurichQuoteObservation(
  params: SaveZurichQuoteObservationParams,
): Promise<SaveZurichQuoteObservationResult> {
  const requestedStatus = params.status ?? "VALID";

  // DUPLICATE não se escolhe: só o dedupe o atribui (com duplicate_of).
  if (requestedStatus === "DUPLICATE") {
    return { ok: false, errors: ["O estado DUPLICATE é atribuído automaticamente."] };
  }

  const quotedAt = params.quotedAt ?? new Date().toISOString();

  const base = {
    clientId: params.clientId,
    policyId: params.policyId,
    request: params.request,
    prediction: params.prediction,
    realQuote: params.realQuote,
    notes: params.notes,
    quotedAt,
  };

  // 1) Valida tudo com o estado pedido (erros devolvem-se sem tocar na BD).
  const built = buildObservationInsert({ ...base, status: requestedStatus });

  if (!built.ok) return built;

  // 2) Dedupe só para observações que contariam nas métricas (VALID).
  let duplicate: DuplicateMatch | null = null;

  if (requestedStatus === "VALID") {
    const row = built.row;

    const candidates = await params.store.findDuplicateCandidates({
      plate: row.vehicle_registration,
      reference: row.real_quote_reference,
    });

    duplicate = findPossibleDuplicate(
      {
        plate: row.vehicle_registration,
        reference: row.real_quote_reference,
        birthDate: row.birth_date,
        drivingLicenceDate: row.driving_licence_date,
        postalCode: row.postal_code,
        coverageTier: row.coverage_tier,
        deductible: row.deductible,
        paymentFrequency: row.payment_frequency,
        productCode: row.real_product_code,
        productName: row.real_product_name,
        quotedAt: row.quoted_at,
        amount: row.real_quote_amount,
      },
      candidates,
    );
  }

  // 3) Duplicado claro: guarda-se na mesma (nunca se apaga), mas fora das métricas.
  const finalRow = duplicate
    ? buildObservationInsert({
        ...base,
        status: "DUPLICATE",
        duplicateOf: duplicate.duplicateOf,
      })
    : built;

  if (!finalRow.ok) return finalRow;

  const observation = await params.store.insert(finalRow.row);

  return { ok: true, observation, duplicate };
}

/**
 * Métricas de exatidão sobre observações VALID. Uma única leitura à BD
 * (paginada no store) e cálculo em memória; sem N+1.
 */
export async function getZurichQuoteAccuracyMetrics(
  filters: MetricsFilters,
  store: ObservationStore,
): Promise<AccuracyReport> {
  // Versão do modelo, calibração e origem filtram-se em memória (para as
  // mostrar lado a lado, incl. o bloco bySource que ignora o filtro de origem).
  const { modelVersion, calibrationVersion, calibrationMode, source, ...databaseFilters } =
    filters;

  const rows = await store.listValidForMetrics({
    from: normalizeDate(databaseFilters.from) ?? null,
    to: normalizeDate(databaseFilters.to) ?? null,
    coverageTier: normalizeText(databaseFilters.coverageTier),
    productCode: normalizeText(databaseFilters.productCode),
    basis: databaseFilters.basis ?? null,
  });

  return buildAccuracyReport(rows, {
    ...filters,
    modelVersion: normalizeText(modelVersion),
    calibrationVersion: normalizeText(calibrationVersion),
    calibrationMode: normalizeText(calibrationMode),
    source: source ?? null,
  });
}
