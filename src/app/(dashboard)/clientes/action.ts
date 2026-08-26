"use server";

import {
  createAdminClient,
} from "@/lib/supabase/admin";

import type {
  ClientRow,
  PolicyRow,
  ProfileRow,
  PortfolioClient,
  PortfolioSearchRow,
  PortfolioFilters,
} from "../../../components/clientes/types";

import {
  CLIENTS_PAGE_SIZE,
} from "../../../components/clientes/types";

function toNullable(
  value: string,
) {
  return value.trim()
    ? value.trim()
    : null;
}

export async function getClientsPortfolioData(
  filters: PortfolioFilters,
) {
  const admin =
    createAdminClient();

  const storeId =
    filters.storeId;

  const search = toNullable(
    filters.search,
  );

  const from = toNullable(
    filters.from,
  );

  const to = toNullable(
    filters.to,
  );

  const company = toNullable(
    filters.company,
  );

  const responsible =
    toNullable(
      filters.responsible,
    );

  const page = Math.max(
    1,
    filters.page,
  );

  const {
    data: statsRows,
    error: statsError,
  } = await admin.rpc(
    "get_portfolio_stats",
    {
      p_store_id: storeId,
      p_search: search,
      p_from: from,
      p_to: to,
      p_company: company,
      p_responsible: responsible,
    },
  );

  if (statsError) {
    throw new Error(
      `Erro ao calcular estatísticas: ${statsError.message}`,
    );
  }

  const stats = statsRows?.[0] ?? {
    client_count: 0,
    policy_count: 0,
    policies_today: 0,
    total_premium: 0,
  };

  const {
    data: pageRows,
    error: pageError,
  } = await admin.rpc(
    "search_portfolio_clients",
    {
      p_store_id: storeId,
      p_search: search,
      p_from: from,
      p_to: to,
      p_company: company,
      p_responsible: responsible,
      p_sort: filters.sort,
      p_limit: CLIENTS_PAGE_SIZE,
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

  const rows = (
    pageRows ?? []
  ) as PortfolioSearchRow[];

  const orderedClientIds = rows.map(
    (row) => row.client_id,
  );

  const totalCount =
    rows[0]?.total_count ?? 0;

  const totalPages = Math.max(
    1,
    Math.ceil(
      totalCount /
        CLIENTS_PAGE_SIZE,
    ),
  );

  if (orderedClientIds.length === 0) {
    const [
      companiesResult,
      profilesResult,
    ] = await Promise.all([
      admin.rpc(
        "get_portfolio_companies",
        { p_store_id: storeId },
      ),
      admin
        .from("profiles")
        .select(
          "id, full_name, store_id",
        )
        .order("full_name", {
          ascending: true,
        }),
    ]);

    return {
      stats,
      items: [] as PortfolioClient[],
      page,
      totalPages,
      totalCount,
      companies: (
        companiesResult.data ?? []
      ).map(
        (row: {
          company_name: string;
        }) => row.company_name,
      ),
      profiles:
        (profilesResult.data ??
          []) as ProfileRow[],
    };
  }

  let policiesQuery = admin
    .from("policies")
    .select("*")
    .in(
      "client_id",
      orderedClientIds,
    )
    .order("issue_date", {
      ascending: false,
    });

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
      { p_store_id: storeId },
    ),

    admin
      .from("profiles")
      .select(
        "id, full_name, store_id",
      )
      .order("full_name", {
        ascending: true,
      }),
  ]);

  if (clientsResult.error) {
    throw new Error(
      `Erro ao carregar clientes: ${clientsResult.error.message}`,
    );
  }

  if (policiesResult.error) {
    throw new Error(
      `Erro ao carregar apólices: ${policiesResult.error.message}`,
    );
  }

  const clientsById = new Map(
    (
      (clientsResult.data ??
        []) as ClientRow[]
    ).map((client) => [
      client.id,
      client,
    ]),
  );

const policiesByClient = new Map<string, PolicyRow[]>();

  for (const policy of (policiesResult.data ??
    []) as PolicyRow[]) {
    const current =
      policiesByClient.get(
        policy.client_id,
      ) ?? [];

    current.push(policy);

    policiesByClient.set(
      policy.client_id,
      current,
    );
  }

  const items: PortfolioClient[] =
    orderedClientIds
      .map((id) => {
        const client =
          clientsById.get(id);

        if (!client) {
          return null;
        }

        return {
          client,
          policies:
            policiesByClient.get(
              id,
            ) ?? [],
        };
      })
      .filter(
        (
          item,
        ): item is PortfolioClient =>
          item !== null,
      );

  return {
    stats,
    items,
    page,
    totalPages,
    totalCount,
    companies: (
      companiesResult.data ?? []
    ).map(
      (row: {
        company_name: string;
      }) => row.company_name,
    ),
    profiles:
      (profilesResult.data ??
        []) as ProfileRow[],
  };
}