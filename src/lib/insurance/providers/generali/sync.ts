import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { upsertClient } from "@/lib/insurance/sync/upsert-client";
import { upsertPolicy } from "@/lib/insurance/sync/upsert-policy";
import { batchUpsertReceipts } from "@/lib/insurance/sync/batch-upsert-receipts";

import {
  getGeneraliContas,
  obterApolicePorNr,
  obterPaginaCarregamentoInicial,
  obterPaginaRecurso,
  temMaisRegistos,
} from "./client";
import {
  generaliClientExternalId,
  mapGeneraliClient,
  mapGeneraliPolicy,
  text,
} from "./mapper";
import { mapGeneraliReceipt } from "./receipt-mapper";
import type {
  GeneraliApolice,
  GeneraliCliente,
  GeneraliRecibo,
  GeneraliRecurso,
  GeneraliRespostaRecurso,
} from "./types";

/*
 * SYNC GENERALI
 *
 * Como a API funciona (secção "Modo de funcionamento"):
 *   1. Carregamento inicial (/carregamentoinicial): todo o histórico,
 *      página a página (MaisRegistos = SIM -> chamar com o SyncToken).
 *   2. Depois, /apolices, /recibos e /clientes SEM parâmetros dão o
 *      1.º SyncToken (+ alterações dos últimos 7 dias).
 *   3. A partir daí, chama-se sempre com o último SyncToken: vêm só os
 *      registos novos ou alterados desde a chamada anterior.
 *
 * ESTADO (integration_sync_state, uma linha por recurso):
 *   cursor = JSON {"phase":"INITIAL"|"INCREMENTAL","token":"..."|null}
 *   O cursor grava-se DEPOIS DE CADA PÁGINA. Se o Worker for cortado a
 *   meio, a execução seguinte continua dessa página; nada se perde nem
 *   se repete (os upserts são idempotentes de qualquer forma).
 *
 * FALHAS: um registo que falhe conta em records_failed mas NÃO trava o
 * cursor. (Na Zurich, uma única falha impede o estado de avançar e a
 * janela cresce todos os dias; aqui não.) Para corrigir um registo,
 * usar a rota de testes com o nº da apólice.
 *
 * ORDEM: apólices -> recibos -> clientes. Os recibos precisam das
 * apólices; os clientes só atualizam fichas que já existem (nome,
 * nascimento, contactos), não criam clientes sem apólice.
 */

const COMPANY_CODE = "GENERALI";

const RESOURCE_TYPE: Record<GeneraliRecurso, string> = {
  Apolices: "POLICIES",
  Recibos: "RECEIPTS",
  Clientes: "CLIENTS",
};

/** Páginas por recurso e por execução (limites do Worker). */
const DEFAULT_MAX_PAGES = 5;

/** Apólices em falta (recibo sem apólice) pedidas uma a uma por execução. */
const DEFAULT_MISSING_POLICY_LOOKUPS = 10;

type Phase = "INITIAL" | "INCREMENTAL";
type Cursor = { phase: Phase; token: string | null };

type Admin = SupabaseClient;

export type GeneraliSyncOptions = {
  /** Recursos a sincronizar, por esta ordem. Omissão: os três. */
  resources?: GeneraliRecurso[];
  maxPages?: number;
  /** Não escreve nada (nem dados, nem cursor). Lê só a 1.ª página. */
  dryRun?: boolean;
  /**
   * Sem histórico: começa logo no modo incremental (últimos 7 dias).
   * Só tem efeito para recursos que ainda não têm estado gravado.
   */
  skipInitialLoad?: boolean;
  missingPolicyLookups?: number;
};

type Counters = {
  received: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
};

export type GeneraliResourceResult = Counters & {
  resource: GeneraliRecurso;
  status: "SUCCESS" | "PARTIAL" | "ERROR" | "WAITING";
  phaseBefore: Phase;
  phaseAfter: Phase;
  pages: number;
  /** true quando a Generali ainda tem páginas por entregar. */
  moreRemaining: boolean;
  message?: string;
  preview?: unknown[];
};

