"use server";

import { unstable_cache } from "next/cache";
import { cookies } from "next/headers";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";

import type {
  ClientsPortfolioData,
  CompanySummary,
  PolicyRow,
  PortfolioClient,
  PortfolioFilters,
  ProfileRow,
} from "@/components/clientes/types";

const CLIENTS_PAGE_SIZE = 10;
const METADATA_REVALIDATE_SECONDS = 300;

const EMPTY_STATS = {
  client_count: 0,
  policy_count: 0,
  active_policy_count: 0,
  annualized_premium: 0,
};

type PortfolioStats = typeof EMPTY_STATS;

type PortfolioRpcRow = {
  client_id: string;
  client_name: string;
  client_nif: string | null;
  client_email: string | null;
  client_phone: string | null;
  client_city: string | null;
  policies: PolicyJson[] | null;
  total_count: number | string;
};

type PolicyJson = {
  id: string;
  policy_number: string;
  product_name: string | null;
  status: PolicyRow["status"];
  issue_date: string | null;
  start_date: string | null;
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

function toNullable(value?: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function toFiniteNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

const getPortfolioMetadata = unstable_cache(
  async (): Promise<{
    companies: CompanySummary[];
    profiles: ProfileRow[];
  }> => {
    const admin = createAdminClient();

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

    return {
      companies: (companiesResult.data ?? []) as CompanySummary[],
      profiles: (profilesResult.data ?? []) as ProfileRow[],
    };
  },
  ["clients-portfolio-metadata-v1"],
  {
    revalidate: METADATA_REVALIDATE_SECONDS,
    tags: ["clients-portfolio-metadata"],
  },
);

function mapPolicy(raw: PolicyJson, clientId: string): PolicyRow {
  return {
    id: raw.id,
    client_id: clientId,
    external_id: null,
    start_date: raw.start_date ?? null,
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
    commercial_premium: toFiniteNumber(raw.commercial_premium),
    total_premium: toFiniteNumber(raw.total_premium),
    annualized_premium: toFiniteNumber(raw.annualized_premium),
    latest_receipt: raw.latest_receipt
      ? {
          id: raw.latest_receipt.id,
          receipt_number: raw.latest_receipt.receipt_number,
          due_date: raw.latest_receipt.due_date,
          commercial_premium: toFiniteNumber(
            raw.latest_receipt.commercial_premium,
          ),
          total_premium: toFiniteNumber(raw.latest_receipt.total_premium),
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
          plan_type: raw.insurance_line.plan_type as
            | "VIDA"
            | "NAO_VIDA"
            | "FINANCEIROS",
        }
      : null,
    commercial_user: raw.commercial_user,
    issuing_store: raw.issuing_store,
  };
}

function mapPortfolioRows(rows: PortfolioRpcRow[]): PortfolioClient[] {
  return rows.map((row) => ({
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
    policies: (row.policies ?? []).map((policy) =>
      mapPolicy(policy, row.client_id),
    ),
    opportunity: {
      hasOpportunity: false,
      count: 0,
      score: null,
      level: null,
      targetLine: null,
      reason: null,
    },
  }));
}

export async function getClientsPortfolioData(
  filters: PortfolioFilters,
): Promise<ClientsPortfolioData> {
  const [profile, cookieStore] = await Promise.all([
    getCurrentProfile(),
    cookies(),
  ]);

  if (!profile) throw new Error("Não autenticado.");

  const canAccessAllStores =
    profile.role === "OWNER" || profile.role === "ADMIN";
  const cookieStoreId = cookieStore.get("selected_store_id")?.value ?? "all";
  const selectedStoreId = canAccessAllStores
    ? cookieStoreId
    : profile.store?.id ?? null;

  if (!canAccessAllStores && !selectedStoreId) {
    throw new Error("O utilizador não tem uma loja associada.");
  }

  const storeId =
    selectedStoreId && selectedStoreId !== "all" ? selectedStoreId : null;
  const search = toNullable(filters.search);
  const from = toNullable(filters.from);
  const to = toNullable(filters.to);
  const company = toNullable(filters.company);
  const responsible = toNullable(filters.responsible);
  const requestedPage = Math.max(1, Math.trunc(filters.page) || 1);
  const requestedOffset = (requestedPage - 1) * CLIENTS_PAGE_SIZE;
  const metadataPromise = getPortfolioMetadata();
  const admin = createAdminClient();

  // IDs podem seguir imediatamente para as RPCs. Nome/código precisa primeiro
  // de ser resolvido através dos metadados.
  let companyId: string | null = company && isUuid(company) ? company : null;
  let metadata: Awaited<ReturnType<typeof getPortfolioMetadata>> | null = null;

  if (company && !companyId) {
    metadata = await metadataPromise;
    const selectedCompany = metadata.companies.find(
      (item) =>
        item.id === company || item.code === company || item.name === company,
    );

    if (!selectedCompany) {
      return {
        stats: { ...EMPTY_STATS },
        items: [],
        page: 1,
        totalPages: 1,
        totalCount: 0,
        ...metadata,
      };
    }

    companyId = selectedCompany.id;
  }

  const rpcParams = {
    p_store_id: storeId,
    p_company_id: companyId,
    p_responsible: responsible,
    p_from: from,
    p_to: to,
    p_search: search,
  };

  const [statsResult, firstRowsResult, resolvedMetadata] = await Promise.all([
    admin.rpc("get_clients_portfolio_stats", rpcParams),
    admin.rpc("search_clients_portfolio", {
      ...rpcParams,
      p_sort: filters.sort,
      p_limit: CLIENTS_PAGE_SIZE,
      p_offset: requestedOffset,
    }),
    metadata ? Promise.resolve(metadata) : metadataPromise,
  ]);

  if (statsResult.error) {
    throw new Error(
      `Erro ao calcular estatísticas: ${statsResult.error.message}`,
    );
  }

  if (firstRowsResult.error) {
    throw new Error(
      `Erro ao carregar clientes: ${firstRowsResult.error.message}`,
    );
  }

  const stats = (statsResult.data?.[0] ?? {
    ...EMPTY_STATS,
  }) as PortfolioStats;
  let rows = (firstRowsResult.data ?? []) as PortfolioRpcRow[];
  let totalCount = rows.length > 0 ? Number(rows[0].total_count) : 0;

  // Uma página vazia depois da primeira não traz total_count. Consulta apenas
  // o primeiro registo para recuperar o total e corrigir o número da página.
  if (rows.length === 0 && requestedPage > 1) {
    const countProbe = await admin.rpc("search_clients_portfolio", {
      ...rpcParams,
      p_sort: filters.sort,
      p_limit: 1,
      p_offset: 0,
    });

    if (countProbe.error) {
      throw new Error(`Erro ao validar a página: ${countProbe.error.message}`);
    }

    const probeRows = (countProbe.data ?? []) as PortfolioRpcRow[];
    totalCount = probeRows.length > 0 ? Number(probeRows[0].total_count) : 0;

    const lastPage = Math.max(1, Math.ceil(totalCount / CLIENTS_PAGE_SIZE));

    if (totalCount > 0 && requestedPage > lastPage) {
      const correctedRowsResult = await admin.rpc("search_clients_portfolio", {
        ...rpcParams,
        p_sort: filters.sort,
        p_limit: CLIENTS_PAGE_SIZE,
        p_offset: (lastPage - 1) * CLIENTS_PAGE_SIZE,
      });

      if (correctedRowsResult.error) {
        throw new Error(
          `Erro ao carregar clientes: ${correctedRowsResult.error.message}`,
        );
      }

      rows = (correctedRowsResult.data ?? []) as PortfolioRpcRow[];
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / CLIENTS_PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  return {
    stats,
    items: mapPortfolioRows(rows),
    page,
    totalPages,
    totalCount,
    companies: resolvedMetadata.companies,
    profiles: resolvedMetadata.profiles,
  };
}


export async function assignCurrentUserToPolicy(
  policyId: string,
): Promise<{
  success: true;
  commercialUser: { id: string; full_name: string };
  issuingStore: { id: string; name: string } | null;
}> {
  const profile = await getCurrentProfile();

  if (!profile) throw new Error("Não autenticado.");
  if (!policyId) throw new Error("Apólice inválida.");

  const admin = createAdminClient();
  const { data: policy, error: policyError } = await admin
    .from("policies")
    .select("id, issuing_store_id, commercial_user_id")
    .eq("id", policyId)
    .maybeSingle();

  if (policyError) {
    throw new Error(`Erro ao carregar apólice: ${policyError.message}`);
  }

  if (!policy) throw new Error("Apólice não encontrada.");

  const canAccessAllStores =
    profile.role === "OWNER" || profile.role === "ADMIN";

  const profileStoreId = profile.store?.id ?? null;

  if (!canAccessAllStores) {
    if (!profileStoreId) {
      throw new Error("O utilizador não tem uma loja associada.");
    }

    // Se a apólice JÁ tem loja definida (ex: veio da Prévoir, cuja
    // API já permite resolver a loja automaticamente), só deixamos
    // associar quem for dessa loja — comportamento inalterado.
    //
    // Se a apólice AINDA NÃO tem loja (ex: Zurich, cuja API não dá
    // essa informação de forma alguma), não há loja "errada" para
    // comparar — a loja da apólice passa a ser a do comercial que
    // se associar agora (ver mais abaixo).
    if (
      policy.issuing_store_id &&
      policy.issuing_store_id !== profileStoreId
    ) {
      throw new Error(
        "Não tens permissão para te associares a uma apólice de outra loja.",
      );
    }
  }

  if (
    policy.commercial_user_id &&
    policy.commercial_user_id !== profile.id
  ) {
    throw new Error("Esta apólice já está associada a outro comercial.");
  }

  let issuingStore: { id: string; name: string } | null = null;

  if (policy.commercial_user_id !== profile.id) {
    const updatePayload: Record<string, unknown> = {
      commercial_user_id: profile.id,
    };

    // Preenche a loja automaticamente quando a apólice ainda não
    // tem nenhuma (caso típico da Zurich) — a loja do comercial
    // que se associa passa a ser também a loja da apólice.
    if (!policy.issuing_store_id && profileStoreId) {
      updatePayload.issuing_store_id = profileStoreId;

      const { data: storeRow } = await admin
        .from("stores")
        .select("id, name")
        .eq("id", profileStoreId)
        .maybeSingle();

      issuingStore = storeRow ?? null;
    }

    // A condição adicional (.is("commercial_user_id", null)) evita
    // sobrescrever uma associação concorrente feita depois da
    // leitura acima.
    const { data: updatedPolicy, error: updateError } = await admin
      .from("policies")
      .update(updatePayload)
      .eq("id", policy.id)
      .is("commercial_user_id", null)
      .select("id")
      .maybeSingle();

    if (updateError) {
      throw new Error(`Erro ao associar apólice: ${updateError.message}`);
    }

    if (!updatedPolicy) {
      throw new Error(
        "A apólice foi associada a outro comercial entretanto. Atualiza a página.",
      );
    }
  }

  return {
    success: true,
    commercialUser: {
      id: profile.id,
      full_name: profile.full_name,
    },
    // null aqui não significa "sem loja" — significa "não mudou
    // nesta chamada" (ou porque já tinha loja, ou porque não havia
    // profileStoreId para preencher). O frontend só deve atualizar
    // o que mostra quando isto vier preenchido.
    issuingStore,
  };
}