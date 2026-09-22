// =====================================================
// ZURICH - BACKFILL DE METADATA DE APÓLICES EXISTENTES
// =====================================================
//
// TEMPORÁRIO. Atualiza APENAS `policies.provider_metadata` de apólices
// Zurich que JÁ EXISTEM na BD, com objetos e coberturas obtidos por
// consulta individual (ObterObjetosPorNrApolice /
// ObterCoberturasPorApolice).
//
// NÃO faz, em circunstância alguma:
//   - criar apólices;
//   - criar ou atualizar clientes;
//   - tocar em recibos;
//   - alterar outras colunas de `policies` (só provider_metadata);
//   - correr o sync incremental nem mexer no seu estado.
//
// Segurança de dados (produção):
//   - o merge NUNCA apaga: as chaves que o patch não traz ficam como
//     estão e as listas unem-se por chave (buildZurichEnrichmentPatch);
//   - a escrita só acontece se a apólice não mudou entre a leitura e a
//     escrita (compara last_synced_at, que o sync atualiza sempre): se o
//     sync mexeu entretanto, esta apólice é saltada e fica para a
//     próxima passagem, em vez de se sobrepor o trabalho do sync;
//   - sem `apply`, é só pré-visualização (lê da Zurich, NÃO escreve);
//   - a resposta nunca inclui NIF, IBAN, tokens nem nº de apólice
//     completo (só mascarado).
//
// Desempenho: apólices em série (concorrência 1), pausa entre
// consultas, retry só em erro de rede/5xx, orçamento de tempo por
// pedido, e cada apólice isolada (uma falha não pára as restantes).
// =====================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ZurichAccount } from "./client";
import { maskIdentifier, summarizeZurichError } from "./log-safety";
import { isEnrichmentMarkerFresh } from "./policy-enrichment";
import {
  buildZurichEnrichmentPatch,
  hasZurichCoverageContent,
  hasZurichObjectContent,
  isZurichAutoPolicy,
  readZurichEnrichmentMarkers,
  type ZurichCoverageInput,
  type ZurichObjectInput,
} from "./risk-enrichment";

export const BACKFILL_DEFAULT_LIMIT = 10;
export const BACKFILL_MAX_LIMIT = 25;

/**
 * Orçamento de tempo por pedido (ms). Não se conhece o limite de duração
 * das funções no deploy, por isso o lote pára sozinho e devolve o cursor
 * para continuar. Pelo menos 1 apólice é sempre processada.
 */
export const BACKFILL_DEFAULT_BUDGET_MS = 8_000;
export const BACKFILL_MAX_BUDGET_MS = 55_000;

/** Pausa após cada consulta à Zurich (ms). */
export const BACKFILL_PAUSE_MS = 250;

/**
 * Tempo máximo de UMA chamada à Zurich (ms). Uma chamada que não
 * responda a tempo é abandonada e tratada como falha dessa apólice.
 * O timeout NÃO é repetido (ver isRetryableZurichError): uma Zurich
 * pendurada não deve multiplicar a espera.
 */
export const BACKFILL_LOOKUP_TIMEOUT_MS = 12_000;

/** Esperas antes de cada repetição (só erro de rede ou 5xx). */
const RETRY_BACKOFF_MS = [500, 1_500] as const;

const MAX_ERROR_SAMPLES = 10;

export type BackfillParams = {
  /** Só com true se escreve. Caso contrário, pré-visualização. */
  apply: boolean;
  limit: number;
  /** id (interno) da última apólice já processada. */
  cursor: string | null;
  /** Reconsulta mesmo que os dados guardados sejam recentes. */
  force: boolean;
  budgetMs: number;
};

export type BackfillDeps = {
  supabase: SupabaseClient;
  getAccounts: () => ZurichAccount[];
  lookupObjects: (
    policyNumber: string,
    account: ZurichAccount,
  ) => Promise<readonly ZurichObjectInput[]>;
  lookupCoverages: (
    policyNumber: string,
    account: ZurichAccount,
  ) => Promise<readonly ZurichCoverageInput[]>;
  sleep: (ms: number) => Promise<void>;
  /** Relógio em ms (epoch). */
  now: () => number;
  /** Timeout por chamada à Zurich (ms). Omissão: BACKFILL_LOOKUP_TIMEOUT_MS. */
  lookupTimeoutMs?: number;
};

export type BackfillErrorSample = {
  policy: string;
  stage: "objects" | "coverages" | "write" | "unexpected";
  errorKind: string;
  operation?: string;
  zurichCode?: number;
  httpStatus?: number;
};

