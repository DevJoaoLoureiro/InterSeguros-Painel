import {
  getSelectedStoreFilter,
} from "@/lib/auth/store-selection";

import {
  getCurrentProfile,
} from "@/lib/auth/get-current-profile";

import {
  createAdminClient,
} from "@/lib/supabase/admin";

export async function getAiUserContext() {
  const profile =
    await getCurrentProfile();

  if (!profile) {
    throw new Error(
      "Utilizador não autenticado.",
    );
  }

  const canAccessAllStores =
    profile.role === "OWNER" ||
    profile.role === "ADMIN";

  // Loja = filtro do seletor do topo, igual para todos (sem
  // restrição por loja). O acesso aos dados é decidido pela função:
  // ver getAiToolsForRole no agente.
  const storeId =
    await getSelectedStoreFilter();

  const today =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Europe/Lisbon",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      },
    ).format(new Date());

  return {
    userId:
      profile.id,

    fullName:
      profile.full_name,

    role:
      profile.role,

    storeId,

    canAccessAllStores,

    today,

    supabase:
      createAdminClient(),
  };
}

export type AiUserContext =
  Awaited<
    ReturnType<
      typeof getAiUserContext
    >
  >;