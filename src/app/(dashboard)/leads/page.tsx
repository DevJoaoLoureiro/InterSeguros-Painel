import { LeadsPage } from "@/components/leads/leads-page";
import { createClient } from "@/lib/supabase/server";
import type { Lead } from "@/types/lead";
import { getSelectedStoreFilter } from "@/lib/auth/store-selection";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import {
  getCachedActiveProfiles,
  getCachedStores,
} from "@/lib/cache/reference-data";

export default async function Page() {
  // Mesmo perfil que o layout já carregou neste pedido (sem ida ao
  // servidor de Auth nem segunda consulta); null se inativo.
  const currentProfile = await getCurrentProfile();

  if (!currentProfile) {
    return null;
  }

  const supabase = await createClient();

  let leadsQuery = supabase
    .from("leads")
    .select("*")
    .order("created_at", {
      ascending: false,
    });

  // COMERCIAL:
  // só vê leads atribuídas diretamente a ele
  if (currentProfile.role === "COMERCIAL" || currentProfile.role === "GESTOR_COMERCIAL") {
    leadsQuery = leadsQuery.eq(
      "assigned_user_id",
      currentProfile.id,
    );
  }

  // Sem lógica de lojas: a loja é só o filtro escolhido no seletor
  // do topo, igual para todos (GESTOR_LOJA incluído).
  const storeFilter = await getSelectedStoreFilter();

  if (storeFilter) {
    leadsQuery = leadsQuery.eq("store_id", storeFilter);
  }

  // Lojas e utilizadores vêm da cache de referência (5 min).
  const [leadsResult, stores, activeProfiles] = await Promise.all([
    leadsQuery,
    getCachedStores(),
    getCachedActiveProfiles(),
  ]);

  if (leadsResult.error) {
    console.error(
      "Erro ao carregar leads:",
      leadsResult.error,
    );
  }

  const leads =
    (leadsResult.data ?? []) as Lead[];

  const commercials = activeProfiles.filter(
    (p) => p.role === "COMERCIAL" || p.role === "GESTOR_LOJA",
  );

  return (
    <LeadsPage
      leads={leads}
      stores={stores}
      commercials={commercials}
      currentUserRole={currentProfile.role}
    />
  );
}