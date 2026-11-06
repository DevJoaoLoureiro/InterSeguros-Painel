import { createAdminClient } from "@/lib/supabase/admin";
import { fillMissingContacts } from "@/lib/insurance/sync/client-contacts";
import { PLACEHOLDER_CLIENT_PREFIX } from "@/lib/insurance/sync/client-placeholder";

import { obterClientePorIdNif } from "./client";
import {
  parseClientesFileFromText,
  type ZurichClienteFicheiro,
} from "./file-parser";
import { summarizeZurichError } from "./log-safety";
import { fichaFromWebservice, mapZurichClient } from "./mapper";

/*
 * Recuperar os nomes dos clientes Zurich que ficaram com o nome
 * provisório "Cliente NIF …".
 *
 * Porquê: quando a apólice entrou no CRM, a Zurich não devolveu a
 * ficha do cliente (ObterClientePorIDNIF vazio ou com erro). O sync
 * só volta a olhar para uma apólice quando ela reaparece nos ficheiros
 * diários — uma apólice anulada nunca reaparece — por isso o nome
 * provisório ficava para sempre. Isto volta a perguntar à Zurich.
 *
 * Segurança:
 *   - por omissão é SIMULAÇÃO: pergunta à Zurich e conta, não grava;
 *   - usa o token em vigor (nunca emite nem renova tokens);
 *   - um pedido de cada vez, com pausa, e pára após erros seguidos
 *     (ex.: token rejeitado) em vez de insistir;
 *   - só substitui o nome provisório; contactos só preenchem o vazio.
 *   - o resultado não traz nomes nem NIF (só contagens e ids internos).
 */

const ZURICH_CODE = "ZURICH";
const PAGE = 1000;
const IN_CHUNK = 150;
const MAX_CONSECUTIVE_ERRORS = 3;

export type RecoverOptions = {
  apply: boolean;
  // Quantos clientes perguntar à Zurich nesta corrida.
  limit: number;
  // Pausa entre pedidos (ms).
  delayMs?: number;
  // Continuar depois deste id (o `nextAfter` da corrida anterior):
  // os não encontrados mantêm o nome provisório e, sem isto, cada
  // corrida voltava a perguntar pelos mesmos.
  after?: string | null;
};

