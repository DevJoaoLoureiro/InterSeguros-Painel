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
  ClientsPortfolioData,
  CompanySummary,
  InsuranceLineSummary,
  PolicyRow,
  PortfolioClient,
  PortfolioFilters,
  ProfileRow,
  StoreSummary,
  UserSummary,
} from "@/components/clientes/types";

import {
  CLIENTS_PAGE_SIZE,
} from "@/components/clientes/types";

// ==========================================
// HELPERS
// ==========================================

function toNullable(
  value: string,
) {
  const trimmed =
    value.trim();

  return trimmed
    ? trimmed
    : null;
}

function escapeLike(
  value: string,
) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

function normalizeNumber(
  value:
    | number
    | string
    | null
    | undefined,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return 0;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}

// ==========================================
// RAW POLICY
// ==========================================

type RawPolicyRow = {
  id: string;
  client_id: string;

  external_id: string | null;
  policy_number: string;

  product_code: string | null;
  product_name: string | null;

  status: PolicyRow["status"];

  issue_date: string | null;
  start_date: string | null;
  end_date: string | null;
  renewal_date: string | null;
  cancellation_date: string | null;

  commercial_premium:
    | number
    | string
    | null;

  total_premium:
    | number
    | string
    | null;

  annualized_premium:
    | number
    | string
    | null;

  payment_frequency:
    PolicyRow["payment_frequency"];

  origin: string | null;

  commercial_user_id:
    string | null;

  issued_by_user_id:
    string | null;

  issuing_store_id:
    string | null;

  last_synced_at:
    string | null;

  created_at:
    string;

  company:
    CompanySummary
    | CompanySummary[]
    | null;

  insurance_line:
    InsuranceLineSummary
    | InsuranceLineSummary[]
    | null;

  commercial_user:
    UserSummary
    | UserSummary[]
    | null;

  issuing_store:
    StoreSummary
    | StoreSummary[]
    | null;
};

