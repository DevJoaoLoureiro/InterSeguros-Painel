import { cache } from "react";
import { unstable_cache } from "next/cache";
import { hasFullAccess } from "@/lib/auth/permissions";
import { getSelectedStoreFilter } from "@/lib/auth/store-selection";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";

import {
  getOverdueReceiptsCount,
  getUpcomingReceipts,
  getUpcomingRenewals,
} from "@/lib/vencimentos/queries";

/*
 * Alertas de vencimento: tudo o que vence nos próximos
 * ALERT_DAYS dias (hoje incluído) — renovações de apólices,
 * recibos por cobrar e processos cuja data de início do seguro
 * está a chegar.
 *
 * Embrulhado em cache() para que o layout (pop-up + notificações)
 * e o dashboard (banner) partilhem o mesmo cálculo no mesmo pedido.
 */

export const ALERT_DAYS = 5;

export type ExpiryAlert = {
  id: string;
  type: "renewal" | "receipt" | "process";
  title: string;
  subtitle: string;
  date: string;
  daysLeft: number;
  href: string;
};

function lisbonDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function daysUntil(dateKey: string, todayKey: string) {
  return Math.round(
    (Date.parse(dateKey.slice(0, 10)) - Date.parse(todayKey)) / 86400000,
  );
}

export const getAlertScope = cache(async () => {
  const profile = await getCurrentProfile();

  if (!profile) {
    return null;
  }

  // privileged = OWNER/ADMIN (alertas de processos de toda a equipa).
  // Loja = filtro do seletor do topo, igual para todos.
  const privileged = hasFullAccess(profile.role);
  const storeId = await getSelectedStoreFilter();

  return { profile, privileged, storeId };
});

/*
 * Recibos e renovações da janela de vencimentos.
 *
 * Calcular isto custa ~1,3 s (todas as apólices ativas → função SQL
 * das renovações → clientes/lojas) e corre no layout, ou seja, em
 * TODAS as páginas e ações. Os dados vêm do sync das companhias e
 * mudam pouco, por isso ficam em cache 2 minutos por loja; os crons
 * de sync invalidam a tag "vencimentos" no fim.
 *
 * cache() por cima garante uma só leitura por pedido.
 */
export const VENCIMENTOS_TAG = "vencimentos";

const getCachedVencimentos = unstable_cache(
  async (storeKey: string) => {
    const storeId = storeKey === "all" ? null : storeKey;

    const [receipts, renewals] = await Promise.all([
      getUpcomingReceipts({ storeId }),
      getUpcomingRenewals({ storeId }),
    ]);

    return { receipts, renewals };
  },
  ["vencimentos-snapshot-v1"],
  { revalidate: 120, tags: [VENCIMENTOS_TAG] },
);

export const getVencimentosSnapshot = cache(
  async (storeId: string | null) => getCachedVencimentos(storeId ?? "all"),
);

const getCachedOverdueCount = unstable_cache(
  async (storeKey: string) =>
    getOverdueReceiptsCount({
      storeId: storeKey === "all" ? null : storeKey,
    }),
  ["overdue-receipts-count-v1"],
  { revalidate: 120, tags: [VENCIMENTOS_TAG] },
);

/* Badge de recibos vencidos na sidebar (em cache como o resto). */
export const getOverdueCount = cache(async (storeId: string | null) =>
  getCachedOverdueCount(storeId ?? "all"),
);

export const getExpiryAlerts = cache(async (): Promise<ExpiryAlert[]> => {
  const scope = await getAlertScope();

  if (!scope) {
    return [];
  }

  const { profile, privileged, storeId } = scope;
  const todayKey = lisbonDateKey();

  const limit = new Date(`${todayKey}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + ALERT_DAYS);
  const limitKey = limit.toISOString().slice(0, 10);

  const admin = createAdminClient();

  let processesQuery = admin
    .from("tasks")
    .select("id, title, client_name, policy_start_date")
    .eq("kind", "PROCESS")
    .not("status", "in", "(COMPLETED,CANCELLED)")
    .gte("policy_start_date", todayKey)
    .lte("policy_start_date", limitKey);

  if (!privileged) {
    processesQuery = processesQuery.eq("assigned_user_id", profile.id);
  } else if (storeId) {
    processesQuery = processesQuery.eq("store_id", storeId);
  }

  // Recibos e renovações para todos (funcionários veem Vencimentos de
  // todas as lojas). Os processos: OWNER/ADMIN veem todos, os
  // restantes os seus.
  const [{ receipts, renewals }, processesResult] = await Promise.all([
    getVencimentosSnapshot(storeId),
    processesQuery,
  ]);

  // Se a migração dos processos ainda não correu, os alertas de
  // renovações e recibos continuam a funcionar.
  if (processesResult.error) {
    console.error("[alerts] processos", processesResult.error.message);
  }

  const alerts: ExpiryAlert[] = [];

  for (const renewal of renewals) {
    const daysLeft = daysUntil(renewal.renewalDate, todayKey);
    if (daysLeft < 0 || daysLeft > ALERT_DAYS) continue;

    alerts.push({
      id: `renewal-${renewal.policyId}`,
      type: "renewal",
      title: renewal.clientName,
      subtitle: `Renovação da apólice ${renewal.policyNumber} (${renewal.companyName}${renewal.lineName ? ` · ${renewal.lineName}` : ""})`,
      date: renewal.renewalDate,
      daysLeft,
      href: "/vencimentos",
    });
  }

  for (const receipt of receipts) {
    const daysLeft = daysUntil(receipt.dueDate, todayKey);
    if (daysLeft < 0 || daysLeft > ALERT_DAYS) continue;

    alerts.push({
      id: `receipt-${receipt.receiptId}`,
      type: "receipt",
      title: receipt.clientName,
      subtitle: `Recibo ${receipt.receiptNumber ?? ""} por cobrar · apólice ${receipt.policyNumber} (${receipt.companyName})`,
      date: receipt.dueDate,
      daysLeft,
      href: "/vencimentos",
    });
  }

  for (const process of processesResult.data ?? []) {
    const date = process.policy_start_date as string;

    alerts.push({
      id: `process-${process.id}`,
      type: "process",
      title: process.client_name ?? process.title,
      subtitle: `Início do seguro · ${process.title}`,
      date,
      daysLeft: daysUntil(date, todayKey),
      href: "/tarefas",
    });
  }

  return alerts.sort(
    (a, b) => a.daysLeft - b.daysLeft || a.title.localeCompare(b.title),
  );
});
