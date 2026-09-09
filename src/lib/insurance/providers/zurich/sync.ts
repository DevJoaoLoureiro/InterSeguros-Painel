import { createAdminClient } from "@/lib/supabase/admin";

import {
  getApolicesDoDia,
  getClientesDoDia,
  getRecibosDoDia,
  obterClientePorIdNif,
  getZurichAccounts,
  ZurichAccount,
} from "./client";

import { mapZurichPolicy } from "./mapper";
import { mapZurichReceipt } from "./receipt-mapper";

import { upsertClient } from "@/lib/insurance/sync/upsert-client";
import { upsertPolicy } from "@/lib/insurance/sync/upsert-policy";
import { batchUpsertReceipts } from "@/lib/insurance/sync/batch-upsert-receipts";

import type { ZurichClienteFicheiro } from "./file-parser";

const COMPANY_CODE = "ZURICH";

// Zurich não tem "buscar tudo" via API (só ficheiros diários) —
// numa primeira sincronização (sem last_successful_sync_at ainda
// registado) fazemos backfill destes últimos N dias. Para histórico
// mais antigo, a Carteira Total tem de ser importada manualmente a
// partir do MyZurich (ver doc "Da Subscrição ao Uso").
const FIRST_SYNC_BACKFILL_DAYS = 30;

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function* dateRange(from: Date, to: Date): Generator<string> {
  let current = new Date(from);

  while (current <= to) {
    yield formatDate(current);
    current = addDays(current, 1);
  }
}

/**
 * A Zurich devolve "Ficheiro não existente" (Código 6) ou "Não
 * existem dados para criar ficheiro para o dia indicado" (Código
 * 7) em dias sem alterações — tratamos isso como lista vazia,
 * não como erro.
 */
function isDiaSemDadosError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("Código 6") || error.message.includes("Código 7"))
  );
}

async function safeGetApolicesDoDia(data: string, account: ZurichAccount) {
  try {
    return await getApolicesDoDia(data, account);
  } catch (error) {
    if (isDiaSemDadosError(error)) {
      return [];
    }
    throw error;
  }
}

async function safeGetClientesDoDia(data: string, account: ZurichAccount) {
  try {
    return await getClientesDoDia(data, account);
  } catch (error) {
    if (isDiaSemDadosError(error)) {
      return [];
    }
    throw error;
  }
}

async function safeGetRecibosDoDia(data: string, account: ZurichAccount) {
  try {
    return await getRecibosDoDia(data, account);
  } catch (error) {
    if (isDiaSemDadosError(error)) {
      return [];
    }
    throw error;
  }
}

type SyncOptions = {
  limit?: number;
};

// =====================================================
// SYNC DE APÓLICES
// =====================================================
//
// Percorre TODAS as contas configuradas (uma por loja — ver
// getZurichAccounts() em client.ts). A loja de cada apólice é
// determinada por QUAL CONTA a trouxe, não por nenhum campo
// dentro dos dados da própria apólice (a Zurich não expõe essa
// distinção nos dados).

