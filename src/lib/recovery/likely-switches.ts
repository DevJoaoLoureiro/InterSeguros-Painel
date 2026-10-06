import { unstable_cache } from "next/cache";

import { VENCIMENTOS_TAG } from "@/lib/alerts/expiry-alerts";
import { computeExit, type ExitReason } from "@/lib/recovery/lost-clients";
import { first, loadRecoveryData } from "@/lib/recovery/recovery-data";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * "Anuladas" (separador dos Vencimentos): clientes que saíram
 * há pouco e ainda não voltaram — provavelmente foram para outra
 * companhia. É a lista para ligar e tentar renovar.
 *
 * Entra quem:
 * - não renovou: o último recibo pago acabou e o seguinte não
 *   apareceu dentro da tolerância (anual = 1 ano e 1 mês);
 * - teve a apólice terminada ou anulada pela companhia.
 *
 * Sai da lista quando volta (outra apólice ativa do mesmo ramo / a
 * matrícula noutra apólice) ou ao fim de LIKELY_SWITCH_DAYS dias.
 *
 * SEM verificação de acesso (como lib/vencimentos/queries): o ponto
 * de entrada público está em app/(dashboard)/vencimentos/action.ts.
 */

export const LIKELY_SWITCH_DAYS = 180;

export type LikelySwitchRow = {
  policyId: string;
  policyNumber: string;
  clientId: string | null;
  clientName: string;
  clientPhone: string | null;
  companyName: string;
  lineName: string | null;
  annualizedPremium: number | null;
  storeId: string | null;
  storeName: string | null;
  exitDate: string;
  exitReason: ExitReason;
};

function lisbonDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
  }).format(new Date());
}

function daysAgo(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function computeLikelySwitches(
  storeId: string | null,
): Promise<LikelySwitchRow[]> {
  const supabase = createAdminClient();
  const today = lisbonDateKey();
  const oldest = daysAgo(today, LIKELY_SWITCH_DAYS);

  const [{ policies, receiptsByPolicy, replacedReason }, storesResult] =
    await Promise.all([
      loadRecoveryData(supabase),
      supabase.from("stores").select("id, name"),
    ]);

  const storeMap = new Map(
    (storesResult.data ?? []).map((s) => [s.id as string, s.name as string]),
  );

  const rows: LikelySwitchRow[] = [];

  for (const p of policies) {
    // PENDING = ainda não começou: não há saída a detetar.
    if (p.status === "PENDING") continue;

    // Como nas renovações: a loja escolhida inclui apólices ainda
    // sem loja atribuída.
    if (storeId && p.issuing_store_id && p.issuing_store_id !== storeId) {
      continue;
    }

    const exit = computeExit(p, receiptsByPolicy.get(p.id) ?? [], today);

    if (!exit || exit.exitDate > today || exit.exitDate < oldest) continue;
    if (replacedReason(p)) continue;

    const client = first(p.client);

    rows.push({
      policyId: p.id,
      policyNumber: p.policy_number,
      clientId: client?.id ?? p.client_id ?? null,
      clientName: client?.name ?? "Cliente",
      clientPhone: client?.phone || null,
      companyName: first(p.company)?.name ?? "—",
      lineName: first(p.insurance_line)?.name ?? null,
      annualizedPremium:
        p.annualized_premium === null ? null : Number(p.annualized_premium),
      storeId: p.issuing_store_id,
      storeName: p.issuing_store_id
        ? storeMap.get(p.issuing_store_id) ?? null
        : null,
      exitDate: exit.exitDate,
      exitReason: exit.exitReason,
    });
  }

  // Saídas mais recentes primeiro (as mais fáceis de recuperar).
  return rows.sort((a, b) => b.exitDate.localeCompare(a.exitDate));
}

/*
 * Percorre todas as apólices e recibos, por isso fica em cache por
 * loja; os crons de sync invalidam a tag "vencimentos" no fim.
 */
const getCachedLikelySwitches = unstable_cache(
  async (storeKey: string) =>
    computeLikelySwitches(storeKey === "all" ? null : storeKey),
  ["likely-switches-v1"],
  { revalidate: 600, tags: [VENCIMENTOS_TAG] },
);

export async function getLikelySwitches({
  storeId,
}: {
  storeId: string | null;
}) {
  return getCachedLikelySwitches(storeId ?? "all");
}