export type RecoverResult = {
  mode: "simulação" | "gravado";
  placeholders: number;
  tried: number;
  found: number;
  updated: number;
  notFound: number;
  errors: number;
  stoppedEarly: boolean;
  remaining: number;
  // Passar como ?after= na corrida seguinte (null = chegou ao fim).
  nextAfter: string | null;
  // Ids internos (não são dados pessoais) para ver no CRM.
  foundClientIds: string[];
  notFoundClientIds: string[];
  errorSamples: string[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Admin = ReturnType<typeof createAdminClient>;

/*
 * Clientes com nome provisório e o respetivo IDCliente na Zurich
 * (client_external_refs), ordenados por id.
 */
async function loadPlaceholders(admin: Admin) {
  const { data: company, error: companyError } = await admin
    .from("companies")
    .select("id")
    .eq("code", ZURICH_CODE)
    .single();

  if (companyError || !company) {
    throw new Error("Companhia Zurich não encontrada.");
  }

  // ---------------- 1. Clientes com nome provisório
  const placeholders: { id: string; nif: string | null }[] = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("clients")
      .select("id, nif")
      .like("name", `${PLACEHOLDER_CLIENT_PREFIX}%`)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) throw new Error(`Erro ao ler clientes: ${error.message}`);

    placeholders.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  // ---------------- 2. ID do cliente na Zurich (client_external_refs)
  const zurichIdByClient = new Map<string, string>();

  for (let i = 0; i < placeholders.length; i += IN_CHUNK) {
    const ids = placeholders.slice(i, i + IN_CHUNK).map((c) => c.id);

    const { data, error } = await admin
      .from("client_external_refs")
      .select("client_id, external_id")
      .eq("company_id", company.id)
      .in("client_id", ids);

    if (error) throw new Error(`Erro ao ler fichas Zurich: ${error.message}`);

    for (const ref of data ?? []) {
      // O sync grava a referência como "NIF:<nif>" (ou "POLICY:<nº>"),
      // não com o IDCliente da Zurich: essas não servem de ClienteID.
      const external = String(ref.external_id).trim();
      if (/^(NIF|POLICY):/i.test(external)) continue;
      zurichIdByClient.set(ref.client_id as string, external);
    }
  }

  return { companyId: company.id as string, placeholders, zurichIdByClient };
}

/*
 * Grava a ficha num cliente com nome provisório. Nunca por cima de
 * um nome verdadeiro; contactos só preenchem o que está vazio.
 * Devolve a mensagem de erro, ou null.
 */
async function saveFicha(
  admin: Admin,
  companyId: string,
  clientId: string,
  ficha: ZurichClienteFicheiro,
  zurichId: string | undefined,
  nif: string | null,
): Promise<string | null> {
  const mapped = mapZurichClient(ficha, nif);

  const { error } = await admin
    .from("clients")
    .update({
      name: mapped.name,
      birth_date: mapped.birthDate,
      street: mapped.street,
      postal_code: mapped.postalCode,
      city: mapped.city,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientId)
    .like("name", `${PLACEHOLDER_CLIENT_PREFIX}%`);

  if (error) return `Gravar cliente: ${error.message}`;

  await fillMissingContacts(admin, clientId, {
    phone: mapped.phone,
    email: mapped.email,
  });

  if (zurichId && mapped.metadata) {
    await admin
      .from("client_external_refs")
      .update({
        provider_metadata: mapped.metadata,
        last_synced_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("external_id", zurichId);
  }

  return null;
}

export async function recoverZurichClientNames({
  apply,
  limit,
  delayMs = 300,
  after = null,
}: RecoverOptions): Promise<RecoverResult> {
  const admin = createAdminClient();
  const { companyId, placeholders, zurichIdByClient } =
    await loadPlaceholders(admin);

  // Só os que são clientes Zurich (têm ficha Zurich ou, pelo menos, NIF).
  // Ordenados por id (como a leitura): `after` continua a lista.
  const candidates = placeholders.filter(
    (c) =>
      (zurichIdByClient.has(c.id) || (c.nif ?? "").trim() !== "") &&
      (!after || c.id > after),
  );

  const batch = candidates.slice(0, Math.max(0, limit));
  let lastTriedId: string | null = null;
  // Último a que a Zurich respondeu (com ou sem ficha), antes de um
  // erro — para retomar daí se a corrida parar por erros seguidos.
  let lastAnsweredId: string | null = null;

  const result: RecoverResult = {
    mode: apply ? "gravado" : "simulação",
    placeholders: placeholders.length,
    tried: 0,
    found: 0,
    updated: 0,
    notFound: 0,
    errors: 0,
    stoppedEarly: false,
    remaining: 0,
    nextAfter: null,
    foundClientIds: [],
    notFoundClientIds: [],
    errorSamples: [],
  };

  let consecutiveErrors = 0;

  // ---------------- 3. Perguntar à Zurich, um de cada vez
  for (const client of batch) {
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      result.stoppedEarly = true;
      break;
    }

    if (result.tried > 0) await sleep(delayMs);
    result.tried += 1;
    lastTriedId = client.id;

    const zurichId = zurichIdByClient.get(client.id);
    const nif = (client.nif ?? "").replace(/\D/g, "") || undefined;

    let dados: Record<string, unknown> | undefined;

    try {
      const response = await obterClientePorIdNif({
        clienteId: zurichId || undefined,
        clienteNif: nif,
      });
      dados = response.DadosCliente?.[0];
      consecutiveErrors = 0;
      lastAnsweredId = client.id;
    } catch (error) {
      const summary = summarizeZurichError(error);

      // Códigos 6/7 = "sem dados": a Zurich respondeu, só não tem a
      // ficha. Não é avaria — conta como "não encontrado".
      if (
        summary.errorKind === "ZURICH_ERROR" &&
        (summary.zurichCode === 6 || summary.zurichCode === 7)
      ) {
        consecutiveErrors = 0;
        lastAnsweredId = client.id;
        result.notFound += 1;
        result.notFoundClientIds.push(client.id);
        continue;
      }

      consecutiveErrors += 1;
      result.errors += 1;

      if (result.errorSamples.length < 5) {
        result.errorSamples.push(JSON.stringify(summary));
      }
      continue;
    }

    const ficha = dados ? fichaFromWebservice(dados) : null;

    if (!ficha || !ficha.NomeCliente.trim()) {
      result.notFound += 1;
      result.notFoundClientIds.push(client.id);
      continue;
    }

    result.found += 1;
    result.foundClientIds.push(client.id);

    if (!apply) continue;

    // ---------------- 4. Gravar (só com apply)
    const saveError = await saveFicha(
      admin,
      companyId,
      client.id,
      ficha,
      zurichId,
      nif ?? null,
    );

    if (saveError) {
      result.errors += 1;
      if (result.errorSamples.length < 5) result.errorSamples.push(saveError);
      continue;
    }

    result.updated += 1;
  }

  result.remaining = Math.max(0, candidates.length - result.tried);
  // Parou por erros seguidos: recomeça antes desses (não os salta).
  const resumeFrom = result.stoppedEarly ? lastAnsweredId ?? after : lastTriedId;
  result.nextAfter = result.remaining > 0 || result.stoppedEarly ? resumeFrom : null;

  return result;
}

// =====================================================
// A PARTIR DO FICHEIRO "CARTEIRA TOTAL" (sem chamar a Zurich)
// =====================================================
//
// O ficheiro de Clientes da Carteira Total (portal MyZurich, menu
// "Serviços") traz todos os clientes do agente, anulados incluídos
// (CodSituacao 2). É a melhor fonte: não gasta o token nem faz
// pedidos à Zurich. Liga-se pelo IDCliente (client_external_refs) e,
// em falta, pelo NIF.

export type RecoverFromFileResult = {
  mode: "simulação" | "gravado";
  fileClients: number;
  placeholders: number;
  found: number;
  updated: number;
  notFound: number;
  errors: number;
  foundClientIds: string[];
  notFoundClientIds: string[];
  errorSamples: string[];
};

export async function recoverZurichClientNamesFromFile({
  content,
  apply,
}: {
  content: string;
  apply: boolean;
}): Promise<RecoverFromFileResult> {
  const fichas = parseClientesFileFromText(content).filter(
    (f) => f.NomeCliente.trim() !== "",
  );

  if (fichas.length === 0) {
    throw new Error(
      "O ficheiro não tem clientes com nome. Confirma que é o ficheiro de Clientes da Carteira Total.",
    );
  }

  const byId = new Map<string, ZurichClienteFicheiro>();
  const byNif = new Map<string, ZurichClienteFicheiro>();

  for (const ficha of fichas) {
    const id = ficha.IDCliente.trim();
    const nif = ficha.NIF.replace(/\D/g, "");
    if (id) byId.set(id, ficha);
    if (nif) byNif.set(nif, ficha);
  }

  const admin = createAdminClient();
  const { companyId, placeholders, zurichIdByClient } =
    await loadPlaceholders(admin);

  const result: RecoverFromFileResult = {
    mode: apply ? "gravado" : "simulação",
    fileClients: fichas.length,
    placeholders: placeholders.length,
    found: 0,
    updated: 0,
    notFound: 0,
    errors: 0,
    foundClientIds: [],
    notFoundClientIds: [],
    errorSamples: [],
  };

  for (const client of placeholders) {
    const zurichId = zurichIdByClient.get(client.id);
    const nif = (client.nif ?? "").replace(/\D/g, "") || null;

    const ficha =
      (zurichId ? byId.get(zurichId) : undefined) ??
      (nif ? byNif.get(nif) : undefined);

    if (!ficha) {
      result.notFound += 1;
      result.notFoundClientIds.push(client.id);
      continue;
    }

    result.found += 1;
    result.foundClientIds.push(client.id);

    if (!apply) continue;

    const saveError = await saveFicha(admin, companyId, client.id, ficha, zurichId, nif);

    if (saveError) {
      result.errors += 1;
      if (result.errorSamples.length < 5) result.errorSamples.push(saveError);
      continue;
    }

    result.updated += 1;
  }

  return result;
}