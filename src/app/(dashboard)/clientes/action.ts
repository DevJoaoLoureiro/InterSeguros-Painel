"use server";

import {
  cookies,
} from "next/headers";

import {
  createAdminClient,
} from "@/lib/supabase/admin";

import {
  getCurrentProfile,
} from "@/lib/auth/get-current-profile";

import type {
  ClientRow,
  PolicyRow,
  ProfileRow,
  PortfolioClient,
  PortfolioSearchRow,
  PortfolioFilters,
} from "@/components/clientes/types";

import {
  CLIENTS_PAGE_SIZE,
} from "@/components/clientes/types";

import {
  calculateClientOpportunities,
} from "@/lib/opportunities/client-opportunities";

function toNullable(
  value: string,
) {
  const trimmed =
    value.trim();

  return trimmed
    ? trimmed
    : null;
}

export async function getClientsPortfolioData(
  filters: PortfolioFilters,
) {
  // ==========================================
  // UTILIZADOR + LOJA
  // ==========================================

  const profile =
    await getCurrentProfile();

  if (!profile) {
    throw new Error(
      "Não autenticado.",
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
      : profile.store?.id ??
        null;

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

  // ==========================================
  // SUPABASE
  // ==========================================

  const admin =
    createAdminClient();

  // ==========================================
  // FILTROS
  // ==========================================

  const search =
    toNullable(
      filters.search,
    );

  const from =
    toNullable(
      filters.from,
    );

  const to =
    toNullable(
      filters.to,
    );

  const company =
    toNullable(
      filters.company,
    );

  const responsible =
    toNullable(
      filters.responsible,
    );

  const page =
    Math.max(
      1,
      filters.page,
    );

  // ==========================================
  // ESTATÍSTICAS
  // ==========================================

  const {
    data: statsRows,
    error: statsError,
  } = await admin.rpc(
    "get_portfolio_stats",
    {
      p_store_id:
        storeId,

      p_search:
        search,

      p_from:
        from,

      p_to:
        to,

      p_company:
        company,

      p_responsible:
        responsible,
    },
  );

  if (statsError) {
    throw new Error(
      `Erro ao calcular estatísticas: ${statsError.message}`,
    );
  }

  const stats =
    statsRows?.[0] ?? {
      client_count: 0,
      policy_count: 0,
      policies_today: 0,
      total_premium: 0,
    };

  // ==========================================
  // PESQUISA / PAGINAÇÃO
  // ==========================================

  const {
    data: pageRows,
    error: pageError,
  } = await admin.rpc(
    "search_portfolio_clients",
    {
      p_store_id:
        storeId,

      p_search:
        search,

      p_from:
        from,

      p_to:
        to,

      p_company:
        company,

      p_responsible:
        responsible,

      p_sort:
        filters.sort,

      p_limit:
        CLIENTS_PAGE_SIZE,

      p_offset:
        (page - 1) *
        CLIENTS_PAGE_SIZE,
    },
  );

  if (pageError) {
    throw new Error(
      `Erro ao pesquisar clientes: ${pageError.message}`,
    );
  }

  const rows =
    (pageRows ??
      []) as PortfolioSearchRow[];

  const orderedClientIds =
    rows.map(
      (row) =>
        row.client_id,
    );

  const totalCount =
    rows[0]?.total_count ??
    0;

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        totalCount /
          CLIENTS_PAGE_SIZE,
      ),
    );

  // ==========================================
  // SEM RESULTADOS
  // ==========================================

  if (
    orderedClientIds.length ===
    0
  ) {
    const [
      companiesResult,
      profilesResult,
    ] = await Promise.all([
      admin.rpc(
        "get_portfolio_companies",
        {
          p_store_id:
            storeId,
        },
      ),

      admin
        .from("profiles")
        .select(
          "id, full_name, store_id",
        )
        .order(
          "full_name",
          {
            ascending:
              true,
          },
        ),
    ]);

    if (
      companiesResult.error
    ) {
      throw new Error(
        `Erro ao carregar companhias: ${companiesResult.error.message}`,
      );
    }

    if (
      profilesResult.error
    ) {
      throw new Error(
        `Erro ao carregar utilizadores: ${profilesResult.error.message}`,
      );
    }

    return {
      stats,

      items:
        [] as PortfolioClient[],

      page,

      totalPages,

      totalCount,

      companies:
        (
          companiesResult.data ??
          []
        ).map(
          (row: {
            company_name:
              string;
          }) =>
            row.company_name,
        ),

      profiles:
        (
          profilesResult.data ??
          []
        ) as ProfileRow[],
    };
  }

  // ==========================================
  // APÓLICES DA PÁGINA
  // ==========================================

  let policiesQuery =
    admin
      .from("policies")
      .select("*")
      .in(
        "client_id",
        orderedClientIds,
      )
      .order(
        "issue_date",
        {
          ascending:
            filters.sort ===
            "oldest",
        },
      );

  if (storeId) {
    policiesQuery =
      policiesQuery.eq(
        "store_id",
        storeId,
      );
  }

  if (from) {
    policiesQuery =
      policiesQuery.gte(
        "issue_date",
        from,
      );
  }

  if (to) {
    policiesQuery =
      policiesQuery.lte(
        "issue_date",
        to,
      );
  }

  if (company) {
    policiesQuery =
      policiesQuery.eq(
        "company_name",
        company,
      );
  }

  if (responsible) {
    policiesQuery =
      policiesQuery.eq(
        "assigned_user_id",
        responsible,
      );
  }

  // ==========================================
  // CARREGAR DADOS
  // ==========================================

  const [
    clientsResult,
    policiesResult,
    companiesResult,
    profilesResult,
  ] = await Promise.all([
    admin
      .from("clients")
      .select("*")
      .in(
        "id",
        orderedClientIds,
      ),

    policiesQuery,

    admin.rpc(
      "get_portfolio_companies",
      {
        p_store_id:
          storeId,
      },
    ),

    admin
      .from("profiles")
      .select(
        "id, full_name, store_id",
      )
      .order(
        "full_name",
        {
          ascending:
            true,
        },
      ),
  ]);

  if (
    clientsResult.error
  ) {
    throw new Error(
      `Erro ao carregar clientes: ${clientsResult.error.message}`,
    );
  }

  if (
    policiesResult.error
  ) {
    throw new Error(
      `Erro ao carregar apólices: ${policiesResult.error.message}`,
    );
  }

  if (
    companiesResult.error
  ) {
    throw new Error(
      `Erro ao carregar companhias: ${companiesResult.error.message}`,
    );
  }

  if (
    profilesResult.error
  ) {
    throw new Error(
      `Erro ao carregar utilizadores: ${profilesResult.error.message}`,
    );
  }

  // ==========================================
  // MAPA DE CLIENTES
  // ==========================================

  const clientsById =
    new Map(
      (
        (
          clientsResult.data ??
          []
        ) as ClientRow[]
      ).map(
        (client) => [
          client.id,
          client,
        ],
      ),
    );

  // ==========================================
  // APÓLICES POR CLIENTE
  // ==========================================

  const policiesByClient =
    new Map<
      string,
      PolicyRow[]
    >();

  for (
    const policy
    of (
      policiesResult.data ??
      []
    ) as PolicyRow[]
  ) {
    const current =
      policiesByClient.get(
        policy.client_id,
      ) ?? [];

    current.push(
      policy,
    );

    policiesByClient.set(
      policy.client_id,
      current,
    );
  }

  // ==========================================
  // PRESERVAR ORDEM DO RPC
  // ==========================================

 const items: PortfolioClient[] = [];

for (const id of orderedClientIds) {
  const client =
    clientsById.get(id);

  if (!client) {
    continue;
  }

  const policies =
    policiesByClient.get(id) ??
    [];

  const opportunities =
    calculateClientOpportunities(
      policies,
      new Date()
        .toISOString()
        .slice(0, 10),
    );

  const bestOpportunity =
    opportunities[0] ?? null;

  items.push({
    client,

    policies,

    opportunity: {
      hasOpportunity:
        opportunities.length > 0,

      count:
        opportunities.length,

      score:
        bestOpportunity?.score ??
        null,

      level:
        bestOpportunity?.level ??
        null,

      targetLine:
        bestOpportunity?.targetLine ??
        null,

      reason:
        bestOpportunity?.reason ??
        null,
    },
  });
}
  // ==========================================
  // RESULTADO
  // ==========================================

  return {
    stats,

    items,

    page,

    totalPages,

    totalCount,

    companies:
      (
        companiesResult.data ??
        []
      ).map(
        (row: {
          company_name:
            string;
        }) =>
          row.company_name,
      ),

    profiles:
      (
        profilesResult.data ??
        []
      ) as ProfileRow[],
  };
}