import { LeadsPage } from "@/components/leads/leads-page";
import { createClient } from "@/lib/supabase/server";
import type { Lead } from "@/types/lead";
import { cookies } from "next/headers";
export default async function Page() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: currentProfile } = await supabase
    .from("profiles")
    .select(`
      id,
      role,
      store_id,
      active
    `)
    .eq("id", user.id)
    .single();

  if (!currentProfile || !currentProfile.active) {
    return null;
  }

  let leadsQuery = supabase
    .from("leads")
    .select("*")
    .order("created_at", {
      ascending: false,
    });

  // COMERCIAL:
  // só vê leads atribuídas diretamente a ele
  if (currentProfile.role === "COMERCIAL") {
    leadsQuery = leadsQuery.eq(
      "assigned_user_id",
      user.id,
    );
  }

  // GESTOR_LOJA:
  // vê todas as leads da sua loja
  if (
    currentProfile.role === "GESTOR_LOJA" &&
    currentProfile.store_id
  ) {
    leadsQuery = leadsQuery.eq(
      "store_id",
      currentProfile.store_id,
    );
  }

  // OWNER e ADMIN:
  // não adicionamos filtro => veem todas

  const [
    leadsResult,
    storesResult,
    commercialsResult,
  ] = await Promise.all([
    leadsQuery,

    supabase
      .from("stores")
      .select("id, name")
      .order("name"),

    supabase
      .from("profiles")
      .select(`
        id,
        full_name,
        store_id,
        role,
        active
      `)
      .eq("role", "COMERCIAL")
      .eq("active", true)
      .order("full_name"),
  ]);

  if (leadsResult.error) {
    console.error(
      "Erro ao carregar leads:",
      leadsResult.error,
    );
  }

  if (storesResult.error) {
    console.error(
      "Erro ao carregar lojas:",
      storesResult.error,
    );
  }

  if (commercialsResult.error) {
    console.error(
      "Erro ao carregar comerciais:",
      commercialsResult.error,
    );
  }

  const leads =
    (leadsResult.data ?? []) as Lead[];

  const stores = storesResult.data ?? [];

  const commercials =
    commercialsResult.data ?? [];

  return (
    <LeadsPage
      leads={leads}
      stores={stores}
      commercials={commercials}
      currentUserRole={currentProfile.role}
    />
  );
}