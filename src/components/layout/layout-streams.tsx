import type { ComponentProps } from "react";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { DashboardHeader } from "@/components/layout/dashboard-header";
import { ExpiryAlertsPopup } from "@/components/alerts/expiry-alerts";

import { getNotifications } from "@/lib/notifications/get-notifications";
import { getExpiryAlerts, getOverdueCount } from "@/lib/alerts/expiry-alerts";
import { getUnseenPartnerSubmissionsCount } from "@/lib/partner-submissions/unseen-count";

/*
 * Partes do layout que dependem de dados "secundários" (sino,
 * badge de vencidos, pop-up de alertas). Cada uma é um Server
 * Component próprio dentro de <Suspense> no layout: a página
 * aparece logo e estas partes preenchem-se quando os dados chegam,
 * em vez de bloquearem tudo.
 */

type SidebarProps = Omit<
  ComponentProps<typeof AppSidebar>,
  "overdueReceiptsCount" | "partnerSubmissionsCount"
>;

export async function SidebarWithBadge({
  storeId,
  userId,
  ...props
}: SidebarProps & { storeId: string | null; userId: string }) {
  const [overdueReceiptsCount, partnerSubmissionsCount] = await Promise.all([
    getOverdueCount(storeId),
    getUnseenPartnerSubmissionsCount(userId),
  ]);

  return (
    <AppSidebar
      {...props}
      overdueReceiptsCount={overdueReceiptsCount}
      partnerSubmissionsCount={partnerSubmissionsCount}
    />
  );
}

type HeaderProps = Omit<
  ComponentProps<typeof DashboardHeader>,
  "notifications"
>;

export async function HeaderWithNotifications(props: HeaderProps) {
  const notifications = await getNotifications();

  return <DashboardHeader {...props} notifications={notifications} />;
}

export async function ExpiryAlertsLoader({ userId }: { userId: string }) {
  const alerts = await getExpiryAlerts();

  return <ExpiryAlertsPopup alerts={alerts} userId={userId} />;
}
