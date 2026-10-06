import ClientsList from "@/components/clientes/client-list";

import {
  getClientsPortfolioData,
} from "@/app/(dashboard)/clientes/action";
import { requireProfile } from "@/lib/auth/access";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PortfolioClient } from "@/components/clientes/types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * ?cliente=<id> (vindo do Dashboard, Vencimentos, alertas…): abre a
 * página já com o painel desse cliente. Carregado à parte porque o
 * cliente pode não estar na página/filtros atuais da lista. O painel
 * carrega o resto (apólices, recibos…) sozinho.
 */
async function loadClientToOpen(
  clientId: string | undefined,
): Promise<PortfolioClient | null> {
  if (!clientId || !UUID_PATTERN.test(clientId)) return null;

  await requireProfile();

  const { data } = await createAdminClient()
    .from("clients")
    .select(
      "id, name, nif, email, phone, birth_date, street, postal_code, city, country, created_at, updated_at",
    )
    .eq("id", clientId)
    .maybeSingle();

  if (!data) return null;

  return {
    client: data,
    policies: [],
    opportunity: {
      hasOpportunity: false,
      count: 0,
      score: null,
      level: null,
      targetLine: null,
      reason: null,
    },
  };
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    from?: string;
    to?: string;
    company?: string;
    responsible?: string;
    sort?: string;
    page?: string;
    cliente?: string;
  }>;
}) {
  const params =
    await searchParams;

  const sort:
    | "newest"
    | "oldest" =
    params.sort === "oldest"
      ? "oldest"
      : "newest";

  const page =
    Math.max(
      1,
      Number(
        params.page ?? "1",
      ) || 1,
    );

  const [data, clientToOpen] = await Promise.all([
    getClientsPortfolioData({
     
      search:
        params.q ?? "",

      from:
        params.from ?? "",

      to:
        params.to ?? "",

      company:
        params.company ?? "",

      responsible:
        params.responsible ??
        "",

      sort,

      page,
    }),
    loadClientToOpen(params.cliente),
  ]);

  return (
    <ClientsList
      data={data}
      initialClient={clientToOpen}
      filters={{
        q:
          params.q ?? "",

        from:
          params.from ?? "",

        to:
          params.to ?? "",

        company:
          params.company ?? "",

        responsible:
          params.responsible ??
          "",

        sort,

        page:
          data.page,
      }}
    />
  );
}