export type BackfillResult = {
  success: true;
  applied: boolean;

  /** Apólices examinadas neste pedido (inclui as saltadas). */
  processed: number;
  updated: number;
  /** Só em pré-visualização: as que seriam atualizadas. */
  wouldUpdate: number;
  skipped: number;
  failed: number;

  nextCursor: string | null;
  hasMore: boolean;
  stoppedByBudget: boolean;

  objectsLoaded: number;
  coveragesLoaded: number;
  noVehicle: number;
  ambiguousVehicle: number;

  skippedBy: {
    notAuto: number;
    noAccount: number;
    fresh: number;
    noData: number;
    changedMeanwhile: number;
  };

  /** Apólices atualizadas só com um dos recursos (o outro falhou). */
  partial: number;
  retries: number;
  /** Chamadas à Zurich abandonadas por timeout. */
  timeouts: number;
  zurichCalls: number;

  errors: BackfillErrorSample[];
  elapsedMs: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Conta Zurich da loja da apólice, ou null se não houver forma segura de
 * a escolher. Nunca se consulta com a conta errada:
 *   - com storeExternalCode: só a conta que tenha esse código;
 *   - sem storeExternalCode: só se existir uma única conta configurada.
 */
export function resolveBackfillAccount(
  accounts: readonly ZurichAccount[],
  metadata: Record<string, unknown>,
): ZurichAccount | null {
  const storeCode =
    typeof metadata.storeExternalCode === "string"
      ? metadata.storeExternalCode.trim()
      : "";

  if (storeCode !== "") {
    return (
      accounts.find((account) => account.storeExternalCode === storeCode) ??
      null
    );
  }

  return accounts.length === 1 ? accounts[0] : null;
}

/**
 * A chamada à Zurich não respondeu dentro do tempo limite. O `name` fixo
 * é o que aparece nos erros devolvidos (summarizeZurichError usa-o); a
 * mensagem nunca inclui identificadores.
 */
export class ZurichLookupTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`A Zurich não respondeu em ${timeoutMs} ms.`);
    this.name = "ZurichLookupTimeout";
  }
}

/**
 * Rejeita com ZurichLookupTimeoutError se `work` não terminar a tempo.
 *
 * Limitação assumida: a chamada em curso NÃO é cancelada (as funções do
 * client não recebem AbortSignal); o resultado tardio é simplesmente
 * ignorado. O que fica garantido é que o backfill deixa de ESPERAR por
 * ela. A rejeição tardia fica tratada aqui (sem unhandled rejection).
 */
function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ZurichLookupTimeoutError(timeoutMs)),
      timeoutMs,
    );

    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Erro de rede (fetch falhou) ou HTTP 5xx: os únicos que se repetem. */
export function isRetryableZurichError(error: unknown): boolean {
  // Timeout: nunca se repete (uma Zurich pendurada multiplicaria a espera).
  if (error instanceof ZurichLookupTimeoutError) {
    return false;
  }

  const summary = summarizeZurichError(error);

  if (summary.errorKind === "ZURICH_HTTP") {
    return (summary.httpStatus ?? 0) >= 500;
  }

  if (summary.errorKind === "ZURICH_ERROR") {
    // Erro de negócio da Zurich (Código N): repetir não ajuda.
    return false;
  }

  if (!(error instanceof TypeError)) {
    return false;
  }

  const cause = (error as { cause?: { code?: unknown } }).cause;
  const text = `${error.message} ${String(cause?.code ?? "")}`;

  return /fetch failed|network|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket/i.test(
    text,
  );
}

type LineInfo = { code: string | null; name: string | null };

