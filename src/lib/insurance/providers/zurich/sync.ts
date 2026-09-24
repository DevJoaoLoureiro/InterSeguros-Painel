import { createAdminClient } from "@/lib/supabase/admin";

import {
  getApolicesDoDia,
  getClientesDoDia,
  getRecibosDoDia,
  getObjetosDoDia,
  getCoberturasDoDia,
  obterClientePorIdNif,
  obterObjetosPorNrApolice,
  obterCoberturasPorApolice,
  getZurichAccounts,
  ZurichAccount,
} from "./client";

import { mapZurichPolicy } from "./mapper";
import { mapZurichReceipt } from "./receipt-mapper";
import {
  maskIdentifier,
  sanitizeZurichText,
  summarizeZurichError,
} from "./log-safety";
import {
  buildZurichEnrichmentPatch,
  isZurichAutoPolicy,
  type ZurichEnrichmentInput,
} from "./risk-enrichment";
import {
  createFallbackBudget,
  DEFAULT_FALLBACK_DELAY_MS,
  prepareZurichPolicyEnrichment,
} from "./policy-enrichment";

import { upsertClient } from "@/lib/insurance/sync/upsert-client";
import { upsertPolicy } from "@/lib/insurance/sync/upsert-policy";
import { batchUpsertReceipts } from "@/lib/insurance/sync/batch-upsert-receipts";

import type {
  ZurichClienteFicheiro,
  ZurichCoberturaFicheiro,
  ZurichObjetoFicheiro,
} from "./file-parser";

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

async function safeGetObjetosDoDia(data: string, account: ZurichAccount) {
  try {
    return await getObjetosDoDia(data, account);
  } catch (error) {
    if (isDiaSemDadosError(error)) {
      return [];
    }
    throw error;
  }
}

/**
 * As coberturas são um EXTRA: qualquer falha (não só "dia sem
 * dados") é registada e tratada como "sem coberturas neste dia",
 * para nunca impedir o sync das apólices.
 */
async function safeGetCoberturasDoDia(
  data: string,
  account: ZurichAccount,
): Promise<ZurichCoberturaFicheiro[]> {
  try {
    return await getCoberturasDoDia(data, account);
  } catch (error) {
    if (isDiaSemDadosError(error)) {
      return [];
    }

    console.warn("[Zurich] Falha ao obter coberturas do dia (segue sem elas)", {
      account: account.key,
      dia: data,
      ...summarizeZurichError(error),
    });

    return [];
  }
}

/**
 * Extrai uma matrícula portuguesa no formato XX-XX-XX do texto
 * de DescricaoObjeto devolvido pela Zurich.
 *
 * Exemplos reais:
 *   "AC-87-GG Renault -" -> "AC-87-GG"
 *   "21-AH-98 Renault Megane 1.5" -> "21-AH-98"
 */
function extractVehicleRegistration(description: string): string | null {
  const match = description
    .trim()
    .toUpperCase()
    .match(/\b[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]{2}\b/);

  return match?.[0] ?? null;
}

function findVehicleObject<T extends {
  TipoObjeto: string;
  DescricaoObjeto: string;
}>(objects: T[]): T | null {
  return (
    objects.find((object) =>
      object.TipoObjeto.trim().toLowerCase().includes("viatura"),
    ) ?? null
  );
}

type SyncOptions = {
  limit?: number;

  /**
   * Liga o enriquecimento de risco: pede o ficheiro de coberturas
   * (TipoFicheiro 5) e grava objetos/coberturas/fracionamento cru em
   * provider_metadata. Omissão: variável de ambiente ZURICH_ENRICHMENT
   * ("1", "true" ou "on"). Desligado, o sync não pede coberturas e
   * grava os mesmos metadados de antes.
   */
  enrichment?: boolean;

  /**
   * Não escreve NADA na BD (nem registo de execução, nem estado
   * incremental, nem clientes, nem apólices). Lê da Zurich e da BD e
   * devolve, em `preview`, um resumo mascarado do que faria.
   */
  dryRun?: boolean;

  /** Teto de apólices Auto com consulta individual (fallback) nesta corrida. */
  fallbackLimit?: number;

  /** Pausa (ms) após cada consulta individual do fallback. */
  fallbackDelayMs?: number;
};

