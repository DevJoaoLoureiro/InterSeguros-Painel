// Temporário: cria no CRM as apólices Zurich referidas nos recibos
// importados mas que nunca vieram nos ficheiros diários (ex.: Vida).
// Cada apólice é lida com ObterApolicePorNr e passa pelo sync normal.
// Uso: tsx .tmp-importar-apolices.ts <pasta recibos> [--apply]
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";

import { createAdminClient } from "@/lib/supabase/admin";
import { obterApolicePorNr } from "@/lib/insurance/providers/zurich/client";
import { syncZurichPolicies } from "@/lib/insurance/providers/zurich/sync";

const ZURICH_ID = "8bf8f79c-4d6e-4854-8e87-3aa0918b08fa";
const CONCURRENCY = 4;

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
  const dir = process.argv[2];
  const apply = process.argv.includes("--apply");
  const sb = createAdminClient();

  const known = new Set<string>();
  for (let f = 0; ; f += 1000) {
    const { data } = await sb.from("policy_external_refs").select("external_id").eq("company_id", ZURICH_ID).range(f, f + 999);
    for (const r of data ?? []) known.add(String(r.external_id).trim());
    if ((data ?? []).length < 1000) break;
  }

  const missing = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith("-api.json"))) {
    for (const r of JSON.parse(readFileSync(`${dir}/${file}`, "utf8")) as Record<string, string>[]) {
      const nr = r.NumeroApolice.trim();
      if (nr && !known.has(nr)) missing.add(nr);
    }
  }
  console.log("apolices em falta", missing.size);

  const cache = `${dir}/apolices-api.json`;
  let fetched: Record<string, string>[] = [];
  const errors: string[] = [];

  if (existsSync(cache)) {
    fetched = JSON.parse(readFileSync(cache, "utf8"));
  } else {
    const list = [...missing];
    let next = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (next < list.length) {
          const nr = list[next++];
          try {
            const res = await obterApolicePorNr(nr);
            const raw = res.DadosApolice as unknown;
            const d = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined;
            if (!d?.NumeroApolice) throw new Error("sem dados");
            fetched.push(toFileFormat(d));
          } catch (error) {
            errors.push(`${nr}: ${(error as Error).message.slice(0, 100)}`);
          }
        }
      }),
    );
    writeFileSync(cache, JSON.stringify(fetched));
  }

  const estados: Record<string, number> = {};
  for (const p of fetched) {
    const k = `${p.Ramo}|${p.Estado}`;
    estados[k] = (estados[k] ?? 0) + 1;
  }
  console.log("LIDAS", fetched.length, "erros", errors.length, JSON.stringify(estados));
  if (errors.length) console.log("ERROS", errors.slice(0, 5).join(" | "));

  // Campos que a API não devolve (ex.: DataRevalidacao) ficam vazios.
  const sources = fetched.map(
    (p) =>
      new Proxy(p, {
        get: (target, key) => (typeof key === "string" ? (target[key] ?? "") : undefined),
      }),
  );

  const result = await syncZurichPolicies({
    sourcePolicies: sources as never,
    dryRun: !apply,
    enrichment: false,
  });
  const summary = result as unknown as Record<string, unknown>;
  console.log(
    "RESULTADO",
    apply ? "(gravado)" : "(simulação)",
    JSON.stringify({
      status: summary.status,
      received: summary.received,
      created: summary.created,
      updated: summary.updated,
      failed: summary.failed,
      errors: Array.isArray(summary.errors) ? summary.errors.slice(0, 5) : undefined,
    }),
  );
})();