function emptyCounters(): Counters {
  return { received: 0, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
}

function pushError(counters: Counters, message: string) {
  counters.failed += 1;
  if (counters.errors.length < 20) counters.errors.push(message);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// -----------------------------------------------------
// ESTADO (cursor)
// -----------------------------------------------------

function parseCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as Partial<Cursor>;

    if (value.phase === "INITIAL" || value.phase === "INCREMENTAL") {
      return { phase: value.phase, token: value.token ?? null };
    }
  } catch {
    // Cursor antigo/inválido: recomeça.
  }

  return null;
}

async function loadCursor(
  supabase: Admin,
  companyId: string,
  resource: GeneraliRecurso,
): Promise<Cursor | null> {
  const { data, error } = await supabase
    .from("integration_sync_state")
    .select("cursor")
    .eq("company_id", companyId)
    .eq("resource_type", RESOURCE_TYPE[resource])
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao ler o estado do sync Generali: ${error.message}`);
  }

  return parseCursor(data?.cursor);
}

async function saveState(
  supabase: Admin,
  companyId: string,
  resource: GeneraliRecurso,
  values: {
    cursor?: Cursor;
    status: string;
    success?: boolean;
    errorMessage?: string | null;
  },
) {
  const now = new Date().toISOString();

  const { error } = await supabase.from("integration_sync_state").upsert(
    {
      company_id: companyId,
      resource_type: RESOURCE_TYPE[resource],
      ...(values.cursor ? { cursor: JSON.stringify(values.cursor) } : {}),
      last_attempt_at: now,
      ...(values.success ? { last_successful_sync_at: now } : {}),
      status: values.status,
      error_message: values.errorMessage ?? null,
    },
    { onConflict: "company_id,resource_type" },
  );

  if (error) {
    throw new Error(`Erro ao gravar o estado do sync Generali: ${error.message}`);
  }
}

// -----------------------------------------------------
// APÓLICES
// -----------------------------------------------------

type LineCache = {
  byProduct: Map<string, string | null>;
  byLineCode: Map<string, string | null>;
  /** store_external_refs da GENERALI (external_code -> store_id), lido 1 vez. */
  storeRefs: Map<string, string> | null;
};

// -----------------------------------------------------
// LOJA
// -----------------------------------------------------
//
// Em store_external_refs (company GENERALI) há dois tipos de chave:
//
//   0026504          código de mediação de uma loja (Balazar)
//   USER:T26980      utilizador Generali (quem emitiu a apólice)
//
// Ordem:
//   1. código de mediação, se estiver registado (as variantes "1…"
//      contam como "0…": 1026504 = 0026504);
//   2. utilizador que emitiu a apólice (UtilizadorEmissaoApolice):
//      serve para o 0092674 (master), que não está registado porque é
//      partilhado por Braga e Ribeira do Neiva;
//   3. a loja que o cliente já tem noutras apólices do CRM (as mais
//      frequente), para as renovações automáticas (MIGACOR, PCCSEP…);
//   4. nada: upsertPolicy mantém a loja que a apólice já tinha.
//
// A chave encontrada vai em storeExternalCode e é o upsertPolicy que a
// resolve (resolveProviderStore). O caso 3 devolve a loja diretamente.

export const GENERALI_USER_REF_PREFIX = "USER:";

async function loadStoreRefs(
  supabase: Admin,
  companyId: string,
  cache: LineCache,
): Promise<Map<string, string>> {
  if (cache.storeRefs) return cache.storeRefs;

  const { data, error } = await supabase
    .from("store_external_refs")
    .select("external_code, store_id")
    .eq("company_id", companyId);

  if (error) throw new Error(`Erro store_external_refs: ${error.message}`);

  cache.storeRefs = new Map(
    (data ?? []).map((row) => [String(row.external_code).trim(), row.store_id as string]),
  );

  return cache.storeRefs;
}

function storeRefKey(
  refs: Map<string, string>,
  mediationCode: string | null,
  user: string | null,
): string | null {
  if (mediationCode) {
    if (refs.has(mediationCode)) return mediationCode;

    const asZero = mediationCode.replace(/^1/, "0");
    if (refs.has(asZero)) return asZero;
  }

  if (user && refs.has(GENERALI_USER_REF_PREFIX + user)) {
    return GENERALI_USER_REF_PREFIX + user;
  }

  return null;
}

/** Loja mais frequente nas outras apólices do cliente (qualquer companhia). */
async function clientMainStoreId(
  supabase: Admin,
  clientId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("policies")
    .select("issuing_store_id")
    .eq("client_id", clientId)
    .not("issuing_store_id", "is", null)
    .limit(200);

  if (error) throw new Error(`Erro loja do cliente: ${error.message}`);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const id = row.issuing_store_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  let best: string | null = null;
  for (const [id, n] of counts) {
    if (!best || n > (counts.get(best) ?? 0)) best = id;
  }

  return best;
}

async function resolveInsuranceLineId(
  supabase: Admin,
  companyId: string,
  productCode: string,
  lineCode: string | null,
  cache: LineCache,
): Promise<string | null> {
  if (!cache.byProduct.has(productCode)) {
    const { data, error } = await supabase
      .from("provider_products")
      .select("insurance_line_id")
      .eq("company_id", companyId)
      .eq("provider_code", productCode)
      .maybeSingle();

    if (error) {
      throw new Error(`Erro provider_products ${productCode}: ${error.message}`);
    }

    cache.byProduct.set(productCode, data?.insurance_line_id ?? null);
  }

  const fromProduct = cache.byProduct.get(productCode);
  if (fromProduct) return fromProduct;
  if (!lineCode) return null;

  if (!cache.byLineCode.has(lineCode)) {
    const { data, error } = await supabase
      .from("insurance_lines")
      .select("id")
      .eq("code", lineCode)
      .maybeSingle();

    if (error) {
      throw new Error(`Erro insurance_lines ${lineCode}: ${error.message}`);
    }

    cache.byLineCode.set(lineCode, data?.id ?? null);
  }

  return cache.byLineCode.get(lineCode) ?? null;
}

async function savePolicy(
  supabase: Admin,
  companyId: string,
  apolice: GeneraliApolice,
  lineCache: LineCache,
): Promise<{ created: boolean }> {
  const mapped = mapGeneraliPolicy(apolice, null);
  const refs = await loadStoreRefs(supabase, companyId, lineCache);
  const refKey = storeRefKey(refs, mapped.storeExternalCode, mapped.agentCode);

  // Com chave: o upsertPolicy resolve a loja. Sem chave: nada de
  // storeExternalCode nem agentCode, para o upsertPolicy não tentar o
  // utilizador como código de loja (o código de mediação original fica
  // em providerMetadata.codigoMediacao).
  const policy = {
    ...mapped,
    storeExternalCode: refKey,
    agentCode: refKey ? mapped.agentCode : null,
  };

  const insuranceLineId = await resolveInsuranceLineId(
    supabase,
    companyId,
    policy.productCode,
    policy.insuranceLineCode,
    lineCache,
  );

  const client = await upsertClient({
    supabase,
    companyId,
    externalClientId: generaliClientExternalId(policy.client, apolice),
    policy,
  });

  const result = await upsertPolicy({
    supabase,
    companyId,
    clientId: client.clientId,
    insuranceLineId,
    policy,
  });

  // Sem código nem utilizador conhecido: a loja do cliente noutras
  // apólices, só se esta ainda não tiver loja.
  if (!refKey) {
    await fillStoreFromClient(supabase, companyId, client.clientId, policy.externalId);
  }

  return result;
}

async function fillStoreFromClient(
  supabase: Admin,
  companyId: string,
  clientId: string,
  externalId: string,
) {
  const storeId = await clientMainStoreId(supabase, clientId);
  if (!storeId) return;

  const { error } = await supabase
    .from("policies")
    .update({ issuing_store_id: storeId })
    .eq("company_id", companyId)
    .eq("external_id", externalId)
    .is("issuing_store_id", null);

  if (error) throw new Error(`Erro ao gravar loja do cliente: ${error.message}`);
}

async function processPolicies(
  supabase: Admin,
  companyId: string,
  apolices: GeneraliApolice[],
  counters: Counters,
  lineCache: LineCache,
) {
  for (const apolice of apolices) {
    try {
      const result = await savePolicy(supabase, companyId, apolice, lineCache);
      if (result.created) counters.created += 1;
      else counters.updated += 1;
    } catch (error) {
      pushError(counters, `Apólice ${text(apolice.NrApolice) ?? "?"}: ${errorMessage(error)}`);
    }
  }
}

// -----------------------------------------------------
// RECIBOS
// -----------------------------------------------------

async function loadPolicyIds(
  supabase: Admin,
  companyId: string,
  numbers: string[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (let i = 0; i < numbers.length; i += 150) {
    const { data, error } = await supabase
      .from("policy_external_refs")
      .select("external_id, policy_id")
      .eq("company_id", companyId)
      .in("external_id", numbers.slice(i, i + 150));

    if (error) {
      throw new Error(`Erro ao procurar apólices dos recibos: ${error.message}`);
    }

    for (const row of data ?? []) {
      ids.set(String(row.external_id), String(row.policy_id));
    }
  }

  return ids;
}

async function processReceipts(
  supabase: Admin,
  companyId: string,
  recibos: GeneraliRecibo[],
  counters: Counters,
  lineCache: LineCache,
  missingBudget: { remaining: number },
) {
  const mapped: ReturnType<typeof mapGeneraliReceipt>[] = [];

  for (const recibo of recibos) {
    try {
      mapped.push(mapGeneraliReceipt(recibo));
    } catch (error) {
      pushError(counters, `Recibo ${text(recibo.NrRecibo) ?? "?"}: ${errorMessage(error)}`);
    }
  }

  const numbers = [...new Set(mapped.map((r) => r.policyExternalId))];
  const policyIds = await loadPolicyIds(supabase, companyId, numbers);

  // Recibo de uma apólice que o CRM ainda não tem (ex.: apólice antiga
  // que não veio em nenhuma página): pede-se a apólice e grava-se.
  for (const number of numbers) {
    if (policyIds.has(number) || missingBudget.remaining <= 0) continue;

    missingBudget.remaining -= 1;

    try {
      const apolice = await obterApolicePorNr(number);
      if (!apolice) continue;

      await savePolicy(supabase, companyId, apolice, lineCache);
    } catch (error) {
      console.warn("[Generali] Apólice em falta não importada", {
        error: errorMessage(error),
      });
    }
  }

  const missingNow = numbers.filter((number) => !policyIds.has(number));

  if (missingNow.length > 0) {
    for (const [number, id] of await loadPolicyIds(supabase, companyId, missingNow)) {
      policyIds.set(number, id);
    }
  }

  const items: { policyId: string; receipt: (typeof mapped)[number] }[] = [];

  for (const receipt of mapped) {
    const policyId = policyIds.get(receipt.policyExternalId);

    if (!policyId) {
      pushError(
        counters,
        `Recibo ${receipt.receiptNumber}: apólice ${receipt.policyExternalId} não existe no CRM`,
      );
      continue;
    }

    items.push({ policyId, receipt });
  }

  const result = await batchUpsertReceipts({ supabase, companyId, items });

  counters.created += result.created;
  counters.updated += result.updated;
  counters.skipped += result.unchanged;
}

// -----------------------------------------------------
// CLIENTES (só atualizam os que já existem)
// -----------------------------------------------------

async function processClients(
  supabase: Admin,
  companyId: string,
  clientes: GeneraliCliente[],
  counters: Counters,
) {
  const candidates = clientes.map((cliente) => {
    const client = mapGeneraliClient(cliente, null);
    const ids = [
      client.nif ? `NIF:${client.nif}` : null,
      text(cliente.NrCliente) ? `GENERALI:${text(cliente.NrCliente)}` : null,
    ].filter((id): id is string => id !== null);

    return { cliente, client, ids };
  });

  const allIds = [...new Set(candidates.flatMap((c) => c.ids))];
  const existing = new Set<string>();

  for (let i = 0; i < allIds.length; i += 150) {
    const { data, error } = await supabase
      .from("client_external_refs")
      .select("external_id")
      .eq("company_id", companyId)
      .in("external_id", allIds.slice(i, i + 150));

    if (error) {
      throw new Error(`Erro ao procurar clientes Generali: ${error.message}`);
    }

    for (const row of data ?? []) existing.add(String(row.external_id));
  }

  for (const { cliente, client, ids } of candidates) {
    const externalClientId = ids.find((id) => existing.has(id));

    // Cliente sem apólice no CRM: não se cria (virá com a apólice).
    if (!externalClientId) {
      counters.skipped += 1;
      continue;
    }

    try {
      // upsertClient só lê `policy.client` (ver sync/upsert-client.ts).
      await upsertClient({
        supabase,
        companyId,
        externalClientId,
        policy: { client } as Parameters<typeof upsertClient>[0]["policy"],
      });

      counters.updated += 1;
    } catch (error) {
      pushError(counters, `Cliente ${text(cliente.NrCliente) ?? "?"}: ${errorMessage(error)}`);
    }
  }
}

// -----------------------------------------------------
// UM RECURSO
// -----------------------------------------------------

function itemsOf(page: GeneraliRespostaRecurso, resource: GeneraliRecurso) {
  return (
    resource === "Apolices"
      ? page.Apolices
      : resource === "Recibos"
        ? page.Recibos
        : page.Clientes
  ) ?? [];
}

async function syncResource(
  supabase: Admin,
  companyId: string,
  resource: GeneraliRecurso,
  options: GeneraliSyncOptions,
  policiesPhase: Phase | null,
): Promise<GeneraliResourceResult> {
  const dryRun = options.dryRun === true;
  const maxPages = dryRun ? 1 : Math.max(1, options.maxPages ?? DEFAULT_MAX_PAGES);
  const counters = emptyCounters();
  const lineCache: LineCache = { byProduct: new Map(), byLineCode: new Map(), storeRefs: null };
  const missingBudget = {
    remaining: dryRun ? 0 : options.missingPolicyLookups ?? DEFAULT_MISSING_POLICY_LOOKUPS,
  };

  let cursor: Cursor = (await loadCursor(supabase, companyId, resource)) ?? {
    phase: options.skipInitialLoad ? "INCREMENTAL" : "INITIAL",
    token: null,
  };

  const phaseBefore = cursor.phase;

  // Recibos e clientes do histórico só depois de as apólices do
  // histórico estarem todas no CRM.
  if (resource !== "Apolices" && cursor.phase === "INITIAL" && policiesPhase === "INITIAL") {
    return {
      resource,
      ...counters,
      status: "WAITING",
      phaseBefore,
      phaseAfter: cursor.phase,
      pages: 0,
      moreRemaining: true,
      message: "À espera que o carregamento inicial das apólices termine.",
    };
  }

  let syncRunId: string | null = null;

  if (!dryRun) {
    const { data, error } = await supabase
      .from("integration_sync_runs")
      .insert({
        company_id: companyId,
        resource_type: RESOURCE_TYPE[resource],
        status: "RUNNING",
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(`Erro ao iniciar sync Generali: ${error?.message ?? "sem id"}`);
    }

    syncRunId = data.id;
  }

  let pages = 0;
  let moreRemaining = true;
  const preview: unknown[] = [];

  try {
    while (pages < maxPages) {
      const page =
        cursor.phase === "INITIAL"
          ? await obterPaginaCarregamentoInicial(resource, {
              syncToken: cursor.token,
              contas: getGeneraliContas(),
            })
          : await obterPaginaRecurso(resource, { syncToken: cursor.token });

      pages += 1;

      const items = itemsOf(page, resource);
      const more = temMaisRegistos(page);
      const nextToken = text(page.SyncToken);

      counters.received += items.length;

      if (dryRun) {
        for (const item of items.slice(0, 10)) {
          preview.push(
            resource === "Apolices"
              ? previewPolicy(item as GeneraliApolice)
              : resource === "Recibos"
                ? previewReceipt(item as GeneraliRecibo)
                : { nrCliente: (item as GeneraliCliente).NrCliente },
          );
        }

        moreRemaining = more;
        break;
      }

      if (resource === "Apolices") {
        await processPolicies(supabase, companyId, items as GeneraliApolice[], counters, lineCache);
      } else if (resource === "Recibos") {
        await processReceipts(
          supabase,
          companyId,
          items as GeneraliRecibo[],
          counters,
          lineCache,
          missingBudget,
        );
      } else {
        await processClients(supabase, companyId, items as GeneraliCliente[], counters);
      }

      if (more && !nextToken) {
        throw new Error("A Generali indicou mais registos mas não devolveu SyncToken.");
      }

      // Próximo ponto de partida, gravado já (ver cabeçalho).
      if (more) {
        cursor = { phase: cursor.phase, token: nextToken };
      } else if (cursor.phase === "INITIAL") {
        // Histórico completo: segue para o incremental (1.ª chamada
        // sem SyncToken, como manda a documentação).
        cursor = { phase: "INCREMENTAL", token: null };
      } else {
        cursor = { phase: "INCREMENTAL", token: nextToken ?? cursor.token };
      }

      await saveState(supabase, companyId, resource, {
        cursor,
        status: "RUNNING",
      });

      // Fim do incremental: já está tudo em dia.
      if (!more && phaseBefore === "INCREMENTAL") {
        moreRemaining = false;
        break;
      }

      // Fim do histórico nesta mesma execução: continua no incremental
      // enquanto houver páginas disponíveis.
      if (!more && cursor.phase === "INCREMENTAL" && cursor.token === null) {
        continue;
      }

      if (!more) {
        moreRemaining = false;
        break;
      }
    }

    const status: GeneraliResourceResult["status"] =
      counters.failed === 0
        ? "SUCCESS"
        : counters.created + counters.updated + counters.skipped > 0
          ? "PARTIAL"
          : "ERROR";

    if (!dryRun) {
      await saveState(supabase, companyId, resource, {
        status,
        success: status !== "ERROR",
        errorMessage: counters.errors.slice(0, 5).join("\n") || null,
      });

      await supabase
        .from("integration_sync_runs")
        .update({
          finished_at: new Date().toISOString(),
          status,
          records_received: counters.received,
          records_created: counters.created,
          records_updated: counters.updated,
          records_skipped: counters.skipped,
          records_failed: counters.failed,
          error_message: counters.errors.slice(0, 10).join("\n") || null,
        })
        .eq("id", syncRunId!);
    }

    console.log("[Generali] Sync concluído", {
      resource,
      status,
      dryRun,
      phaseBefore,
      phaseAfter: cursor.phase,
      pages,
      moreRemaining,
      received: counters.received,
      created: counters.created,
      updated: counters.updated,
      skipped: counters.skipped,
      failed: counters.failed,
    });

    return {
      resource,
      ...counters,
      errors: counters.errors.slice(0, 10),
      status,
      phaseBefore,
      phaseAfter: cursor.phase,
      pages,
      moreRemaining,
      ...(dryRun ? { preview } : {}),
    };
  } catch (error) {
    const message = errorMessage(error);

    if (!dryRun) {
      // O cursor da última página boa já está gravado: a próxima
      // execução recomeça daí.
      await saveState(supabase, companyId, resource, {
        status: "ERROR",
        errorMessage: message,
      }).catch(() => undefined);

      await supabase
        .from("integration_sync_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: "ERROR",
          records_received: counters.received,
          records_created: counters.created,
          records_updated: counters.updated,
          records_skipped: counters.skipped,
          records_failed: counters.failed,
          error_message: message,
        })
        .eq("id", syncRunId!);
    }

    throw error;
  }
}

// Resumos para o dryRun: só o necessário para validar o mapeamento,
// com o NIF e o nome de fora.
function previewPolicy(apolice: GeneraliApolice) {
  try {
    const policy = mapGeneraliPolicy(apolice, null);

    return {
      policyNumber: policy.policyNumber,
      product: `${policy.productCode} ${policy.productName ?? ""}`.trim(),
      line: policy.insuranceLineCode,
      status: `${policy.status} (${apolice.EstadoApoliceDesc ?? apolice.EstadoApolice ?? "?"})`,
      frequency: `${policy.paymentFrequency} (${apolice.FracionamentoDesc ?? apolice.Fracionamento ?? "?"})`,
      startDate: policy.startDate,
      renewalDate: policy.renewalDate,
      commercialPremium: policy.commercialPremium,
      totalPremium: policy.totalPremium,
      storeCode: policy.storeExternalCode,
      hasNif: policy.client.nif !== null,
      objects: apolice.ObjetosSeguros?.length ?? 0,
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

function previewReceipt(recibo: GeneraliRecibo) {
  try {
    const receipt = mapGeneraliReceipt(recibo);

    return {
      receiptNumber: receipt.receiptNumber,
      policyNumber: receipt.policyExternalId,
      type: receipt.receiptType,
      status: `${receipt.status} (${recibo.EstadoReciboDesc ?? recibo.EstadoRecibo ?? "?"})`,
      period: `${receipt.periodStart} → ${receipt.periodEnd}`,
      commercialPremium: receipt.commercialPremium,
      totalPremium: receipt.totalPremium,
      commissions: receipt.commissions,
      paymentMethod: receipt.paymentMethod,
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

// -----------------------------------------------------
// ENTRADA
// -----------------------------------------------------

export async function syncGenerali(options: GeneraliSyncOptions = {}) {
  const supabase = createAdminClient();

  const { data: company, error } = await supabase
    .from("companies")
    .select("id")
    .eq("code", COMPANY_CODE)
    .maybeSingle();

  if (error || !company) {
    throw new Error(
      `Companhia ${COMPANY_CODE} não encontrada${error ? `: ${error.message}` : ""}. Aplicar a migração supabase/migrations/*_generali_company.sql.`,
    );
  }

  const resources = options.resources ?? ["Apolices", "Recibos", "Clientes"];
  const results: GeneraliResourceResult[] = [];

  let policiesPhase: Phase | null =
    (await loadCursor(supabase, company.id, "Apolices"))?.phase ??
    (options.skipInitialLoad ? "INCREMENTAL" : "INITIAL");

  for (const resource of resources) {
    try {
      const result = await syncResource(supabase, company.id, resource, options, policiesPhase);

      if (resource === "Apolices" && !options.dryRun) policiesPhase = result.phaseAfter;

      results.push(result);
    } catch (resourceError) {
      // Um recurso que falhe não impede os outros.
      results.push({
        resource,
        ...emptyCounters(),
        status: "ERROR",
        phaseBefore: "INCREMENTAL",
        phaseAfter: "INCREMENTAL",
        pages: 0,
        moreRemaining: true,
        message: errorMessage(resourceError),
      });
    }
  }

  return {
    ok: results.every((result) => result.status !== "ERROR"),
    dryRun: options.dryRun === true,
    results,
  };
}
