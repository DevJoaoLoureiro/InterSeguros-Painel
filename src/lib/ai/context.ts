import {
  cookies,
} from "next/headers";

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

  const cookieStore =
    await cookies();

  const cookieStoreId =
    cookieStore.get(
      "selected_store_id",
    )?.value ?? "all";

  const selectedStoreId =
    canAccessAllStores
      ? cookieStoreId
      : profile.store?.id ?? null;

  if (
    !canAccessAllStores &&
    !selectedStoreId
  ) {
    throw new Error(
      "O utilizador não tem uma loja associada.",
    );
  }

  const storeId =
    selectedStoreId &&
    selectedStoreId !== "all"
      ? selectedStoreId
      : null;

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