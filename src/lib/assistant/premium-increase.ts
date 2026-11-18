import type { SupabaseClient } from "@supabase/supabase-js";

import { clientHref } from "@/lib/clients/client-link";

/*
 * Alertas de subida de prémio na renovação (mensagens do assistente).
 *
 * A Generali emite o recibo da nova anuidade ~45 dias antes da
 * renovação. Compara-se o recibo que abre a nova anuidade com o que
 * abriu a anuidade anterior (mesma posição: a 1.ª prestação de um
 * mensal com a 1.ª prestação do ano passado), e anualiza-se pela
 * frequência. Em 2026-11-18: 291 renovações comparáveis em 398, 148
 * subidas acima de 10%.
 *
 * Limite (pensado com a loja: subidas pequenas não justificam uma
 * chamada, subidas grandes num seguro caro sim):
 *   alerta  — ≥10% e ≥20 €/ano, ou ≥100 €/ano;
 *   urgente — ≥25% ou ≥150 €/ano.
 *
 * Destino: o comercial da apólice; sem comercial, a loja; sem loja,
 * só administradores (ver assistant_messages).
 *
 * Só Generali por agora (a Zurich e a Prévoir não emitem a anuidade
 * com antecedência da mesma forma; ficam para depois).
 */

const LOOK_BEHIND_DAYS = 7;
const LOOK_AHEAD_DAYS = 45;

const MIN_PCT = 10;
const MIN_ANNUAL_EUR = 20;
const ALWAYS_ANNUAL_EUR = 100;
const HIGH_PCT = 25;
const HIGH_ANNUAL_EUR = 150;

const PER_YEAR: Record<string, number> = {
  MONTHLY: 12,
  QUARTERLY: 4,
  SEMIANNUAL: 2,
  ANNUAL: 1,
};

type Policy = {
  id: string;
  policy_number: string;
  client_id: string | null;
  issuing_store_id: string | null;
  commercial_user_id: string | null;
  payment_frequency: string | null;
  start_date: string | null;
  product_name: string | null;
  inicio: string | null;
  client: { name: string | null } | { name: string | null }[] | null;
  line: { name: string | null } | { name: string | null }[] | null;
};

type Receipt = {
  policy_id: string;
  period_start: string | null;
  commercial_premium: number | string | null;
  total_premium: number | string | null;
  status: string | null;
};

