"use server";

import { cookies } from "next/headers";
import { unstable_cache } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";

import {
  RECEIPTS_PAGE_SIZE,
  type ReceiptFilters,
  type ReceiptRow,
  type ReceiptsPageData,
  type ReceiptCompany,
} from "@/components/recibos/types";

function toNullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

type SearchReceiptsRow = {
  id: string;
  policy_id: string;
  company_id: string;
  receipt_number: string | null;
  receipt_type: string | null;
  period_start: string | null;
  period_end: string | null;
  issue_date: string | null;
  due_date: string | null;
  commercial_premium: number | string | null;
  total_premium: number | string | null;
  status: string;
  payment_date: string | null;
  payment_method: string | null;
  situation_date: string | null;
  cancellation_date: string | null;
  cancellation_reason: string | null;
  external_nature: string | null;
  external_payment_method: string | null;
  policy_number: string;
  product_code: string | null;
  product_name: string | null;
  client_name: string;
  client_nif: string | null;
  company_code: string;
  company_name: string;
  line_code: string | null;
  line_name: string | null;
  store_id: string | null;
  store_name: string | null;
  total_count: number;
};

type ReceiptsStatsRow = {
  paid_count: number | string | null;
  paid_commercial: number | string | null;
  paid_total: number | string | null;

  pending_count: number | string | null;
  pending_commercial: number | string | null;
  pending_total: number | string | null;

  returned_count: number | string | null;
  returned_commercial: number | string | null;
  returned_total: number | string | null;

  reversals_count: number | string | null;
  reversals_commercial: number | string | null;
  reversals_total: number | string | null;
};

function mapRow(row: SearchReceiptsRow): ReceiptRow {
  return {
    id: row.id,
    policy_id: row.policy_id,
    company_id: row.company_id,

    external_id: null,

    receipt_number: row.receipt_number,
    receipt_type: row.receipt_type,

    period_start: row.period_start,
    period_end: row.period_end,

    issue_date: row.issue_date,
    due_date: row.due_date,

    commercial_premium:
      row.commercial_premium === null
        ? null
        : Number(row.commercial_premium),

    total_premium:
      row.total_premium === null
        ? null
        : Number(row.total_premium),

    status: row.status,

    payment_date: row.payment_date,
    payment_method: row.payment_method,

    situation_date: row.situation_date,

    cancellation_date: row.cancellation_date,
    cancellation_reason: row.cancellation_reason,

    external_nature: row.external_nature,
    external_payment_method: row.external_payment_method,

    company: {
      id: row.company_id,
      code: row.company_code,
      name: row.company_name,
    },

    policy: {
      id: row.policy_id,
      policy_number: row.policy_number,
      product_code: row.product_code,
      product_name: row.product_name,
      issuing_store_id: row.store_id,

      client: {
        id: "",
        name: row.client_name,
        nif: row.client_nif,
      },

      insurance_line: row.line_code
        ? {
            id: "",
            code: row.line_code,
            name: row.line_name ?? row.line_code,
          }
        : null,

      issuing_store: row.store_id
        ? {
            id: row.store_id,
            name: row.store_name ?? "",
          }
        : null,
    },
  };
}

/*
 * Companhias mudam muito pouco.
 *
 * Evitamos ir ao Supabase em cada carregamento da página.
 * Cache de 5 minutos.
 */
const getReceiptCompanies = unstable_cache(
  async (): Promise<ReceiptCompany[]> => {
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("companies")
      .select("id, code, name")
      .eq("active", true)
      .order("name", { ascending: true });

    if (error) {
      throw new Error(
        `Erro ao carregar companhias: ${error.message}`,
      );
    }

    return (data ?? []) as ReceiptCompany[];
  },
  ["receipt-filter-companies"],
  {
    revalidate: 300,
  },
);

