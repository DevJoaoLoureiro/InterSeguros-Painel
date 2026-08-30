"use server";

import { cookies } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";

import type {
  ClientsPortfolioData,
  CompanySummary,
  PolicyRow,
  PortfolioClient,
  PortfolioFilters,
  ProfileRow,
} from "@/components/clientes/types";

function toNullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

type PortfolioRpcRow = {
  client_id: string;
  client_name: string;
  client_nif: string | null;
  client_email: string | null;
  client_phone: string | null;
  client_city: string | null;
  policies: unknown[] | null;
  total_count: number;
};

type PolicyJson = {
  id: string;
  policy_number: string;
  product_name: string | null;
  status: PolicyRow["status"];
  issue_date: string | null;
  renewal_date: string | null;
  annualized_premium: number | string | null;
  commercial_premium: number | string | null;
  total_premium: number | string | null;
  payment_frequency: PolicyRow["payment_frequency"];
  origin: string | null;
  commercial_user_id: string | null;
  issuing_store_id: string | null;
  company: { id: string; code: string; name: string };
  insurance_line: {
    id: string;
    code: string;
    name: string;
    plan_type: string;
  } | null;
  commercial_user: { id: string; full_name: string } | null;
  issuing_store: { id: string; name: string } | null;
  latest_receipt: {
    id: string;
    receipt_number: string | null;
    due_date: string | null;
    commercial_premium: number | string | null;
    total_premium: number | string | null;
  } | null;
};

function mapPolicy(
  raw: PolicyJson,
  clientId: string,
): PolicyRow {
  return {
    id: raw.id,
    client_id: clientId,

    /*
     * Não usados pela UI atual (cards/drawer/tabela).
     * Se algum dia forem precisos, adicionar às
     * funções SQL search_clients_portfolio.
     */
    external_id: null,
    start_date: null,
    end_date: null,
    cancellation_date: null,
    issued_by_user_id: null,
    last_synced_at: null,
    created_at: "",

    policy_number: raw.policy_number,
    product_code: null,
    product_name: raw.product_name,

    status: raw.status,

    issue_date: raw.issue_date,
    renewal_date: raw.renewal_date,

    commercial_premium:
      raw.commercial_premium === null ? null : Number(raw.commercial_premium),

    total_premium:
      raw.total_premium === null ? null : Number(raw.total_premium),

    annualized_premium:
      raw.annualized_premium === null
        ? null
        : Number(raw.annualized_premium),

    latest_receipt: raw.latest_receipt
      ? {
          id: raw.latest_receipt.id,
          receipt_number: raw.latest_receipt.receipt_number,
          due_date: raw.latest_receipt.due_date,
          commercial_premium:
            raw.latest_receipt.commercial_premium === null
              ? null
              : Number(raw.latest_receipt.commercial_premium),
          total_premium:
            raw.latest_receipt.total_premium === null
              ? null
              : Number(raw.latest_receipt.total_premium),
        }
      : null,

    payment_frequency: raw.payment_frequency,

    origin: raw.origin,

    commercial_user_id: raw.commercial_user_id,
    issuing_store_id: raw.issuing_store_id,

    company: raw.company,

    insurance_line: raw.insurance_line
      ? {
          id: raw.insurance_line.id,
          code: raw.insurance_line.code,
          name: raw.insurance_line.name,
          plan_type: raw.insurance_line.plan_type as "VIDA" | "NAO_VIDA" | "FINANCEIROS",
        }
      : null,

    commercial_user: raw.commercial_user,
    issuing_store: raw.issuing_store,
  };
}

