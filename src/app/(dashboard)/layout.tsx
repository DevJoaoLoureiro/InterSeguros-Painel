import { redirect } from "next/navigation";

import {
  AppSidebar,
} from "@/components/layout/app-sidebar";

import {
  DashboardHeader,
} from "@/components/layout/dashboard-header";

import {
  getCurrentProfile,
} from "@/lib/auth/get-current-profile";

import { getCachedStores } from "@/lib/cache/reference-data";
import { getSelectedStoreId } from "@/lib/auth/store-selection";

import {
  AssistantProvider,
} from "@/components/ai/assistant-provider";

import AssistantPanel from "@/components/ai/assistant-panel";

import { Suspense } from "react";

import {
  ExpiryAlertsLoader,
  HeaderWithNotifications,
  SidebarWithBadge,
} from "@/components/layout/layout-streams";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // ==========================================
  // PERFIL ATUAL
  // ==========================================

  const profile =
    await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  // ==========================================
  // SUPABASE
  // ==========================================

  // ==========================================
  // LOJAS (cache de referência: o layout corre
  // em todas as páginas, as lojas mudam raramente)
  // ==========================================

  const allStores =
    await getCachedStores();

  // ==========================================
  // LOJA SELECIONADA (filtro, igual para todos)
  // ==========================================
  //
  // Sem restrição por loja: todos podem escolher qualquer loja ou
  // "Todas". O acesso é decidido pela função (proxy + sidebar).

  const availableStores = allStores;
  const selectedStoreId = await getSelectedStoreId();

  // ==========================================
  // NOTIFICAÇÕES + BADGE DE VENCIMENTOS
  // ==========================================
  //
  // Não se esperam aqui: sino, badge e alertas carregam em
  // <Suspense> (layout-streams.tsx) e a página aparece logo.

  const scopedStoreId =
    selectedStoreId === "all" ? null : selectedStoreId;

  // ==========================================
  // LAYOUT
  // ==========================================

  return (
    <AssistantProvider>
      <div className="min-h-dvh w-full overflow-x-clip bg-[#f7f8fc]">
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-[270px] lg:block">
          <Suspense
            fallback={
              <AppSidebar
                profile={profile}
                overdueReceiptsCount={0}
              />
            }
          >
            <SidebarWithBadge
              profile={profile}
              storeId={scopedStoreId}
            />
          </Suspense>
        </aside>

        <div className="min-w-0 max-w-full lg:pl-[270px]">
          <Suspense
            fallback={
              <DashboardHeader
                profile={profile}
                stores={availableStores}
                selectedStoreId={selectedStoreId}
                notifications={[]}
              />
            }
          >
            <HeaderWithNotifications
              profile={profile}
              stores={availableStores}
              selectedStoreId={selectedStoreId}
            />
          </Suspense>

          <main className="min-w-0 max-w-full overflow-x-clip p-3 sm:p-5 lg:p-7">
            {children}
          </main>
        </div>

        {/* ALERTAS DE VENCIMENTO (≤ 5 dias) */}
        <Suspense fallback={null}>
          <ExpiryAlertsLoader userId={profile.id} />
        </Suspense>

        {/* ASSISTENTE GLOBAL */}
        <AssistantPanel />
      </div>
    </AssistantProvider>
  );
}