export async function getReceiptsData(
  filters: ReceiptFilters,
): Promise<ReceiptsPageData> {
  // ==========================================
  // UTILIZADOR + COOKIE EM PARALELO
  // ==========================================

  const [profile, cookieStore] = await Promise.all([
    getCurrentProfile(),
    cookies(),
  ]);

  if (!profile) {
    throw new Error("Não autenticado.");
  }

  const canAccessAllStores =
    profile.role === "OWNER" ||
    profile.role === "ADMIN";

  const cookieStoreId =
    cookieStore.get("selected_store_id")?.value ??
    "all";

  const selectedStoreId = canAccessAllStores
    ? cookieStoreId
    : profile.store?.id ?? null;

  if (!canAccessAllStores && !selectedStoreId) {
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
  // FILTROS
  // ==========================================

  const search = toNullable(filters.search);
  const from = toNullable(filters.from);
  const to = toNullable(filters.to);
  const company = toNullable(filters.company);
  const status = toNullable(filters.status);

  const requestedPage = Math.max(
    1,
    filters.page,
  );

  const offset =
    (requestedPage - 1) *
    RECEIPTS_PAGE_SIZE;

  // ==========================================
  // COMPANHIAS
  // ==========================================

  const companies =
    await getReceiptCompanies();

  let companyId: string | null = null;

  if (company) {
    const selectedCompany = companies.find(
      (item) =>
        item.id === company ||
        item.code === company ||
        item.name === company,
    );

    /*
     * Antes:
     *
     * company inválida -> null
     * null -> todas as companhias
     *
     * Isso pode devolver resultados errados.
     */
    if (!selectedCompany) {
      return {
        stats: {
          paid: {
            count: 0,
            commercial: 0,
            total: 0,
          },
          pending: {
            count: 0,
            commercial: 0,
            total: 0,
          },
          returned: {
            count: 0,
            commercial: 0,
            total: 0,
          },
          reversals: {
            count: 0,
            commercial: 0,
            total: 0,
          },
        },

        items: [],

        page: 1,
        totalPages: 1,
        totalCount: 0,

        companies,
      };
    }

    companyId = selectedCompany.id;
  }

  const admin = createAdminClient();

  // ==========================================
  // STATS + LISTA AO MESMO TEMPO
  // ==========================================

  const [statsResult, rowsResult] =
    await Promise.all([
      admin.rpc(
        "get_receipts_stats",
        {
          p_store_id: storeId,
          p_company_id: companyId,
          p_from: from,
          p_to: to,
          p_search: search,
        },
      ),

      admin.rpc(
        "search_receipts",
        {
          p_store_id: storeId,
          p_company_id: companyId,
          p_status: status,
          p_from: from,
          p_to: to,
          p_search: search,
          p_limit:
            RECEIPTS_PAGE_SIZE,
          p_offset: offset,
        },
      ),
    ]);

  // ==========================================
  // ERROS
  // ==========================================

  if (statsResult.error) {
    throw new Error(
      `Erro ao calcular estatísticas: ${statsResult.error.message}`,
    );
  }

  if (rowsResult.error) {
    throw new Error(
      `Erro ao carregar recibos: ${rowsResult.error.message}`,
    );
  }

  // ==========================================
  // STATS
  // ==========================================

  const statsRow =
    ((statsResult.data ??
      [])[0] ??
      {}) as Partial<ReceiptsStatsRow>;

  const stats = {
    paid: {
      count: Number(
        statsRow.paid_count ?? 0,
      ),
      commercial: Number(
        statsRow.paid_commercial ?? 0,
      ),
      total: Number(
        statsRow.paid_total ?? 0,
      ),
    },

    pending: {
      count: Number(
        statsRow.pending_count ?? 0,
      ),
      commercial: Number(
        statsRow.pending_commercial ?? 0,
      ),
      total: Number(
        statsRow.pending_total ?? 0,
      ),
    },

    returned: {
      count: Number(
        statsRow.returned_count ?? 0,
      ),
      commercial: Number(
        statsRow.returned_commercial ?? 0,
      ),
      total: Number(
        statsRow.returned_total ?? 0,
      ),
    },

    reversals: {
      count: Number(
        statsRow.reversals_count ?? 0,
      ),
      commercial: Number(
        statsRow.reversals_commercial ?? 0,
      ),
      total: Number(
        statsRow.reversals_total ?? 0,
      ),
    },
  };

  // ==========================================
  // RESULTADOS
  // ==========================================

  const rows =
    (rowsResult.data ??
      []) as SearchReceiptsRow[];

  const totalCount =
    rows.length > 0
      ? Number(rows[0].total_count)
      : 0;

  const totalPages = Math.max(
    1,
    Math.ceil(
      totalCount /
        RECEIPTS_PAGE_SIZE,
    ),
  );

  const page = Math.min(
    requestedPage,
    totalPages,
  );

  return {
    stats,

    items: rows.map(mapRow),

    page,
    totalPages,
    totalCount,

    companies,
  };
}