export async function getClientsPortfolioData(
  filters: PortfolioFilters,
): Promise<ClientsPortfolioData> {
  // ========================================
  // UTILIZADOR + LOJA
  // ========================================

  const profile = await getCurrentProfile();

  if (!profile) {
    throw new Error("Não autenticado.");
  }

  const canAccessAllStores =
    profile.role === "OWNER" || profile.role === "ADMIN";

  const cookieStore = await cookies();

  const cookieStoreId =
    cookieStore.get("selected_store_id")?.value ?? "all";

  const selectedStoreId = canAccessAllStores
    ? cookieStoreId
    : profile.store?.id ?? null;

  if (!canAccessAllStores && !selectedStoreId) {
    throw new Error("O utilizador não tem uma loja associada.");
  }

  const storeId =
    selectedStoreId && selectedStoreId !== "all" ? selectedStoreId : null;

  // ========================================
  // FILTROS
  // ========================================

  const search = toNullable(filters.search);
  const from = toNullable(filters.from);
  const to = toNullable(filters.to);
  const company = toNullable(filters.company);
  const responsible = toNullable(filters.responsible);

  const requestedPage = Math.max(1, filters.page);

  const admin = createAdminClient();

  // ========================================
  // METADATA (companhias + utilizadores p/ filtros)
  // ========================================

  const [companiesResult, profilesResult] = await Promise.all([
    admin
      .from("companies")
      .select("id, code, name")
      .eq("active", true)
      .order("name", { ascending: true }),

    admin
      .from("profiles")
      .select("id, full_name, store_id, role")
      .eq("active", true)
      .order("full_name", { ascending: true }),
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

  const companies = (companiesResult.data ?? []) as CompanySummary[];
  const profiles = (profilesResult.data ?? []) as ProfileRow[];

  // ========================================
  // RESOLVER COMPANHIA
  // ========================================

  let companyId: string | null = null;

  if (company) {
    const selectedCompany = companies.find(
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

    companyId = selectedCompany.id;
  }

  // ========================================
  // ESTATÍSTICAS (RPC)
  // ========================================

  const { data: statsRows, error: statsError } = await admin.rpc(
    "get_clients_portfolio_stats",
    {
      p_store_id: storeId,
      p_company_id: companyId,
      p_responsible: responsible,
      p_from: from,
      p_to: to,
      p_search: search,
    },
  );

  if (statsError) {
    throw new Error(
      `Erro ao calcular estatísticas: ${statsError.message}`,
    );
  }

  const statsRow = (statsRows as any)?.[0] ?? {};

  const stats = {
    client_count: Number(statsRow.client_count ?? 0),
    policy_count: Number(statsRow.policy_count ?? 0),
    active_policy_count: Number(statsRow.active_policy_count ?? 0),
    annualized_premium: Number(statsRow.annualized_premium ?? 0),
  };

  // ========================================
  // LISTA PAGINADA (RPC)
  // ========================================

  const CLIENTS_PAGE_SIZE = 10;
  const offset = (requestedPage - 1) * CLIENTS_PAGE_SIZE;

  const { data: rowsData, error: rowsError } = await admin.rpc(
    "search_clients_portfolio",
    {
      p_store_id: storeId,
      p_company_id: companyId,
      p_responsible: responsible,
      p_from: from,
      p_to: to,
      p_search: search,
      p_sort: filters.sort,
      p_limit: CLIENTS_PAGE_SIZE,
      p_offset: offset,
    },
  );

  if (rowsError) {
    throw new Error(`Erro ao carregar clientes: ${rowsError.message}`);
  }

  const rows = (rowsData ?? []) as PortfolioRpcRow[];

  const totalCount = rows.length > 0 ? Number(rows[0].total_count) : 0;

  const totalPages = Math.max(
    1,
    Math.ceil(totalCount / CLIENTS_PAGE_SIZE),
  );

  const page = Math.min(requestedPage, totalPages);

  // ========================================
  // MAPEAR RESULTADO
  // ========================================

  const items: PortfolioClient[] = rows.map((row) => {
    const policiesJson = (row.policies ?? []) as PolicyJson[];

    return {
      client: {
        id: row.client_id,
        name: row.client_name,
        nif: row.client_nif,
        email: row.client_email,
        phone: row.client_phone,
        birth_date: null,
        street: null,
        postal_code: null,
        city: row.client_city,
        country: null,
        created_at: "",
        updated_at: "",
      },

      policies: policiesJson.map((p) => mapPolicy(p, row.client_id)),

      /*
       * Reativamos isto depois de adaptar o motor
       * de oportunidades ao schema normalizado V2.
       */
      opportunity: {
        hasOpportunity: false,
        count: 0,
        score: null,
        level: null,
        targetLine: null,
        reason: null,
      },
    };
  });

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
  const profile = await getCurrentProfile();

  if (!profile) {
    throw new Error("Não autenticado.");
  }

  const admin = createAdminClient();

  // ========================================
  // APÓLICE
  // ========================================

  const { data: policy, error: policyError } = await admin
    .from("policies")
    .select(`
      id,
      issuing_store_id,
      commercial_user_id
    `)
    .eq("id", policyId)
    .maybeSingle();

  if (policyError) {
    throw new Error(
      `Erro ao carregar apólice: ${policyError.message}`,
    );
  }

  if (!policy) {
    throw new Error("Apólice não encontrada.");
  }

  // ========================================
  // PERMISSÕES
  // ========================================

  const canAccessAllStores =
    profile.role === "OWNER" || profile.role === "ADMIN";

  if (!canAccessAllStores) {
    const profileStoreId = profile.store?.id ?? null;

    if (!profileStoreId) {
      throw new Error(
        "O utilizador não tem uma loja associada.",
      );
    }

    if (policy.issuing_store_id !== profileStoreId) {
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
    policy.commercial_user_id !== profile.id
  ) {
    throw new Error(
      "Esta apólice já está associada a outro comercial.",
    );
  }

  // ========================================
  // ASSOCIAR
  // ========================================

  if (policy.commercial_user_id !== profile.id) {
    const { error: updateError } = await admin
      .from("policies")
      .update({
        commercial_user_id: profile.id,
      })
      .eq("id", policy.id);

    if (updateError) {
      throw new Error(
        `Erro ao associar apólice: ${updateError.message}`,
      );
    }
  }

  return {
    success: true,
    commercialUser: {
      id: profile.id,
      full_name: profile.full_name,
    },
  };
}