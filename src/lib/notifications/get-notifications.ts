"use server";

import { cookies } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";

import {
  getUpcomingReceipts,
  getUpcomingRenewals,
} from "@/app/(dashboard)/vencimentos/action";

export type NotificationItem = {
  id: string;
  type: "task" | "receipt" | "renewal";
  title: string;
  subtitle: string;
  href: string;
};

export async function getNotifications(): Promise<NotificationItem[]> {
  const profile = await getCurrentProfile();

  if (!profile) {
    return [];
  }

  const canAccessAllStores =
    profile.role === "OWNER" || profile.role === "ADMIN";

  const cookieStore = await cookies();

  const cookieStoreId =
    cookieStore.get("selected_store_id")?.value ?? "all";

  const selectedStoreId = canAccessAllStores
    ? cookieStoreId
    : profile.store?.id ?? null;

  const storeId =
    selectedStoreId && selectedStoreId !== "all" ? selectedStoreId : null;

  const admin = createAdminClient();

  const [tasksResult, receipts, renewals] = await Promise.all([
    admin
      .from("tasks")
      .select("id, title, due_at")
      .eq("assigned_user_id", profile.id)
      .not("status", "in", "(COMPLETED,CANCELLED)")
      .not("due_at", "is", null)
      .lt("due_at", new Date().toISOString())
      .order("due_at", { ascending: true })
      .limit(5),

    getUpcomingReceipts({ storeId }),
    getUpcomingRenewals({ storeId }),
  ]);

  const notifications: NotificationItem[] = [];

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