export async function syncZurichPolicies(options: SyncOptions = {}) {
  const supabase = createAdminClient();
  const accounts = getZurichAccounts();

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, code, name")
    .eq("code", COMPANY_CODE)
    .single();

  if (companyError || !company) {
    throw new Error(
      `Companhia ${COMPANY_CODE} não encontrada: ${
        companyError?.message ?? "sem resultado"
      }. Confirma que existe uma linha em 'companies' com code='${COMPANY_CODE}'.`,
    );
  }

  const { data: syncRun, error: runError } = await supabase
    .from("integration_sync_runs")
    .insert({
      company_id: company.id,
      resource_type: "POLICIES",
      status: "RUNNING",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (runError || !syncRun) {
    throw new Error(
      `Erro ao iniciar sync: ${runError?.message ?? "sem sync run"}`,
    );
  }

  let received = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  const errors: string[] = [];

  try {
    const { data: syncState } = await supabase
      .from("integration_sync_state")
      .select("last_successful_sync_at")
      .eq("company_id", company.id)
      .eq("resource_type", "POLICIES")
      .maybeSingle();

    const today = new Date();

    const fromDate = syncState?.last_successful_sync_at
      ? addDays(new Date(syncState.last_successful_sync_at), 1)
      : addDays(today, -FIRST_SYNC_BACKFILL_DAYS);

    const syncMode: "FULL" | "INCREMENTAL" = syncState?.last_successful_sync_at
      ? "INCREMENTAL"
      : "FULL";

    // ======================================
    // RECOLHER APÓLICES + CLIENTES DO PERÍODO, POR CONTA/LOJA
    // ======================================

    type PolicyWithAccount = {
      source: Awaited<ReturnType<typeof getApolicesDoDia>>[number];
      account: ZurichAccount;
    };

    const sourcePolicies: PolicyWithAccount[] = [];

    // Chave composta "<conta>:<idCliente>" — evita colisões se
    // duas contas/lojas tiverem, por acaso, o mesmo IDCliente
    // numérico para clientes diferentes.
    const clientesPorId = new Map<string, ZurichClienteFicheiro>();

    for (const account of accounts) {
      for (const dia of dateRange(fromDate, today)) {
        const [apolicesDoDia, clientesDoDia] = await Promise.all([
          safeGetApolicesDoDia(dia, account),
          safeGetClientesDoDia(dia, account),
        ]);

        for (const source of apolicesDoDia) {
          sourcePolicies.push({ source, account });
        }

        for (const cliente of clientesDoDia) {
          clientesPorId.set(
            `${account.key}:${cliente.IDCliente.trim()}`,
            cliente,
          );
        }
      }
    }

    const selectedPolicies = options.limit
      ? sourcePolicies.slice(0, options.limit)
      : sourcePolicies;

    received = selectedPolicies.length;

    // ======================================
    // PROCESSAR
    // ======================================

    for (const { source, account } of selectedPolicies) {
      try {
        const idCliente = source.IDCliente.trim();

        // Tenta primeiro no que já veio nos ficheiros diários
        // deste período (para esta conta/loja); se o cliente não
        // mudou recentemente, não vai aparecer aí — nesse caso,
        // pede-o individualmente, usando a MESMA conta (para
        // teres a certeza de que consultas a loja certa).
        let cliente =
          clientesPorId.get(`${account.key}:${idCliente}`) ?? null;

        if (!cliente && (idCliente || source.NIF.trim())) {
          try {
            const result = await obterClientePorIdNif(
              {
                clienteId: idCliente || undefined,
                clienteNif: source.NIF.trim() || undefined,
              },
              account,
            );

            const dadosCliente = result.DadosCliente?.[0];

            if (!dadosCliente) {
              console.warn(
                `[Zurich:${account.key}] ObterClientePorIDNIF sem exceção mas sem dados utilizáveis (IDCliente=${idCliente}, NIF=${source.NIF}). Resposta bruta:`,
                JSON.stringify(result),
              );
            }

            if (dadosCliente) {
              cliente = {
                IDCliente: dadosCliente.IDCliente ?? "",
                NomeCliente: dadosCliente.NomeCliente ?? "",
                Morada: dadosCliente.Morada ?? "",
                Localidade: dadosCliente.Localidade ?? "",
                CodigoPostal: dadosCliente.CodigoPostal ?? "",
                OrdemPostal: String(dadosCliente.OrdemPostal ?? ""),
                LocalidadePostal: String(
                  dadosCliente.LocalidadePostal ??
                    dadosCliente.Localidade ??
                    "",
                ),
                Pais: dadosCliente.Pais ?? "",
                NIF: dadosCliente.NIF ?? "",
                Telefone: dadosCliente.Telefone ?? "",
                Telemovel: dadosCliente.Telemovel ?? "",
                Fax: dadosCliente.Fax ?? "",
                Email: dadosCliente.Email ?? "",
                NCartaoIdentificacao:
                  dadosCliente.NCartaoIdentificacao ?? "",
                DataNascimento: dadosCliente.DataNascimento ?? "",
                Tipo: dadosCliente.Tipo ?? "",
                Sexo: dadosCliente.Sexo ?? "",
                CodigoAtividade: dadosCliente.CodigoAtividade ?? "",
                NomeAtividade: dadosCliente.NomeAtividade ?? "",
                EstadoCivil: dadosCliente.EstadoCivil ?? "",
                Filhos: dadosCliente.Filhos ?? "",
                NIB: dadosCliente.NIB ?? "",
                CodSituacao: dadosCliente.CodSituacao ?? "",
                Situacao: dadosCliente.Situacao ?? "",
                DataUltimaAlteracao: dadosCliente.DataUltimaAlteracao ?? "",
                Zurich4You: "",
                RecDocPorEmail: "",
                DataAtualizacaoTipoCliente: "",
              };
            }
          } catch (clienteError) {
            // Seguimos com cliente=null; o mapper já trata isso
            // com um nome de fallback baseado no NIF. Mas
            // registamos o motivo para conseguirmos perceber
            // porque é que a consulta individual falhou.
            console.warn(
              `[Zurich:${account.key}] Falha ao obter cliente individualmente (IDCliente=${idCliente}, NIF=${source.NIF}):`,
              clienteError instanceof Error
                ? clienteError.message
                : clienteError,
            );
          }
        }

        const normalized = mapZurichPolicy(source, cliente);

        // A loja é conhecida pela CONTA que trouxe esta apólice,
        // não pelos dados da própria apólice — sobrepomos aqui,
        // já que é a fonte de verdade real.
        normalized.storeExternalCode =
          account.storeExternalCode ?? normalized.storeExternalCode;

        // ----------------------------------
        // RAMO (provider_products -> insurance_lines)
        // ----------------------------------

        let insuranceLineId: string | null = null;

        const { data: providerProduct, error: providerProductError } =
          await supabase
            .from("provider_products")
            .select(`id, insurance_line_id`)
            .eq("company_id", company.id)
            .eq("provider_code", normalized.productCode)
            .maybeSingle();

        if (providerProductError) {
          throw new Error(
            `Erro provider product ${normalized.productCode}: ${providerProductError.message}`,
          );
        }

        if (providerProduct?.insurance_line_id) {
          insuranceLineId = providerProduct.insurance_line_id;
        } else if (normalized.insuranceLineCode) {
          const { data: line, error: lineError } = await supabase
            .from("insurance_lines")
            .select("id")
            .eq("code", normalized.insuranceLineCode)
            .maybeSingle();

          if (lineError) {
            throw new Error(
              `Erro ramo ${normalized.insuranceLineCode}: ${lineError.message}`,
            );
          }

          insuranceLineId = line?.id ?? null;
        }

        // ----------------------------------
        // CLIENTE
        // ----------------------------------

        const nif = normalized.client.nif?.replace(/\D/g, "") || null;

        const externalClientId = nif
          ? `NIF:${nif}`
          : `POLICY:${normalized.externalId}`;

        const clientResult = await upsertClient({
          supabase,
          companyId: company.id,
          externalClientId,
          policy: normalized as any,
        });

        // ----------------------------------
        // APÓLICE
        // ----------------------------------

        const policyResult = await upsertPolicy({
          supabase,
          companyId: company.id,
          clientId: clientResult.clientId,
          insuranceLineId,
          policy: normalized as any,
        });

        if (policyResult.created) {
          created += 1;
        } else {
          updated += 1;
        }
      } catch (error) {
        failed += 1;

        const message =
          error instanceof Error ? error.message : "Erro desconhecido";

        errors.push(`[conta ${account.key}] ${message}`);

        console.error(
          `Erro ao sincronizar apólice Zurich (conta ${account.key}):`,
          error,
        );
      }
    }

    // ======================================
    // FINALIZAR
    // ======================================

    const finalStatus =
      failed === 0 ? "SUCCESS" : created + updated > 0 ? "PARTIAL" : "ERROR";

    if (failed === 0 && !options.limit) {
      await supabase.from("integration_sync_state").upsert(
        {
          company_id: company.id,
          resource_type: "POLICIES",
          last_successful_sync_at: new Date().toISOString(),
          last_attempt_at: new Date().toISOString(),
          status: "SUCCESS",
        },
        { onConflict: "company_id,resource_type" },
      );
    }

    const { error: finishError } = await supabase
      .from("integration_sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: finalStatus,
        records_received: received,
        records_created: created,
        records_updated: updated,
        records_skipped: skipped,
        records_failed: failed,
        error_message:
          errors.length > 0 ? errors.slice(0, 10).join("\n") : null,
      })
      .eq("id", syncRun.id);

    if (finishError) {
      throw new Error(`Erro ao finalizar sync run: ${finishError.message}`);
    }

    return {
      ok: finalStatus !== "ERROR",
      syncRunId: syncRun.id,
      status: finalStatus,
      syncMode,
      accounts: accounts.map((a) => a.key),
      received,
      created,
      updated,
      skipped,
      failed,
      errors: errors.slice(0, 10),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro desconhecido";

    await supabase
      .from("integration_sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: "ERROR",
        records_received: received,
        records_created: created,
        records_updated: updated,
        records_skipped: skipped,
        records_failed: failed,
        error_message: message,
      })
      .eq("id", syncRun.id);

    throw error;
  }
}

// =====================================================
// SYNC DE RECIBOS
// =====================================================
//
// Também percorre todas as contas. Os recibos não precisam de
// ser "etiquetados" por loja aqui — já ficam associados à loja
// certa indiretamente, através da apólice a que pertencem
// (policy_id), que já foi corretamente atribuída no sync de
// apólices.

export async function syncZurichReceipts(options: SyncOptions = {}) {
  const supabase = createAdminClient();
  const accounts = getZurichAccounts();

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, code, name")
    .eq("code", COMPANY_CODE)
    .single();

  if (companyError || !company) {
    throw new Error(
      `Companhia ${COMPANY_CODE} não encontrada: ${
        companyError?.message ?? "sem resultado"
      }`,
    );
  }

  const { data: syncRun, error: runError } = await supabase
    .from("integration_sync_runs")
    .insert({
      company_id: company.id,
      resource_type: "RECEIPTS",
      status: "RUNNING",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (runError || !syncRun) {
    throw new Error(
      `Erro ao iniciar sync: ${runError?.message ?? "sem sync run"}`,
    );
  }

  let received = 0;
  let created = 0;
  let updated = 0;
  const skipped = 0;
  let failed = 0;

  const errors: string[] = [];

  try {
    const { data: syncState } = await supabase
      .from("integration_sync_state")
      .select("last_successful_sync_at")
      .eq("company_id", company.id)
      .eq("resource_type", "RECEIPTS")
      .maybeSingle();

    const today = new Date();

    const fromDate = syncState?.last_successful_sync_at
      ? addDays(new Date(syncState.last_successful_sync_at), 1)
      : addDays(today, -FIRST_SYNC_BACKFILL_DAYS);

    const syncMode: "FULL" | "INCREMENTAL" = syncState?.last_successful_sync_at
      ? "INCREMENTAL"
      : "FULL";

    // O mesmo recibo pode aparecer em mais do que um ficheiro
    // diário dentro da janela (ex: criado num dia, atualizado
    // noutro), e teoricamente em mais do que uma conta —
    // deduplicamos por NumRecibo, mantendo a última versão vista.
    const receiptsByNumero = new Map<
      string,
      Awaited<ReturnType<typeof getRecibosDoDia>>[number]
    >();

    for (const account of accounts) {
      for (const dia of dateRange(fromDate, today)) {
        const recibosDoDia = await safeGetRecibosDoDia(dia, account);

        for (const recibo of recibosDoDia) {
          receiptsByNumero.set(recibo.NumRecibo.trim(), recibo);
        }
      }
    }

    const sourceReceipts = Array.from(receiptsByNumero.values());

    const selectedReceipts = options.limit
      ? sourceReceipts.slice(0, options.limit)
      : sourceReceipts;

    received = selectedReceipts.length;

    // ======================================
    // RESOLVER policy_id PARA CADA RECIBO
    // ======================================

    const items: { policyId: string; receipt: ReturnType<typeof mapZurichReceipt> }[] =
      [];

    for (const source of selectedReceipts) {
      try {
        const normalized = mapZurichReceipt(source);

        const { data: policy, error: policyError } = await supabase
          .from("policy_external_refs")
          .select("policy_id")
          .eq("company_id", company.id)
          .eq("external_id", normalized.policyExternalId)
          .maybeSingle();

        if (policyError) {
          throw new Error(
            `Erro ao procurar apólice ${normalized.policyExternalId}: ${policyError.message}`,
          );
        }

        if (!policy?.policy_id) {
          // Apólice ainda não sincronizada — normal se o sync de
          // apólices ainda não correu para este período. Ignora
          // por agora; o próximo sync de recibos apanha-o depois
          // de a apólice existir.
          failed += 1;
          errors.push(
            `Apólice ${normalized.policyExternalId} não encontrada para o recibo ${normalized.receiptNumber}`,
          );
          continue;
        }

        items.push({ policyId: policy.policy_id, receipt: normalized as any });
      } catch (error) {
        failed += 1;

        const message =
          error instanceof Error ? error.message : "Erro desconhecido";

        errors.push(message);
      }
    }

    const batchResult = await batchUpsertReceipts({
      supabase,
      companyId: company.id,
      items: items as any,
    });

    created = batchResult.created;
    updated = batchResult.updated;

    // ======================================
    // FINALIZAR
    // ======================================

    const finalStatus =
      failed === 0 ? "SUCCESS" : created + updated > 0 ? "PARTIAL" : "ERROR";

    if (failed === 0 && !options.limit) {
      await supabase.from("integration_sync_state").upsert(
        {
          company_id: company.id,
          resource_type: "RECEIPTS",
          last_successful_sync_at: new Date().toISOString(),
          last_attempt_at: new Date().toISOString(),
          status: "SUCCESS",
        },
        { onConflict: "company_id,resource_type" },
      );
    }

    const { error: finishError } = await supabase
      .from("integration_sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: finalStatus,
        records_received: received,
        records_created: created,
        records_updated: updated,
        records_skipped: skipped,
        records_failed: failed,
        error_message:
          errors.length > 0 ? errors.slice(0, 10).join("\n") : null,
      })
      .eq("id", syncRun.id);

    if (finishError) {
      throw new Error(`Erro ao finalizar sync run: ${finishError.message}`);
    }

    return {
      ok: finalStatus !== "ERROR",
      syncRunId: syncRun.id,
      status: finalStatus,
      syncMode,
      accounts: accounts.map((a) => a.key),
      received,
      created,
      updated,
      skipped,
      failed,
      errors: errors.slice(0, 10),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro desconhecido";

    await supabase
      .from("integration_sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: "ERROR",
        records_received: received,
        records_created: created,
        records_updated: updated,
        records_skipped: skipped,
        records_failed: failed,
        error_message: message,
      })
      .eq("id", syncRun.id);

    throw error;
  }
}