"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getAlertScope,
  getVencimentosSnapshot,
} from "@/lib/alerts/expiry-alerts";
import { describeSyncAge, getSyncProblems } from "@/lib/alerts/sync-health";

export type NotificationItem = {
  id: string;
  type: "task" | "receipt" | "renewal" | "sync";
  title: string;
  subtitle: string;
  href: string;
};

export async function getNotifications(): Promise<NotificationItem[]> {
  const scope = await getAlertScope();

  if (!scope) {
    return [];
  }

  const { profile, privileged, storeId } = scope;

  const admin = createAdminClient();

  const [tasksResult, { receipts, renewals }, syncProblems] = await Promise.all([
    admin
      .from("tasks")
      .select("id, title, due_at")
      .eq("assigned_user_id", profile.id)
      .not("status", "in", "(COMPLETED,CANCELLED)")
      .not("due_at", "is", null)
      .lt("due_at", new Date().toISOString())
      .order("due_at", { ascending: true })
      .limit(5),

    // Partilhado com os alertas de vencimento no mesmo pedido.
    getVencimentosSnapshot(storeId),

    // Sync parado: só interessa a quem o pode resolver.
    privileged ? getSyncProblems() : Promise.resolve([]),
  ]);

  const notifications: NotificationItem[] = [];

  // ----------------------------------------
  // SINCRONIZAÇÃO PARADA (primeiro: afeta tudo o resto)
  // ----------------------------------------

  for (const problem of syncProblems) {
    notifications.push({
      id: `sync-${problem.companyCode}`,
      type: "sync",
      title: `Sincronização ${problem.companyName} parada`,
      subtitle: `${problem.resources.join(" e ")} ${describeSyncAge(problem)}`,
      href: "/dashboard",
    });
  }

  // ----------------------------------------
  // TAREFAS ATRASADAS
  // ----------------------------------------

  for (const task of tasksResult.data ?? []) {
    notifications.push({
      id: `task-${task.id}`,
      type: "task",
      title: task.title,
      subtitle: "Tarefa atrasada",
      href: "/tarefas",
    });
  }

  // ----------------------------------------
  // RECIBOS ATRASADOS
  // ----------------------------------------

  const overdueReceipts = receipts.filter((r) => r.overdue).slice(0, 5);

  for (const receipt of overdueReceipts) {
    notifications.push({
      id: `receipt-${receipt.receiptId}`,
      type: "receipt",
      title: receipt.clientName,
      subtitle: `Recibo ${receipt.receiptNumber ?? ""} em atraso`,
      href: "/vencimentos",
    });
  }

  // ----------------------------------------
  // RENOVAÇÕES ATRASADAS
  // ----------------------------------------

  const overdueRenewals = renewals.filter((r) => r.overdue).slice(0, 5);

  for (const renewal of overdueRenewals) {
    notifications.push({
      id: `renewal-${renewal.policyId}`,
      type: "renewal",
      title: renewal.clientName,
      subtitle: `Apólice ${renewal.policyNumber} por renovar`,
      href: "/vencimentos",
    });
  }

  return notifications.slice(0, 10);
}