function isEnrichmentEnabled(options: SyncOptions): boolean {
  if (options.enrichment !== undefined) {
    return options.enrichment;
  }

  return ["1", "true", "on"].includes(
    (process.env.ZURICH_ENRICHMENT ?? "").trim().toLowerCase(),
  );
}

type DayBucket<T> = { day: string; items: T[] };

/**
 * Guarda, por conta + apólice, só as linhas do dia MAIS RECENTE em
 * que a apólice apareceu. Os dias chegam por ordem crescente, por
 * isso o seguinte substitui o anterior. Evita objetos/coberturas
 * duplicados quando a mesma apólice aparece em vários ficheiros
 * diários (o que faria uma só viatura parecer várias).
 */
function keepLatestDay<T extends { NumeroApolice: string }>(
  store: Map<string, DayBucket<T>>,
  accountKey: string,
  day: string,
  rows: readonly T[],
): void {
  const perPolicy = new Map<string, T[]>();

  for (const row of rows) {
    const key = `${accountKey}:${row.NumeroApolice.trim()}`;
    const list = perPolicy.get(key) ?? [];
    list.push(row);
    perPolicy.set(key, list);
  }

  for (const [key, items] of perPolicy) {
    store.set(key, { day, items });
  }
}

type LineInfo = { code: string | null; name: string | null };

