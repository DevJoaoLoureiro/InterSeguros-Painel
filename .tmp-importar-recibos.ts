// Temporário: importa recibos Zurich a partir de uma lista exportada do
// MyZurich (só números de recibo) — cada recibo é lido no webservice
// (ObterReciboPorNr) para ter o prémio comercial e as datas.
import { existsSync, readFileSync, writeFileSync } from "fs";

import { createAdminClient } from "@/lib/supabase/admin";
import { obterReciboPorNr } from "@/lib/insurance/providers/zurich/client";
import { mapZurichReceipt } from "@/lib/insurance/providers/zurich/receipt-mapper";
import { batchUpsertReceipts } from "@/lib/insurance/sync/batch-upsert-receipts";

const ZURICH_ID = "8bf8f79c-4d6e-4854-8e87-3aa0918b08fa";
const CONCURRENCY = 4;

// A API devolve datas ISO e números; o mapper espera o formato do
// ficheiro diário (DD-MM-AAAA e texto).
function toFileFormat(api: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(api)) {
    const text = value === null || value === undefined ? "" : String(value);
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    out[key] = iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : text;
  }
  return out;
}

(async () => {
  const rows = JSON.parse(readFileSync(process.argv[2], "utf8")) as string[][];
  const numbers = [...new Set(rows.slice(1).map((r) => r[1].trim()).filter(Boolean))];
  console.log("recibos na lista", numbers.length);

  const fetched: Record<string, string>[] = [];
  const errors: string[] = [];
  let next = 0;

  async function worker() {
    while (next < numbers.length) {
      const nr = numbers[next++];
      try {
        const res = await obterReciboPorNr(nr);
        const raw = res.DadosRecibo as unknown;
        const recibo = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined;
        if (!recibo?.NumRecibo) throw new Error("sem dados");
        fetched.push(toFileFormat(recibo));
      } catch (error) {
        errors.push(`${nr}: ${(error as Error).message.slice(0, 120)}`);
      }
      if ((fetched.length + errors.length) % 100 === 0) {
        console.log("lidos", fetched.length + errors.length, "/", numbers.length);
      }
    }
  }

  const cache = process.argv[2].replace(/\.json$/, "-api.json");
  if (existsSync(cache)) {
    fetched.push(...JSON.parse(readFileSync(cache, "utf8")));
    console.log("lidos da cache", fetched.length);
  } else {
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    writeFileSync(cache, JSON.stringify(fetched));
  }

  const sb = createAdminClient();
  const items: { policyId: string; receipt: ReturnType<typeof mapZurichReceipt> }[] = [];
  const missingPolicies: string[] = [];

  for (const source of fetched) {
    // Campos que a API não devolve ficam vazios, como no ficheiro.
    const withDefaults = new Proxy(source, {
      get: (target, key) => (typeof key === "string" ? (target[key] ?? "") : undefined),
    });
    const normalized = mapZurichReceipt(withDefaults as never);
    const { data: policy } = await sb
      .from("policy_external_refs")
      .select("policy_id")
      .eq("company_id", ZURICH_ID)
      .eq("external_id", normalized.policyExternalId)
      .maybeSingle();

    if (!policy?.policy_id) {
      missingPolicies.push(`${normalized.policyExternalId} (recibo ${normalized.receiptNumber})`);
      continue;
    }
    items.push({ policyId: policy.policy_id, receipt: normalized });
  }

  const result = await batchUpsertReceipts({
    supabase: sb,
    companyId: ZURICH_ID,
    items: items as never,
  });

  console.log(
    "RESULTADO",
    JSON.stringify({
      lidosNaZurich: fetched.length,
      errosLeitura: errors.length,
      apolicesNaoEncontradas: missingPolicies.length,
      criados: result.created,
      atualizados: result.updated,
      iguais: result.unchanged,
    }),
  );
  if (errors.length) console.log("ERROS", errors.slice(0, 10).join(" | "));
  if (missingPolicies.length) console.log("SEM APOLICE", missingPolicies.slice(0, 10).join(" | "));
})();
