import { cookies } from "next/headers";
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

import {
  createAdminClient,
} from "@/lib/supabase/admin";

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

  const supabase =
    createAdminClient();

  // ==========================================
  // LOJAS
  // ==========================================

  const {
    data: storesData,
    error: storesError,
  } = await supabase
    .from("stores")
    .select(`
      id,
      name,
      code
    `)
    .order("name", {
      ascending: true,
    });

  if (storesError) {
    throw new Error(
      `Erro ao carregar lojas: ${storesError.message}`,
    );
  }

  const allStores =
    storesData ?? [];

  // ==========================================
  // COOKIE DA LOJA SELECIONADA
  // ==========================================

  const cookieStore =
    await cookies();

  const cookieStoreId =
    cookieStore.get(
      "selected_store_id",
    )?.value ?? null;

  // ==========================================
  // LOJAS DISPONÍVEIS POR ROLE
  // ==========================================

// ==========================================
// LOJAS DISPONÍVEIS POR ROLE
// ==========================================

const canAccessAllStores =
  profile.role === "ADMIN" ||
  profile.role === "OWNER";

const availableStores =
  canAccessAllStores
    ? allStores
    : profile.store
      ? [
          {
            id: profile.store.id,
            name: profile.store.name,
            code: profile.store.code,
          },
        ]
      : [];

// ==========================================
// LOJA ATIVA
// ==========================================

let selectedStoreId:
  | string
  | null = null;

if (canAccessAllStores) {
  if (cookieStoreId === "all") {
    selectedStoreId = "all";
  } else {
    const cookieStoreExists =
      cookieStoreId &&
      allStores.some(
        (store) =>
          store.id === cookieStoreId,
      );

    selectedStoreId =
      cookieStoreExists
        ? cookieStoreId
        : "all";
  }
} else {
  selectedStoreId =
    profile.store?.id ?? null;
}

  // ==========================================
  // LAYOUT
  // ==========================================

  return (
    <div className="min-h-dvh w-full overflow-x-clip bg-[#f7f8fc]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[270px] lg:block">
        <AppSidebar
          profile={profile}
        />
      </aside>

      <div className="min-w-0 max-w-full lg:pl-[270px]">
        <DashboardHeader
          profile={profile}
          stores={
            availableStores
          }
          selectedStoreId={
            selectedStoreId
          }
        />

        <main className="min-w-0 max-w-full overflow-x-clip p-3 sm:p-5 lg:p-7">
          {children}
        </main>
      </div>
    </div>
  );
}