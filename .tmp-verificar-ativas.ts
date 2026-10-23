// Temporário: compara as apólices Zurich ativas no CRM com o estado real
// na Zurich (ObterApolicePorNr). Só leitura.
import { existsSync, readFileSync, writeFileSync } from "fs";

import { createAdminClient } from "@/lib/supabase/admin";
import { obterApolicePorNr } from "@/lib/insurance/providers/zurich/client";

const ZURICH_ID = "8bf8f79c-4d6e-4854-8e87-3aa0918b08fa";
const CONCURRENCY = 6;

(async () => {
  const out = process.argv[2];
  const sb = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const pols: { id: string; policy_number: string; payment_frequency: string | null; annualized_premium: number | null }[] = [];
  for (let f = 0; ; f += 1000) {
    const { data } = await sb
      .from("policies")
      .select("id,policy_number,payment_frequency,annualized_premium")
      .eq("company_id", ZURICH_ID)
      .eq("status", "ACTIVE")
      .not("start_date", "is", null)
      .lte("start_date", today)
      .order("id")
      .range(f, f + 999);
    pols.push(...((data ?? []) as typeof pols));
    if ((data ?? []).length < 1000) break;
  }

  const done: Record<string, unknown>[] = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : [];
  const seen = new Set(done.map((d) => d.id));
  const todo = pols.filter((p) => !seen.has(p.id));
  console.log("ativas no CRM", pols.length, "a verificar", todo.length);

  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < todo.length) {
        const p = todo[next++];
        try {
          const res = await obterApolicePorNr(p.policy_number.trim());
          const raw = res.DadosApolice as unknown;
          const d = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown>;
          done.push({
            id: p.id,
            nr: p.policy_number,
            crmFreq: p.payment_frequency,
            crmPremio: p.annualized_premium,
            ramo: d?.Ramo,
            linha: d?.LinhaNegocioDesc,
            estado: d?.Estado,
            fracc: d?.Fraccionamento,
            premio: d?.PremioApolice,
            tipoPremio: d?.TipoPremio,
            dataFim: d?.DataFim,
            dataCancelamento: d?.DataCancelamento,
          });
        } catch (error) {
          done.push({ id: p.id, nr: p.policy_number, erro: (error as Error).message.slice(0, 120) });
        }
        if (done.length % 200 === 0) {
          writeFileSync(out, JSON.stringify(done));
          console.log("verificadas", done.length);
        }
      }
    }),
  );
  writeFileSync(out, JSON.stringify(done));

  const estados: Record<string, number> = {};
  for (const d of done) {
    const k = d.erro ? "ERRO" : `${d.ramo}|${d.estado}`;
    estados[k] = (estados[k] ?? 0) + 1;
  }
  console.log("ESTADOS", JSON.stringify(estados));
})();
