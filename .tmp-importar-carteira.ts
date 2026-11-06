// Temporário: importa a Carteira Total da Zurich (ficheiros *_Carteira.csv
// descarregados do portal MyZurich → Serviços) para o CRM.
//
// NÃO faz pedidos à Zurich (sync em modo offline): tudo vem dos ficheiros.
//
// Uso:
//   npx tsx --env-file=.env.local .tmp-importar-carteira.ts <pasta>            análise (não grava)
//   npx tsx --env-file=.env.local .tmp-importar-carteira.ts <pasta> --apply    grava
//
// O resumo não mostra nomes, NIF nem números de apólice.
import { readFileSync } from "fs";
import { join } from "path";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  parseApolicesFileFromText,
  parseClientesFileFromText,
  parseCoberturasFileFromText,
  parseObjetosFileFromText,
  parseRecibosFileFromText,
} from "@/lib/insurance/providers/zurich/file-parser";
import { mapZurichReceipt } from "@/lib/insurance/providers/zurich/receipt-mapper";
import { recoverZurichClientNamesFromFile } from "@/lib/insurance/providers/zurich/recover-client-names";
import { syncZurichPolicies } from "@/lib/insurance/providers/zurich/sync";
import { batchUpsertReceipts } from "@/lib/insurance/sync/batch-upsert-receipts";
import { PLACEHOLDER_CLIENT_PREFIX } from "@/lib/insurance/sync/client-placeholder";

const PAGE = 1000;

function readLatin1(dir: string, name: string) {
  return readFileSync(join(dir, name)).toString("latin1");
}

async function pageAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