function firstRelation<T>(
  value:
    | T
    | T[]
    | null
    | undefined,
): T | null {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

function normalizePolicy(
  row: RawPolicyRow,
): PolicyRow {
  return {
    id:
      row.id,

    client_id:
      row.client_id,

    external_id:
      row.external_id,

    policy_number:
      row.policy_number,

    product_code:
      row.product_code,

    product_name:
      row.product_name,

    status:
      row.status,

    issue_date:
      row.issue_date,

    start_date:
      row.start_date,

    end_date:
      row.end_date,

    renewal_date:
      row.renewal_date,

    cancellation_date:
      row.cancellation_date,

    commercial_premium:
      row.commercial_premium === null
        ? null
        : Number(
            row.commercial_premium,
          ),

    total_premium:
      row.total_premium === null
        ? null
        : Number(
            row.total_premium,
          ),

        annualized_premium:
      row.annualized_premium === null
        ? null
        : Number(
            row.annualized_premium,
          ),

    latest_receipt: null,

    payment_frequency:
      row.payment_frequency,



    origin:
      row.origin,

    commercial_user_id:
      row.commercial_user_id,

    issued_by_user_id:
      row.issued_by_user_id,

    issuing_store_id:
      row.issuing_store_id,

    company:
      firstRelation(
        row.company,
      ),

    insurance_line:
      firstRelation(
        row.insurance_line,
      ),

    commercial_user:
      firstRelation(
        row.commercial_user,
      ),

    issuing_store:
      firstRelation(
        row.issuing_store,
      ),

    last_synced_at:
      row.last_synced_at,

    created_at:
      row.created_at,
  };
}

// ==========================================
// PORTFOLIO
// ==========================================

export async function getClientsPortfolioData(
  filters: PortfolioFilters,
): Promise<ClientsPortfolioData> {
  // ========================================
  // UTILIZADOR + LOJA
  // ========================================

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

  // ========================================
  // FILTROS
  // ========================================

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

  const requestedPage =
    Math.max(
      1,
      filters.page,
    );

  const admin =
    createAdminClient();

  // ========================================
  // METADATA
  // ========================================

  const [
    companiesResult,
    profilesResult,
  ] = await Promise.all([
    admin
      .from("companies")
      .select(
        "id, code, name",
      )
      .eq(
        "active",
        true,
      )
      .order(
        "name",
        {
          ascending: true,
        },
      ),

    admin
      .from("profiles")
      .select(
        "id, full_name, store_id, role",
      )
      .eq(
        "active",
        true,
      )
      .order(
        "full_name",
        {
          ascending: true,
        },
      ),
  ]);

  if (companiesResult.error) {
    throw new Error(
      `Erro ao carregar companhias: ${companiesResult.error.message}`,
    );
  }

  if (profilesResult.error) {
    throw new Error(
      `Erro ao carregar utilizadores: ${profilesResult.error.message}`,
    );
  }

  const companies =
    (
      companiesResult.data ??
      []
    ) as CompanySummary[];

  const profiles =
    (
      profilesResult.data ??
      []
    ) as ProfileRow[];

  // ========================================
  // RESOLVER COMPANHIA
  // ========================================

  let companyId:
    string | null = null;

  if (company) {
    const selectedCompany =
      companies.find(
        (item) =>
          item.id === company ||
          item.code === company ||
          item.name === company,
      );

    if (!selectedCompany) {
      return {
        stats: {
          client_count: 0,
          policy_count: 0,
          active_policy_count: 0,
          annualized_premium: 0,
        },

        items: [],

        page: 1,
        totalPages: 1,
        totalCount: 0,

        companies,
        profiles,
      };
    }

    companyId =
      selectedCompany.id;
  }

  // ========================================
  // CARREGAR APÓLICES
  //
  // Nesta V2 usamos as apólices como base
  // da carteira porque os filtros de loja,
  // companhia, comercial e datas pertencem
  // à apólice.
  // ========================================

  let policiesQuery =
    admin
      .from("policies")
      .select(`
        id,
        client_id,
        external_id,
        policy_number,
        product_code,
        product_name,
        status,
        issue_date,
        start_date,
        end_date,
        renewal_date,
        cancellation_date,
        commercial_premium,
        total_premium,
        annualized_premium,
        payment_frequency,
        origin,
        commercial_user_id,
        issued_by_user_id,
        issuing_store_id,
        last_synced_at,
        created_at,
        company:companies (
          id,
          code,
          name
        ),
        insurance_line:insurance_lines (
          id,
          code,
          name,
          plan_type
        ),
        commercial_user:profiles!policies_commercial_user_id_fkey (
          id,
          full_name
        ),
        issuing_store:stores!policies_issuing_store_id_fkey (
          id,
          name
        )
      `);

  if (storeId) {
    policiesQuery =
      policiesQuery.eq(
        "issuing_store_id",
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

  if (companyId) {
    policiesQuery =
      policiesQuery.eq(
        "company_id",
        companyId,
      );
  }

  if (responsible) {
    policiesQuery =
      policiesQuery.eq(
        "commercial_user_id",
        responsible,
      );
  }

  const {
    data: rawPolicies,
    error: policiesError,
  } = await policiesQuery;

  if (policiesError) {
    throw new Error(
      `Erro ao carregar apólices: ${policiesError.message}`,
    );
  }

  const policies =
    (
      rawPolicies ??
      []
    ).map(
      (row) =>
        normalizePolicy(
          row as unknown as RawPolicyRow,
        ),
    );



  // ========================================
  // CLIENTES QUE TÊM APÓLICES NO ÂMBITO
  // ========================================

  const policyClientIds =
    Array.from(
      new Set(
        policies.map(
          (policy) =>
            policy.client_id,
        ),
      ),
    );

  /*
   * Sem filtros de apólice queremos também
   * permitir clientes que ainda não tenham
   * uma apólice.
   *
   * Com filtros de companhia/data/comercial/
   * loja, a carteira passa naturalmente a ser
   * definida pelas apólices filtradas.
   */

  const hasPolicyScopeFilter =
    Boolean(
      storeId ||
      from ||
      to ||
      companyId ||
      responsible,
    );

  let clientsQuery =
    admin
      .from("clients")
      .select(`
        id,
        name,
        nif,
        email,
        phone,
        birth_date,
        street,
        postal_code,
        city,
        country,
        created_at,
        updated_at
      `);

  if (
    hasPolicyScopeFilter
  ) {
    if (
      policyClientIds.length ===
      0
    ) {
      return {
        stats: {
          client_count: 0,
          policy_count: 0,
          active_policy_count: 0,
          annualized_premium: 0,
        },

        items: [],

        page: 1,
        totalPages: 1,
        totalCount: 0,

        companies,
        profiles,
      };
    }

    clientsQuery =
      clientsQuery.in(
        "id",
        policyClientIds,
      );
  }

  // ========================================
  // PESQUISA CLIENTE
  // ========================================

  if (search) {
    const safeSearch =
      escapeLike(
        search,
      );

    /*
     * Nome, NIF, email e telefone são
     * pesquisáveis diretamente em clients.
     *
     * O número de apólice é tratado abaixo
     * através das policies.
     */

    const matchingPolicyClientIds =
      policies
        .filter(
          (policy) =>
            policy.policy_number
              .toLowerCase()
              .includes(
                search.toLowerCase(),
              ),
        )
        .map(
          (policy) =>
            policy.client_id,
        );

    const {
      data: matchingClients,
      error:
        matchingClientsError,
    } = await admin
      .from("clients")
      .select("id")
      .or(
        [
          `name.ilike.%${safeSearch}%`,
          `nif.ilike.%${safeSearch}%`,
          `email.ilike.%${safeSearch}%`,
          `phone.ilike.%${safeSearch}%`,
        ].join(","),
      );

    if (
      matchingClientsError
    ) {
      throw new Error(
        `Erro ao pesquisar clientes: ${matchingClientsError.message}`,
      );
    }

    const searchClientIds =
      Array.from(
        new Set([
          ...(
            matchingClients ??
            []
          ).map(
            (row) =>
              row.id,
          ),

          ...matchingPolicyClientIds,
        ]),
      );

    let allowedIds =
      searchClientIds;

    if (
      hasPolicyScopeFilter
    ) {
      const allowedPolicyIds =
        new Set(
          policyClientIds,
        );

      allowedIds =
        searchClientIds.filter(
          (id) =>
            allowedPolicyIds.has(
              id,
            ),
        );
    }

    if (
      allowedIds.length === 0
    ) {
      return {
        stats: {
          client_count: 0,
          policy_count: 0,
          active_policy_count: 0,
          annualized_premium: 0,
        },

        items: [],

        page: 1,
        totalPages: 1,
        totalCount: 0,

        companies,
        profiles,
      };
    }

    clientsQuery =
      clientsQuery.in(
        "id",
        allowedIds,
      );
  }

  // ========================================
  // CLIENTES
  // ========================================

  const {
    data: rawClients,
    error: clientsError,
  } = await clientsQuery;

  if (clientsError) {
    throw new Error(
      `Erro ao carregar clientes: ${clientsError.message}`,
    );
  }

  const allClients =
    (
      rawClients ??
      []
    ) as ClientRow[];

  // ========================================
  // APÓLICES POR CLIENTE
  // ========================================

  const policiesByClient =
    new Map<
      string,
      PolicyRow[]
    >();

  for (
    const policy
    of policies
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

  // ========================================
  // ORDENAÇÃO
  // ========================================

  const getLatestIssueTime = (
    clientId: string,
  ) => {
    const clientPolicies =
      policiesByClient.get(
        clientId,
      ) ?? [];

    let latest = 0;

    for (
      const policy
      of clientPolicies
    ) {
      if (
        !policy.issue_date
      ) {
        continue;
      }

      const timestamp =
        new Date(
          `${policy.issue_date}T12:00:00`,
        ).getTime();

      if (
        Number.isFinite(
          timestamp,
        ) &&
        timestamp > latest
      ) {
        latest =
          timestamp;
      }
    }

    return latest;
  };

  const sortedClients =
    [...allClients].sort(
      (a, b) => {
        const aDate =
          getLatestIssueTime(
            a.id,
          );

        const bDate =
          getLatestIssueTime(
            b.id,
          );

        if (
          aDate !== bDate
        ) {
          return filters.sort ===
            "oldest"
            ? aDate - bDate
            : bDate - aDate;
        }

        return a.name.localeCompare(
          b.name,
          "pt",
          {
            sensitivity:
              "base",
          },
        );
      },
    );

  // ========================================
  // ESTATÍSTICAS
  // ========================================

  const visibleClientIds =
    new Set(
      sortedClients.map(
        (client) =>
          client.id,
      ),
    );

  const visiblePolicies =
    policies.filter(
      (policy) =>
        visibleClientIds.has(
          policy.client_id,
        ),
    );

  const activePolicies =
    visiblePolicies.filter(
      (policy) =>
        policy.status ===
        "ACTIVE",
    );

  const annualizedPremium =
    activePolicies.reduce(
      (
        total,
        policy,
      ) =>
        total +
        normalizeNumber(
          policy.annualized_premium,
        ),
      0,
    );

  const stats = {
    client_count:
      sortedClients.length,

    policy_count:
      visiblePolicies.length,

    active_policy_count:
      activePolicies.length,

    annualized_premium:
      annualizedPremium,
  };

  // ========================================
  // PAGINAÇÃO
  // ========================================

  const totalCount =
    sortedClients.length;

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        totalCount /
          CLIENTS_PAGE_SIZE,
      ),
    );

  const page =
    Math.min(
      requestedPage,
      totalPages,
    );

  const offset =
    (page - 1) *
    CLIENTS_PAGE_SIZE;

  const pageClients =
    sortedClients.slice(
      offset,
      offset +
        CLIENTS_PAGE_SIZE,
    );


  // ========================================
  // ÚLTIMO RECIBO DAS APÓLICES VISÍVEIS
  // ========================================

  const visiblePagePolicyIds =
    pageClients.flatMap(
      (client) =>
        (
          policiesByClient.get(
            client.id,
          ) ?? []
        ).map(
          (policy) =>
            policy.id,
        ),
    );

  if (
    visiblePagePolicyIds.length > 0
  ) {
    const {
      data: receiptRows,
      error: receiptsError,
    } = await admin
      .from("receipts")
      .select(`
        id,
        policy_id,
        receipt_number,
        receipt_type,
        due_date,
        issue_date,
        commercial_premium,
        total_premium,
        external_nature
      `)
      .in(
        "policy_id",
        visiblePagePolicyIds,
      )
      .order(
        "due_date",
        {
          ascending: false,
        },
      )
      .order(
        "issue_date",
        {
          ascending: false,
        },
      );

    if (receiptsError) {
      throw new Error(
        `Erro ao carregar recibos das apólices visíveis: ${receiptsError.message}`,
      );
    }

    type VisibleReceiptRow = {
      id: string;
      policy_id: string;
      receipt_number: string | null;
      receipt_type: string | null;
      due_date: string | null;
      issue_date: string | null;

      commercial_premium:
        | number
        | string
        | null;

      total_premium:
        | number
        | string
        | null;

      external_nature:
        string | null;
    };

    const latestReceiptByPolicy =
      new Map<
        string,
        VisibleReceiptRow
      >();

    for (
      const rawReceipt
      of receiptRows ?? []
    ) {
      const receipt =
        rawReceipt as VisibleReceiptRow;

      const receiptType =
        receipt.receipt_type
          ?.trim()
          .toUpperCase() ?? "";

      const isReversal =
        receipt.external_nature ===
          "9" ||
        receiptType === "ESTORNO" ||
        receiptType === "REVERSAL";

      if (isReversal) {
        continue;
      }

      const isPremium =
        receiptType === "PRÉMIO" ||
        receiptType === "PREMIO" ||
        receiptType === "PREMIUM";

      if (!isPremium) {
        continue;
      }

      if (
        latestReceiptByPolicy.has(
          receipt.policy_id,
        )
      ) {
        continue;
      }

      latestReceiptByPolicy.set(
        receipt.policy_id,
        receipt,
      );
    }

    for (const client of pageClients) {
      const clientPolicies =
        policiesByClient.get(
          client.id,
        ) ?? [];

      for (
        const policy
        of clientPolicies
      ) {
        const receipt =
          latestReceiptByPolicy.get(
            policy.id,
          );

        if (!receipt) {
          policy.latest_receipt =
            null;

          continue;
        }

        policy.latest_receipt = {
          id:
            receipt.id,

          receipt_number:
            receipt.receipt_number,

          due_date:
            receipt.due_date,

          commercial_premium:
            receipt
              .commercial_premium ===
            null
              ? null
              : Number(
                  receipt
                    .commercial_premium,
                ),

          total_premium:
            receipt.total_premium ===
            null
              ? null
              : Number(
                  receipt
                    .total_premium,
                ),
        };
      }
    }
  }



  // ========================================
  // RESULTADO DA PÁGINA
  // ========================================

  const items:
    PortfolioClient[] =
    pageClients.map(
      (client) => {
        const clientPolicies =
          [
            ...(
              policiesByClient.get(
                client.id,
              ) ?? []
            ),
          ].sort(
            (a, b) => {
              const aDate =
                a.issue_date
                  ? new Date(
                      `${a.issue_date}T12:00:00`,
                    ).getTime()
                  : 0;

              const bDate =
                b.issue_date
                  ? new Date(
                      `${b.issue_date}T12:00:00`,
                    ).getTime()
                  : 0;

              return filters.sort ===
                "oldest"
                ? aDate - bDate
                : bDate - aDate;
            },
          );

        return {
          client,

          policies:
            clientPolicies,

          /*
           * Reativamos isto depois de adaptar
           * o motor de oportunidades ao schema
           * normalizado V2.
           */
          opportunity: {
            hasOpportunity:
              false,

            count:
              0,

            score:
              null,

            level:
              null,

            targetLine:
              null,

            reason:
              null,
          },
        };
      },
    );

  return {
    stats,

    items,

    page,
    totalPages,
    totalCount,

    companies,
    profiles,
  };
}

// ==========================================
// ASSOCIAR-ME A UMA APÓLICE
// ==========================================

export async function assignCurrentUserToPolicy(
  policyId: string,
): Promise<{
  success: true;
  commercialUser: {
    id: string;
    full_name: string;
  };
}> {
  const profile =
    await getCurrentProfile();

  if (!profile) {
    throw new Error(
      "Não autenticado.",
    );
  }

  const admin =
    createAdminClient();

  // ========================================
  // APÓLICE
  // ========================================

  const {
    data: policy,
    error: policyError,
  } = await admin
    .from("policies")
    .select(`
      id,
      issuing_store_id,
      commercial_user_id
    `)
    .eq(
      "id",
      policyId,
    )
    .maybeSingle();

  if (policyError) {
    throw new Error(
      `Erro ao carregar apólice: ${policyError.message}`,
    );
  }

  if (!policy) {
    throw new Error(
      "Apólice não encontrada.",
    );
  }

  // ========================================
  // PERMISSÕES
  // ========================================

  const canAccessAllStores =
    profile.role === "OWNER" ||
    profile.role === "ADMIN";

  if (!canAccessAllStores) {
    const profileStoreId =
      profile.store?.id ?? null;

    if (!profileStoreId) {
      throw new Error(
        "O utilizador não tem uma loja associada.",
      );
    }

    if (
      policy.issuing_store_id !==
      profileStoreId
    ) {
      throw new Error(
        "Não tens permissão para te associares a uma apólice de outra loja.",
      );
    }
  }

  // ========================================
  // NÃO ROUBAR ASSOCIAÇÕES
  // ========================================

  if (
    policy.commercial_user_id &&
    policy.commercial_user_id !==
      profile.id
  ) {
    throw new Error(
      "Esta apólice já está associada a outro comercial.",
    );
  }

  // ========================================
  // ASSOCIAR
  // ========================================

  if (
    policy.commercial_user_id !==
    profile.id
  ) {
    const {
      error: updateError,
    } = await admin
      .from("policies")
      .update({
        commercial_user_id:
          profile.id,
      })
      .eq(
        "id",
        policy.id,
      );

    if (updateError) {
      throw new Error(
        `Erro ao associar apólice: ${updateError.message}`,
      );
    }
  }

  return {
    success: true,

    commercialUser: {
      id:
        profile.id,

      full_name:
        profile.full_name,
    },
  };
}