export type PremiumIncreaseResult = {
  renewals: number;
  comparable: number;
  alerts: number;
  created: number;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function dayKey(offsetDays: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function minusOneYear(date: string) {
  const [year, month, day] = date.split("-");
  return `${Number(year) - 1}-${month}-${day}`;
}

const euro = (value: number) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(value);

const shortDate = (date: string) => {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
};

export async function detectGeneraliPremiumIncreases(
  supabase: SupabaseClient,
): Promise<PremiumIncreaseResult> {
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("code", "GENERALI")
    .maybeSingle();

  const result: PremiumIncreaseResult = { renewals: 0, comparable: 0, alerts: 0, created: 0 };
  if (!company) return result;

  const from = dayKey(-LOOK_BEHIND_DAYS);
  const to = dayKey(LOOK_AHEAD_DAYS);

  // Renovações da janela: início da anuidade (provider_metadata) dentro
  // de [from, to] e que não seja o arranque do contrato.
  const policies: Policy[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("policies")
      .select(`
        id, policy_number, client_id, issuing_store_id, commercial_user_id,
        payment_frequency, start_date, product_name,
        inicio:provider_metadata->>inicioPeriodo,
        client:clients ( name ),
        line:insurance_lines ( name )
      `)
      .eq("company_id", company.id)
      .eq("status", "ACTIVE")
      .gte("provider_metadata->>inicioPeriodo", from)
      .lte("provider_metadata->>inicioPeriodo", to)
      .order("id")
      .range(offset, offset + 999);

    if (error) throw new Error(`Erro ao ler renovações Generali: ${error.message}`);

    policies.push(
      ...((data ?? []) as unknown as Policy[]).filter(
        (p) => p.inicio && (!p.start_date || p.inicio > p.start_date),
      ),
    );
    if (!data || data.length < 1000) break;
  }

  result.renewals = policies.length;

  const messages: Record<string, unknown>[] = [];

  for (let i = 0; i < policies.length; i += 100) {
    const chunk = policies.slice(i, i + 100);
    const { data, error } = await supabase
      .from("receipts")
      .select("policy_id, period_start, commercial_premium, total_premium, status")
      .in("policy_id", chunk.map((p) => p.id));

    if (error) throw new Error(`Erro ao ler recibos Generali: ${error.message}`);

    const receipts = ((data ?? []) as Receipt[]).filter(
      (r) => Number(r.total_premium) > 0 && r.status !== "CANCELLED",
    );

    for (const policy of chunk) {
      const start = policy.inicio!;
      const mine = receipts.filter((r) => r.policy_id === policy.id);
      const current = mine.find((r) => r.period_start === start);
      const previous = mine.find((r) => r.period_start === minusOneYear(start));

      const before = Number(previous?.commercial_premium ?? 0);
      const after = Number(current?.commercial_premium ?? 0);
      if (!current || !previous || before <= 0 || after <= 0) continue;

      result.comparable += 1;

      const perYear = PER_YEAR[policy.payment_frequency ?? "ANNUAL"] ?? 1;
      const annualBefore = before * perYear;
      const annualAfter = after * perYear;
      const annualDiff = annualAfter - annualBefore;
      const pct = (annualDiff / annualBefore) * 100;

      const alert =
        (pct >= MIN_PCT && annualDiff >= MIN_ANNUAL_EUR) || annualDiff >= ALWAYS_ANNUAL_EUR;
      if (!alert) continue;

      result.alerts += 1;

      const high = pct >= HIGH_PCT || annualDiff >= HIGH_ANNUAL_EUR;
      const clientName = one(policy.client)?.name ?? "Cliente";
      const product = one(policy.line)?.name ?? policy.product_name ?? "seguro";
      const pctLabel = `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;

      messages.push({
        kind: "PREMIUM_INCREASE",
        severity: high ? "high" : "warning",
        store_id: policy.issuing_store_id,
        target_user_id: policy.commercial_user_id,
        policy_id: policy.id,
        client_id: policy.client_id,
        title: `${clientName}: renovação sobe ${pctLabel}`,
        body:
          `A renovação de ${product} (Generali, apólice ${policy.policy_number}) a ` +
          `${shortDate(start)} passa de ${euro(annualBefore)} para ${euro(annualAfter)} ` +
          `por ano (${annualDiff >= 0 ? "+" : ""}${euro(annualDiff)}). ` +
          (high
            ? "É uma subida grande: vale a pena ligar ao cliente antes da data e ver alternativas."
            : "Bom momento para contactar o cliente antes da renovação."),
        href: policy.client_id ? clientHref(policy.client_id) : null,
        data: {
          company: "GENERALI",
          renewalDate: start,
          annualBefore: Math.round(annualBefore * 100) / 100,
          annualAfter: Math.round(annualAfter * 100) / 100,
          pct: Math.round(pct * 10) / 10,
          frequency: policy.payment_frequency,
        },
        dedupe_key: `PREMIUM_INCREASE:${policy.id}:${start}`,
      });
    }
  }

  // Só cria as que ainda não existem (dedupe_key único).
  for (let i = 0; i < messages.length; i += 200) {
    const { data, error } = await supabase
      .from("assistant_messages")
      .upsert(messages.slice(i, i + 200), {
        onConflict: "dedupe_key",
        ignoreDuplicates: true,
      })
      .select("id");

    if (error) throw new Error(`Erro ao criar mensagens: ${error.message}`);
    result.created += data?.length ?? 0;
  }

  return result;
}
