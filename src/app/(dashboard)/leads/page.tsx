import { LeadsPage } from "@/components/leads/leads-page";
import { createClient } from "@/lib/supabase/server";
import type { Lead } from "@/types/lead";

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
    .select("role")
    .eq("id", user.id)
    .single();

  const currentUserRole =
    currentProfile?.role ?? null;

  const [
    leadsResult,
    storesResult,
    commercialsResult,
  ] = await Promise.all([
    supabase
      .from("leads")
      .select("*")
      .order("created_at", {
        ascending: false,
      }),

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


    console.log("=== DEBUG LEADS ===");
console.log("STORES:", stores);
console.log("COMMERCIALS:", commercials);
console.log("===================");

  return (
    <LeadsPage
      leads={leads}
      stores={stores}
      commercials={commercials}
      currentUserRole={currentUserRole}
    />
  );
}