export async function runZurichEnrichmentBackfill(
  params: BackfillParams,
  deps: BackfillDeps,
): Promise<BackfillResult> {
  const { supabase } = deps;
  const startedAt = deps.now();

  const counters = {
    processed: 0,
    updated: 0,
    wouldUpdate: 0,
    failed: 0,
    objectsLoaded: 0,
    coveragesLoaded: 0,
    noVehicle: 0,
    ambiguousVehicle: 0,
    partial: 0,
    retries: 0,
    timeouts: 0,
    zurichCalls: 0,
  };

  const lookupTimeoutMs =
    typeof deps.lookupTimeoutMs === "number" &&
    Number.isFinite(deps.lookupTimeoutMs) &&
    deps.lookupTimeoutMs > 0
      ? deps.lookupTimeoutMs
      : BACKFILL_LOOKUP_TIMEOUT_MS;

  const skippedBy = {
    notAuto: 0,
    noAccount: 0,
    fresh: 0,
    noData: 0,
    changedMeanwhile: 0,
  };

  const errors: BackfillErrorSample[] = [];

  const recordError = (sample: BackfillErrorSample) => {
    if (errors.length < MAX_ERROR_SAMPLES) {
      errors.push(sample);
    }
  };

  async function withRetry<T>(work: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await work();
      } catch (error) {
        if (attempt >= RETRY_BACKOFF_MS.length || !isRetryableZurichError(error)) {
          throw error;
        }

        counters.retries += 1;
        await deps.sleep(RETRY_BACKOFF_MS[attempt]);
      }
    }
  }

  // ---------- companhia ----------

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id")
    .eq("code", "ZURICH")
    .maybeSingle();

  if (companyError) {
    throw new Error("Erro ao procurar a companhia Zurich.");
  }

  if (!company) {
    throw new Error("Companhia Zurich não encontrada.");
  }

  const accounts = deps.getAccounts();

  // ---------- lote (keyset por id; +1 para saber se há mais) ----------

  let query = supabase
    .from("policies")
    .select(
      "id, policy_number, product_code, product_name, insurance_line_id, provider_metadata, last_synced_at",
    )
    .eq("company_id", company.id)
    .order("id", { ascending: true })
    .limit(params.limit + 1);

  if (params.cursor) {
    query = query.gt("id", params.cursor);
  }

  const { data: rows, error: rowsError } = await query;

  if (rowsError) {
    throw new Error("Erro ao carregar apólices Zurich.");
  }

  const fetched = rows ?? [];
  const batch = fetched.slice(0, params.limit);

  let hasMore = fetched.length > params.limit;
  let stoppedByBudget = false;
  let lastProcessedId: string | null = null;

  const lineCache = new Map<string, LineInfo | null>();

  async function loadLineInfo(lineId: string | null): Promise<LineInfo | null> {
    if (!lineId) {
      return null;
    }

    if (lineCache.has(lineId)) {
      return lineCache.get(lineId) ?? null;
    }

    const { data, error } = await supabase
      .from("insurance_lines")
      .select("code, name")
      .eq("id", lineId)
      .maybeSingle();

    const info: LineInfo | null =
      error || !data
        ? null
        : { code: data.code ?? null, name: data.name ?? null };

    lineCache.set(lineId, info);

    return info;
  }

  // ---------- apólices, em série ----------

  for (let index = 0; index < batch.length; index++) {
    // Orçamento de tempo: pára sem perder o ponto onde ia. A 1.ª apólice
    // é sempre processada (garante progresso).
    if (index > 0 && deps.now() - startedAt >= params.budgetMs) {
      stoppedByBudget = true;
      hasMore = true;
      break;
    }

    const policy = batch[index];

    counters.processed += 1;
    lastProcessedId = String(policy.id);

    const masked = maskIdentifier(policy.policy_number);

    try {
      const metadata: Record<string, unknown> = isRecord(policy.provider_metadata)
        ? policy.provider_metadata
        : {};

      // ---- só Auto (sem qualquer consulta à Zurich para as outras) ----
      const lineInfo = await loadLineInfo(policy.insurance_line_id ?? null);

      if (
        !isZurichAutoPolicy({
          lineCode: lineInfo?.code,
          lineName: lineInfo?.name,
          productCode: policy.product_code,
          productName: policy.product_name,
        })
      ) {
        skippedBy.notAuto += 1;
        continue;
      }

      // ---- conta certa (nunca a errada) ----
      const account = resolveBackfillAccount(accounts, metadata);

      if (!account) {
        skippedBy.noAccount += 1;
        continue;
      }

      // ---- só o que falta ou está desatualizado ----
      const markers = readZurichEnrichmentMarkers(metadata.enrichment);
      const now = new Date(deps.now());

      const needObjects =
        params.force || !isEnrichmentMarkerFresh(markers.objects, now);
      const needCoverages =
        params.force || !isEnrichmentMarkerFresh(markers.coverages, now);

      if (!needObjects && !needCoverages) {
        skippedBy.fresh += 1;
        continue;
      }

      const policyNumber = String(policy.policy_number ?? "").trim();

      if (policyNumber === "") {
        skippedBy.noData += 1;
        continue;
      }

      // ---- consultas individuais (série, com pausa e retry seletivo) ----
      let objects: readonly ZurichObjectInput[] = [];
      let coverages: readonly ZurichCoverageInput[] = [];
      let objectsFailed = false;
      let coveragesFailed = false;

      if (needObjects) {
        try {
          counters.zurichCalls += 1;
          objects = (
            await withRetry(() =>
              withTimeout(
                deps.lookupObjects(policyNumber, account),
                lookupTimeoutMs,
              ),
            )
          ).filter(hasZurichObjectContent);
        } catch (error) {
          objectsFailed = true;

          if (error instanceof ZurichLookupTimeoutError) {
            counters.timeouts += 1;
          }

          recordError({ policy: masked, stage: "objects", ...summarizeZurichError(error) });
        }

        await deps.sleep(BACKFILL_PAUSE_MS);
      }

      if (needCoverages) {
        try {
          counters.zurichCalls += 1;
          coverages = (
            await withRetry(() =>
              withTimeout(
                deps.lookupCoverages(policyNumber, account),
                lookupTimeoutMs,
              ),
            )
          ).filter(hasZurichCoverageContent);
        } catch (error) {
          coveragesFailed = true;

          if (error instanceof ZurichLookupTimeoutError) {
            counters.timeouts += 1;
          }

          recordError({ policy: masked, stage: "coverages", ...summarizeZurichError(error) });
        }

        await deps.sleep(BACKFILL_PAUSE_MS);
      }

      if (objects.length === 0 && coverages.length === 0) {
        if (objectsFailed || coveragesFailed) {
          counters.failed += 1;
        } else {
          skippedBy.noData += 1;
        }

        continue;
      }

      // ---- fracionamento: só a partir do que a apólice já tem ----
      // A BD só guarda o CÓDIGO (fraccionamentoCod); a descrição não. Sem
      // consultas extra, fica {code, description: null} e só se ainda não
      // houver um paymentFrequencyRaw (que pode ter descrição).
      const existingCode =
        typeof metadata.fraccionamentoCod === "string"
          ? metadata.fraccionamentoCod.trim()
          : "";

      const paymentFrequency =
        !isRecord(metadata.paymentFrequencyRaw) && existingCode !== ""
          ? { code: existingCode, description: null }
          : null;

      // ---- patch (merge que nunca apaga) ----
      const fetchedAt = new Date(deps.now()).toISOString();

      const { metadata: patch, diagnostics } = buildZurichEnrichmentPatch(
        metadata,
        {
          objects:
            objects.length > 0
              ? { source: "POLICY_LOOKUP", fetchedAt, items: objects }
              : null,
          coverages:
            coverages.length > 0
              ? { source: "POLICY_LOOKUP", fetchedAt, items: coverages }
              : null,
          paymentFrequency,
        },
      );

      if (objects.length > 0) {
        counters.objectsLoaded += 1;
      }

      if (coverages.length > 0) {
        counters.coveragesLoaded += 1;
      }

      const selection = diagnostics.vehicleSelection?.status;

      if (selection === "NONE") {
        counters.noVehicle += 1;
      } else if (selection === "AMBIGUOUS") {
        counters.ambiguousVehicle += 1;
      }

      if (objectsFailed || coveragesFailed) {
        counters.partial += 1;
      }

      if (!params.apply) {
        counters.wouldUpdate += 1;
        continue;
      }

      // ---- escrita: só provider_metadata, e só se ninguém mexeu entretanto ----
      let write = supabase
        .from("policies")
        .update({ provider_metadata: { ...metadata, ...patch } })
        .eq("id", policy.id);

      write = policy.last_synced_at
        ? write.eq("last_synced_at", policy.last_synced_at)
        : write.is("last_synced_at", null);

      const { data: written, error: writeError } = await write.select("id");

      if (writeError) {
        counters.failed += 1;
        recordError({ policy: masked, stage: "write", errorKind: "DB_ERROR" });
        continue;
      }

      if (!written || written.length === 0) {
        skippedBy.changedMeanwhile += 1;
        continue;
      }

      counters.updated += 1;
    } catch (error) {
      counters.failed += 1;
      recordError({ policy: masked, stage: "unexpected", ...summarizeZurichError(error) });
    }
  }

  const skipped =
    skippedBy.notAuto +
    skippedBy.noAccount +
    skippedBy.fresh +
    skippedBy.noData +
    skippedBy.changedMeanwhile;

  return {
    success: true,
    applied: params.apply,

    processed: counters.processed,
    updated: counters.updated,
    wouldUpdate: counters.wouldUpdate,
    skipped,
    failed: counters.failed,

    nextCursor: hasMore ? lastProcessedId : null,
    hasMore,
    stoppedByBudget,

    objectsLoaded: counters.objectsLoaded,
    coveragesLoaded: counters.coveragesLoaded,
    noVehicle: counters.noVehicle,
    ambiguousVehicle: counters.ambiguousVehicle,

    skippedBy,

    partial: counters.partial,
    retries: counters.retries,
    timeouts: counters.timeouts,
    zurichCalls: counters.zurichCalls,

    errors,
    elapsedMs: deps.now() - startedAt,
  };
}