function countBy<T>(items: T[], key: (item: T) => string) {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

(async () => {
  const dir = process.argv[2];
  const apply = process.argv.includes("--apply");

  if (!dir) {
    console.error("Indica a pasta com os ficheiros *_Carteira.csv");
    process.exit(1);
  }

  // ---------------- FICHEIROS
  const clientes = parseClientesFileFromText(readLatin1(dir, "Clientes_Carteira.csv"));
  const apolices = parseApolicesFileFromText(readLatin1(dir, "Apólices_Carteira.csv"));
  const objetos = parseObjetosFileFromText(readLatin1(dir, "Objetos Risco_Carteira.csv"));
  const coberturas = parseCoberturasFileFromText(readLatin1(dir, "Coberturas_Carteira.csv"));
  const recibos = parseRecibosFileFromText(readLatin1(dir, "Recibos_Carteira.csv"));

  console.log("FICHEIROS", JSON.stringify({
    clientes: clientes.length,
    apolices: apolices.length,
    objetos: objetos.length,
    coberturas: coberturas.length,
    recibos: recibos.length,
    apolicesPorEstado: countBy(apolices, (a) => a.Estado || "?"),
    apolicesPorRamo: countBy(apolices, (a) => a.Ramo || "?"),
  }));

  // Verificação básica do formato (colunas no sítio certo).
  const badPolicies = apolices.filter((a) => !/^\d+$/.test(a.NumeroApolice.trim())).length;
  const badReceipts = recibos.filter((r) => !/^\d+$/.test(r.NumRecibo.trim())).length;
  const badClients = clientes.filter((c) => !c.NomeCliente.trim()).length;
  console.log("FORMATO", JSON.stringify({ badPolicies, badReceipts, clientesSemNome: badClients }));

  // ---------------- CRM (só leitura)
  const sb = createAdminClient();

  const { data: company, error: companyError } = await sb
    .from("companies").select("id").eq("code", "ZURICH").single();
  if (companyError || !company) throw new Error("Companhia Zurich não encontrada");

  const policyRefs = await pageAll<{ external_id: string; policy_id: string }>((f, t) =>
    sb.from("policy_external_refs").select("external_id, policy_id")
      .eq("company_id", company.id).order("external_id").range(f, t));
  const knownPolicies = new Set(policyRefs.map((r) => String(r.external_id).trim()));

  const receiptRows = await pageAll<{ external_id: string }>((f, t) =>
    sb.from("receipts").select("external_id")
      .eq("company_id", company.id).order("external_id").range(f, t));
  const knownReceipts = new Set(receiptRows.map((r) => String(r.external_id).trim()));

  const placeholders = await pageAll<{ id: string; nif: string | null }>((f, t) =>
    sb.from("clients").select("id, nif")
      .like("name", `${PLACEHOLDER_CLIENT_PREFIX}%`).order("id").range(f, t));

  const fileNifs = new Set(clientes.map((c) => c.NIF.replace(/\D/g, "")).filter(Boolean));
  const policyNumbersInFile = new Set(apolices.map((a) => a.NumeroApolice.trim()));

  const mappedReceipts = recibos.map((r) => mapZurichReceipt(r));
  const receiptsNew = mappedReceipts.filter((r) => !knownReceipts.has(r.externalId)).length;
  const receiptsWithoutPolicy = mappedReceipts.filter(
    (r) => !knownPolicies.has(r.policyExternalId) && !policyNumbersInFile.has(r.policyExternalId),
  ).length;

  const missingPolicies = apolices.filter((a) => !knownPolicies.has(a.NumeroApolice.trim()));

  console.log("COMPARACAO", JSON.stringify({
    apolicesNoCRM: knownPolicies.size,
    apolicesNovas: missingPolicies.length,
    apolicesNovasPorEstado: countBy(missingPolicies, (a) => a.Estado || "?"),
    apolicesNovasPorRamo: countBy(missingPolicies, (a) => a.Ramo || "?"),
    apolicesAtualizadas: apolices.length - missingPolicies.length,
    recibosNoCRM: knownReceipts.size,
    recibosNovos: receiptsNew,
    recibosAtualizados: mappedReceipts.length - receiptsNew,
    recibosSemApolice: receiptsWithoutPolicy,
    clientesSemNomeNoCRM: placeholders.length,
    clientesSemNomeResolvidos: placeholders.filter((p) => fileNifs.has((p.nif ?? "").replace(/\D/g, ""))).length,
  }));

  if (!apply) {
    console.log("ANALISE concluída — nada foi gravado. Corre com --apply para importar.");
    return;
  }

  // A Carteira Total é de 23/10: as apólices e recibos que JÁ existem no
  // CRM podem ter dados mais recentes (sync diário). Por isso só se
  // CRIA o que falta — o que existe nunca é tocado.

  // ---------------- 1. APÓLICES EM FALTA + CLIENTES (+ objetos/coberturas)
  console.log("A importar apólices em falta…", missingPolicies.length, new Date().toISOString());
  const policyResult = (await syncZurichPolicies({
    sourcePolicies: missingPolicies,
    sourceClients: clientes,
    sourceObjects: objetos,
    sourceCoverages: coberturas,
    offline: true,
    enrichment: true,
    keepExistingClients: true,
  })) as unknown as Record<string, unknown>;

  console.log("APOLICES", JSON.stringify({
    status: policyResult.status,
    received: policyResult.received,
    created: policyResult.created,
    updated: policyResult.updated,
    failed: policyResult.failed,
    errors: Array.isArray(policyResult.errors) ? policyResult.errors.length : 0,
  }), new Date().toISOString());

  // ---------------- 2. RECIBOS
  const refsAfter = await pageAll<{ external_id: string; policy_id: string }>((f, t) =>
    sb.from("policy_external_refs").select("external_id, policy_id")
      .eq("company_id", company.id).order("external_id").range(f, t));
  const policyIdByNumber = new Map(refsAfter.map((r) => [String(r.external_id).trim(), r.policy_id]));

  const items: { policyId: string; receipt: ReturnType<typeof mapZurichReceipt> }[] = [];
  let skippedNoPolicy = 0;

  for (const receipt of mappedReceipts) {
    // Recibo já no CRM: pode estar mais atualizado (ex.: pago depois
    // de 23/10). Não se toca.
    if (knownReceipts.has(receipt.externalId)) continue;

    const policyId = policyIdByNumber.get(receipt.policyExternalId);
    if (!policyId) {
      skippedNoPolicy += 1;
      continue;
    }
    items.push({ policyId, receipt });
  }

  console.log("A importar recibos…", items.length);
  const receiptResult = await batchUpsertReceipts({
    supabase: sb,
    companyId: company.id,
    items,
  });

  console.log("RECIBOS", JSON.stringify({
    ...receiptResult,
    semApolice: skippedNoPolicy,
  }), new Date().toISOString());

  // ---------------- 3. CLIENTES "Cliente NIF …" (só esses)
  const names = await recoverZurichClientNamesFromFile({
    content: readLatin1(dir, "Clientes_Carteira.csv"),
    apply: true,
  });
  console.log("NOMES", JSON.stringify({
    encontrados: names.found,
    gravados: names.updated,
    naoEncontrados: names.notFound,
    erros: names.errors,
  }));

  const placeholdersAfter = await pageAll<{ id: string }>((f, t) =>
    sb.from("clients").select("id").like("name", `${PLACEHOLDER_CLIENT_PREFIX}%`).order("id").range(f, t));

  console.log("CLIENTES_SEM_NOME", JSON.stringify({
    antes: placeholders.length,
    depois: placeholdersAfter.length,
  }));
})().catch((error) => {
  console.error("ERRO", error instanceof Error ? error.message : error);
  process.exit(1);
});
