/*
 * SÓ LEITURA. Extrai um dataset DES-IDENTIFICADO da carteira Zurich (sem NIF,
 * nomes, moradas, matrículas nem ids reais) para o backtest do estimador.
 * Só usa as 2 variáveis Supabase do .env.local; NÃO fala com a Zurich e não
 * escreve em nenhum sítio (a BD do .env.local é PRODUÇÃO: só faz SELECT).
 * O ficheiro de saída contém prémios e idades reais: não o versionar.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// Corre-se a partir da raiz do projeto: node src/lib/quoting/models/zurich/validation/extract-dataset.mjs <saida.json>
const ROOT = process.cwd();

const env = {};
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PLATE = /\b[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]{2}\b/gi;

function scrub(meta) {
  if (!meta || typeof meta !== "object") return null;
  const cleanObj = (o) => o && typeof o === "object"
    ? { ...o, description: typeof o.description === "string" ? o.description.replace(PLATE, "<PLACA>") : o.description }
    : o;
  const out = {};
  if (meta.vehicleRegistration) out.hasRegistration = true;
  if (meta.insuredObject) out.insuredObject = cleanObj(meta.insuredObject);
  if (Array.isArray(meta.insuredObjects)) out.insuredObjects = meta.insuredObjects.map(cleanObj);
  if (Array.isArray(meta.coverages)) out.coverages = meta.coverages;
  if (meta.paymentFrequencyRaw) out.paymentFrequencyRaw = meta.paymentFrequencyRaw;
  if (meta.enrichment) out.enrichment = meta.enrichment;
  out._keys = Object.keys(meta);
  return out;
}

async function page(build, size = 1000, max = 20000) {
  const rows = [];
  for (let from = 0; from < max; from += size) {
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < size) break;
  }
  return rows;
}

(async () => {
  const { data: comp } = await sb.from("companies").select("id").eq("code", "ZURICH").maybeSingle();
  const policies = await page(() =>
    sb.from("policies")
      .select("id, client_id, product_code, product_name, status, issue_date, start_date, renewal_date, commercial_premium, total_premium, annualized_premium, payment_frequency, provider_metadata, last_synced_at, insurance_line_id")
      .eq("company_id", comp.id)
      .order("id"));

  const clientIds = [...new Set(policies.map((p) => p.client_id).filter(Boolean))];
  const clients = new Map();
  for (let i = 0; i < clientIds.length; i += 200) {
    const { data, error } = await sb.from("clients").select("id, birth_date, postal_code").in("id", clientIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const c of data) clients.set(c.id, c);
  }

  const receipts = await page(() =>
    sb.from("receipts")
      .select("id, policy_id, receipt_type, external_nature, period_start, period_end, issue_date, due_date, commercial_premium, total_premium, status")
      .eq("company_id", comp.id)
      .order("id"));

  const idx = new Map(policies.map((p, i) => [p.id, i]));
  const recByPolicy = new Map();
  for (const r of receipts) {
    const i = idx.get(r.policy_id);
    if (i === undefined) continue;
    if (!recByPolicy.has(i)) recByPolicy.set(i, []);
    recByPolicy.get(i).push({
      type: r.receipt_type, nature: r.external_nature, ps: r.period_start, pe: r.period_end,
      issue: r.issue_date, due: r.due_date, commercial: r.commercial_premium, total: r.total_premium, status: r.status,
    });
  }

  const out = policies.map((p, i) => {
    const c = p.client_id ? clients.get(p.client_id) : null;
    return {
      i,
      client: p.client_id ? [...clientIds].indexOf(p.client_id) : null,
      productCode: p.product_code, productName: p.product_name, status: p.status,
      issue: p.issue_date, start: p.start_date, renewal: p.renewal_date,
      commercial: p.commercial_premium, total: p.total_premium, annualized: p.annualized_premium,
      freq: p.payment_frequency, lastSyncedAt: p.last_synced_at, lineId: p.insurance_line_id,
      birthDate: c?.birth_date ?? null,
      postal4: c?.postal_code ? (c.postal_code.match(/^(\d{4})/)?.[1] ?? null) : null,
      meta: scrub(p.provider_metadata),
      receipts: recByPolicy.get(i) ?? [],
    };
  });

  const file = path.join(process.argv[2]);
  fs.writeFileSync(file, JSON.stringify({ extractedAt: new Date().toISOString(), policies: out }));
  console.log("policies (todas as linhas Zurich):", out.length, "| recibos:", receipts.length, "| clientes:", clients.size);
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