/** Código/nome do ramo, em cache por corrida (poucas linhas distintas). */
async function loadInsuranceLineInfo(
  supabase: ReturnType<typeof createAdminClient>,
  lineId: string | null,
  cache: Map<string, LineInfo | null>,
): Promise<LineInfo | null> {
  if (!lineId) {
    return null;
  }

  if (cache.has(lineId)) {
    return cache.get(lineId) ?? null;
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

  cache.set(lineId, info);

  return info;
}

// =====================================================
// SYNC DE APÓLICES
// =====================================================
//
// Percorre TODAS as contas configuradas (uma por loja — ver
// getZurichAccounts() em client.ts). A loja de cada apólice é
// determinada por QUAL CONTA a trouxe, não por nenhum campo
// dentro dos dados da própria apólice (a Zurich não expõe essa
// distinção nos dados).
//
// ENRIQUECIMENTO (opcional, ver SyncOptions.enrichment):
// - pede também o ficheiro de coberturas (TipoFicheiro 5);
// - objetos/coberturas por conta + apólice, só do dia mais recente;
// - fallback individual só para Auto e só se faltarem dados
//   (ver policy-enrichment.ts);
// - o patch é reconciliado com o provider_metadata já gravado
//   (união por chave; nunca se apaga o que uma corrida não trouxe).

export async function syncZurichPolicies(options: SyncOptions = {}) {
  const supabase = createAdminClient();
  const accounts = getZurichAccounts();

  const enrichmentEnabled = isEnrichmentEnabled(options);
  const dryRun = options.dryRun === true;
  const fallbackDelayMs = options.fallbackDelayMs ?? DEFAULT_FALLBACK_DELAY_MS;

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

  // Em dryRun não se cria registo de execução (seria uma escrita).
  let syncRun: { id: string } | null = null;

  if (!dryRun) {
    const { data: createdRun, error: runError } = await supabase
      .from("integration_sync_runs")
      .insert({
        company_id: company.id,
        resource_type: "POLICIES",
        status: "RUNNING",
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (runError || !createdRun) {
      throw new Error(
        `Erro ao iniciar sync: ${runError?.message ?? "sem sync run"}`,
      );
    }

    syncRun = createdRun;
  }

  let received = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  const errors: string[] = [];

  const fetchedAt = new Date().toISOString();
  const budget = createFallbackBudget(options.fallbackLimit);
  const lineInfoCache = new Map<string, LineInfo | null>();
  const preview: Record<string, unknown>[] = [];

  const enrichmentStats = {
    coverageFileRequests: 0,
    autoPolicies: 0,
    riskEnrichedPolicies: 0,
    objectsFromFile: 0,
    objectsFromLookup: 0,
    coveragesFromFile: 0,
    coveragesFromLookup: 0,
    vehicleAmbiguous: 0,
  };

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

    // Objetos de risco e coberturas por conta + número de apólice
    // (só o dia mais recente em que a apólice apareceu).
    // Para Auto, DescricaoObjeto contém a matrícula.
    const objetosPorApolice = new Map<string, DayBucket<ZurichObjetoFicheiro>>();
    const coberturasPorApolice = new Map<
      string,
      DayBucket<ZurichCoberturaFicheiro>
    >();

    for (const account of accounts) {
      for (const dia of dateRange(fromDate, today)) {
        const [apolicesDoDia, clientesDoDia, objetosDoDia, coberturasDoDia] =
          await Promise.all([
            safeGetApolicesDoDia(dia, account),
            safeGetClientesDoDia(dia, account),
            safeGetObjetosDoDia(dia, account),
            enrichmentEnabled
              ? safeGetCoberturasDoDia(dia, account)
              : Promise.resolve<ZurichCoberturaFicheiro[]>([]),
          ]);

        if (enrichmentEnabled) {
          enrichmentStats.coverageFileRequests += 1;
        }

        for (const source of apolicesDoDia) {
          sourcePolicies.push({ source, account });
        }

        for (const cliente of clientesDoDia) {
          clientesPorId.set(
            `${account.key}:${cliente.IDCliente.trim()}`,
            cliente,
          );
        }

        keepLatestDay(objetosPorApolice, account.key, dia, objetosDoDia);
        keepLatestDay(coberturasPorApolice, account.key, dia, coberturasDoDia);
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
        // Em dryRun não se faz esta consulta: não é preciso para o
        // resumo e evita pedidos à Zurich.
        let cliente =
          clientesPorId.get(`${account.key}:${idCliente}`) ?? null;

        if (!cliente && !dryRun && (idCliente || source.NIF.trim())) {
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
              // Sem NIF, IDCliente nem resposta bruta (PII): só o
              // suficiente para perceber o que falhou.
              console.warn(
                "[Zurich] ObterClientePorIDNIF sem dados utilizáveis",
                {
                  account: account.key,
                  hasClientId: idCliente !== "",
                  hasNif: source.NIF.trim() !== "",
                  responseKeys: Object.keys(result ?? {}),
                },
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
            console.warn("[Zurich] Falha ao obter cliente individualmente", {
              account: account.key,
              hasClientId: idCliente !== "",
              hasNif: source.NIF.trim() !== "",
              ...summarizeZurichError(clienteError),
            });
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
        // OBJETO DE RISCO / MATRÍCULA / COBERTURAS
        // ----------------------------------
        //
        // A matrícula não vem no ficheiro de apólices.
        // Para Auto, a Zurich envia-a em Objetos de Risco,
        // dentro de DescricaoObjeto quando TipoObjeto = Viatura.

        const policyNumber = source.NumeroApolice.trim();
        const policyKey = `${account.key}:${policyNumber}`;

        const fileObjects = objetosPorApolice.get(policyKey)?.items ?? [];
        const fileCoverages = coberturasPorApolice.get(policyKey)?.items ?? [];

        let enrichmentInput: ZurichEnrichmentInput | null = null;

        if (enrichmentEnabled) {
          const lineInfo = await loadInsuranceLineInfo(
            supabase,
            insuranceLineId,
            lineInfoCache,
          );

          const isAuto = isZurichAutoPolicy({
            insuranceLineCode: normalized.insuranceLineCode,
            lineCode: lineInfo?.code,
            lineName: lineInfo?.name,
            productCode: normalized.productCode,
            productName: normalized.productName,
          });

          const prepared = await prepareZurichPolicyEnrichment({
            isAuto,
            fileObjects,
            fileCoverages,
            paymentFrequency: {
              code: source.FraccionamentoCod,
              description: source.Fraccionamento,
            },
            fetchedAt,
            budget,
            fallbackDelayMs,
            deps: {
              lookupObjects: async () =>
                (await obterObjetosPorNrApolice(policyNumber, account))
                  .ListaObjetos ?? [],
              lookupCoverages: async () =>
                (await obterCoberturasPorApolice(policyNumber, account))
                  .ListaCoberturas ?? [],
              loadExistingMetadata: async () => {
                const { data, error } = await supabase
                  .from("policies")
                  .select("provider_metadata")
                  .eq("company_id", company.id)
                  .eq("external_id", normalized.externalId)
                  .maybeSingle();

                if (error) {
                  throw new Error(error.message);
                }

                const metadata = data?.provider_metadata;

                return metadata &&
                  typeof metadata === "object" &&
                  !Array.isArray(metadata)
                  ? (metadata as Record<string, unknown>)
                  : null;
              },
              sleep: (ms) =>
                ms > 0
                  ? new Promise<void>((resolve) => setTimeout(resolve, ms))
                  : Promise.resolve(),
              now: () => new Date(),
              warn: (message, details) =>
                console.warn(`[Zurich] ${message}`, {
                  account: account.key,
                  policy: maskIdentifier(policyNumber),
                  ...summarizeZurichError(details.error),
                }),
            },
          });

          enrichmentInput = prepared.input;

          if (isAuto) {
            enrichmentStats.autoPolicies += 1;
          }

          if (prepared.objectsSource === "DAILY_FILE") {
            enrichmentStats.objectsFromFile += 1;
          } else if (prepared.objectsSource === "POLICY_LOOKUP") {
            enrichmentStats.objectsFromLookup += 1;
          }

          if (prepared.coveragesSource === "DAILY_FILE") {
            enrichmentStats.coveragesFromFile += 1;
          } else if (prepared.coveragesSource === "POLICY_LOOKUP") {
            enrichmentStats.coveragesFromLookup += 1;
          }

          if (enrichmentInput?.objects || enrichmentInput?.coverages) {
            enrichmentStats.riskEnrichedPolicies += 1;
          }
        } else {
          // Enriquecimento desligado: comportamento anterior. Objetos
          // do ficheiro diário; se não houver nenhum para esta apólice,
          // consulta individual por nº de apólice (qualquer ramo).
          let policyObjects = fileObjects;

          if (policyObjects.length === 0) {
            try {
              const objectResult = await obterObjetosPorNrApolice(
                policyNumber,
                account,
              );

              policyObjects = (objectResult.ListaObjetos ?? []).map(
                (object) => ({
                  NumeroApolice: object.NumeroApolice ?? source.NumeroApolice,
                  NumeroObjeto: object.NumeroObjeto ?? "",
                  DescricaoObjeto: object.DescricaoObjeto ?? "",
                  TipoObjeto: object.TipoObjeto ?? "",
                  Capital: String(object.Capital ?? ""),
                  EstadoCod: object.EstadoCod ?? "",
                  Estado: object.Estado ?? "",
                  Premio: String(object.Premio ?? ""),
                }),
              );
            } catch (objectError) {
              console.warn("[Zurich] Falha ao obter objetos da apólice", {
                account: account.key,
                policy: maskIdentifier(source.NumeroApolice),
                ...summarizeZurichError(objectError),
              });
            }
          }

          const vehicleObject = findVehicleObject(policyObjects);
          const vehicleRegistration = vehicleObject
            ? extractVehicleRegistration(vehicleObject.DescricaoObjeto)
            : null;

          normalized.providerMetadata = {
            ...normalized.providerMetadata,
            ...(vehicleObject
              ? {
                  insuredObject: {
                    number: vehicleObject.NumeroObjeto,
                    type: vehicleObject.TipoObjeto,
                    description: vehicleObject.DescricaoObjeto,
                    status: vehicleObject.Estado,
                  },
                }
              : {}),
            ...(vehicleRegistration ? { vehicleRegistration } : {}),
          };
        }

        const patchInput = enrichmentInput;

        if (patchInput) {
          const diagnostics = buildZurichEnrichmentPatch(null, patchInput)
            .diagnostics;

          if (diagnostics.vehicleSelection?.status === "AMBIGUOUS") {
            enrichmentStats.vehicleAmbiguous += 1;
          }

          if (dryRun && preview.length < 25) {
            preview.push({
              policy: maskIdentifier(source.NumeroApolice),
              account: account.key,
              paymentFrequency: normalized.paymentFrequency,
              objects: diagnostics.objectCount,
              coverages: diagnostics.coverageCount,
              vehicleSelection: diagnostics.vehicleSelection?.status ?? null,
              unparsableNumbers: diagnostics.unparsableNumbers,
              sources: {
                objects: patchInput.objects?.source ?? null,
                coverages: patchInput.coverages?.source ?? null,
              },
            });
          }
        }

        if (dryRun) {
          // Nada é escrito: nem cliente, nem apólice.
          skipped += 1;
          continue;
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
          // O enriquecimento nunca faz falhar a apólice: se o patch não
          // se conseguir montar, a apólice grava-se sem ele.
          metadataPatch: patchInput
            ? (existing) => {
                try {
                  return buildZurichEnrichmentPatch(existing, patchInput)
                    .metadata as Record<string, unknown>;
                } catch (patchError) {
                  console.warn(
                    "[Zurich] Enriquecimento ignorado (erro ao montar o patch)",
                    {
                      account: account.key,
                      policy: maskIdentifier(source.NumeroApolice),
                      error: sanitizeZurichText(
                        patchError instanceof Error
                          ? patchError.message
                          : String(patchError),
                      ),
                    },
                  );

                  return {};
                }
              }
            : undefined,
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

        // O objeto de erro inteiro não é impresso: mensagens de BD
        // (ex.: violação de chave única) podem repetir o NIF.
        console.error("[Zurich] Erro ao sincronizar apólice", {
          account: account.key,
          policy: maskIdentifier(source.NumeroApolice),
          error: sanitizeZurichText(message),
        });
      }
    }

    // ======================================
    // FINALIZAR
    // ======================================

    const finalStatus =
      failed === 0 ? "SUCCESS" : created + updated > 0 ? "PARTIAL" : "ERROR";

    if (failed === 0 && !options.limit && !dryRun) {
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

    if (syncRun) {
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
    }

    // Só contagens: nada de identificadores nem conteúdo.
    console.log("[Zurich] Sync de apólices concluído", {
      status: finalStatus,
      syncMode,
      dryRun,
      enrichmentEnabled,
      received,
      created,
      updated,
      skipped,
      failed,
      enrichment: enrichmentStats,
      fallback: budget,
    });

    return {
      ok: finalStatus !== "ERROR",
      dryRun,
      syncRunId: syncRun?.id ?? null,
      status: finalStatus,
      syncMode,
      accounts: accounts.map((a) => a.key),
      received,
      created,
      updated,
      skipped,
      failed,
      errors: errors.slice(0, 10),
      enrichment: {
        enabled: enrichmentEnabled,
        ...enrichmentStats,
        fallback: { ...budget },
      },
      ...(dryRun ? { preview } : {}),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro desconhecido";

    if (syncRun) {
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
    }

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
  // Recibos já existentes e sem alterações (batchUpsertReceipts devolve
  // isto separado de created/updated); sem isto no total, um sync com
  // poucas falhas transitórias (apólice ainda não sincronizada) aparecia
  // como created:0/updated:0/skipped:0 mesmo tendo processado tudo bem,
  // e o status caía para ERROR em vez de PARTIAL.
  let skipped = 0;
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
    skipped = batchResult.unchanged;

    // ======================================
    // FINALIZAR
    // ======================================

    const finalStatus =
      failed === 0
        ? "SUCCESS"
        : created + updated + skipped > 0
          ? "PARTIAL"
          : "ERROR";

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