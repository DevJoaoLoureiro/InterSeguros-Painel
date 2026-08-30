"use server";

import { cookies } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";

import {
  RECEIPTS_PAGE_SIZE,
  type ReceiptFilters,
  type ReceiptRow,
  type ReceiptsPageData,
  type ReceiptCompany,
  type ReceiptPolicy,
} from "@/components/recibos/types";

function toNullable(value: string) {
  const trimmed = value.trim();

  return trimmed ? trimmed : null;
}

function normalizeNumber(
  value: number | string | null | undefined,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return 0;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}

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

type RawReceipt = {
  id: string;
  policy_id: string;
  company_id: string;

  external_id: string | null;
  receipt_number: string | null;
  receipt_type: string | null;

  period_start: string | null;
  period_end: string | null;

  issue_date: string | null;
  due_date: string | null;

  commercial_premium:
    | number
    | string
    | null;

  total_premium:
    | number
    | string
    | null;

  status: string;

  payment_date: string | null;
  payment_method: string | null;

  situation_date: string | null;

  cancellation_date: string | null;
  cancellation_reason: string | null;

  external_nature: string | null;
  external_payment_method: string | null;

  company:
    | ReceiptCompany
    | ReceiptCompany[]
    | null;

  policy:
    | ReceiptPolicy
    | ReceiptPolicy[]
    | null;
};

function normalizeReceipt(
  row: RawReceipt,
): ReceiptRow {
  return {
    id: row.id,
    policy_id: row.policy_id,
    company_id: row.company_id,

    external_id: row.external_id,
    receipt_number: row.receipt_number,
    receipt_type: row.receipt_type,

    period_start: row.period_start,
    period_end: row.period_end,

    issue_date: row.issue_date,
    due_date: row.due_date,

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

    status: row.status,

    payment_date: row.payment_date,
    payment_method: row.payment_method,

    situation_date: row.situation_date,

    cancellation_date:
      row.cancellation_date,

    cancellation_reason:
      row.cancellation_reason,

    external_nature:
      row.external_nature,

    external_payment_method:
      row.external_payment_method,

    company:
      firstRelation(row.company),

    policy:
      firstRelation(row.policy),
  };
}

function isReversal(
  receipt: ReceiptRow,
) {
  /*
   * Prévoir:
   * external_nature = "9"
   * representa estorno.
   *
   * Mantemos também suporte para receipt_type
   * caso outros providers normalizem diretamente
   * para REVERSAL / ESTORNO.
   */
  const type =
    receipt.receipt_type
      ?.trim()
      .toUpperCase();

  return (
    receipt.external_nature === "9" ||
    type === "REVERSAL" ||
    type === "ESTORNO"
  );
}

export async function getReceiptsData(
  filters: ReceiptFilters,
): Promise<ReceiptsPageData> {
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
      : profile.store?.id ?? null;

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
  // FILTROS
  // ==========================================

  const search =
    toNullable(filters.search);

  const from =
    toNullable(filters.from);

  const to =
    toNullable(filters.to);

  const company =
    toNullable(filters.company);

  const status =
    toNullable(filters.status);

  const requestedPage =
    Math.max(
      1,
      filters.page,
    );

  const admin =
    createAdminClient();

  // ==========================================
  // COMPANHIAS
  // ==========================================

  const {
    data: companiesData,
    error: companiesError,
  } = await admin
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
    );

  if (companiesError) {
    throw new Error(
      `Erro ao carregar companhias: ${companiesError.message}`,
    );
  }

  const companies =
    (
      companiesData ?? []
    ) as ReceiptCompany[];

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

    if (selectedCompany) {
      companyId =
        selectedCompany.id;
    }
  }

  // ==========================================
  // APÓLICES PERMITIDAS PELA LOJA
  // ==========================================

  let allowedPolicyIds:
    string[] | null = null;

  if (storeId) {
    const {
      data: storePolicies,
      error: storePoliciesError,
    } = await admin
      .from("policies")
      .select("id")
      .eq(
        "issuing_store_id",
        storeId,
      );

    if (storePoliciesError) {
      throw new Error(
        `Erro ao filtrar apólices por loja: ${storePoliciesError.message}`,
      );
    }

    allowedPolicyIds =
      (
        storePolicies ?? []
      ).map(
        (row) => row.id,
      );

    if (
      allowedPolicyIds.length === 0
    ) {
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
  }

  // ==========================================
  // QUERY BASE
  // ==========================================

  const select = `
    id,
    policy_id,
    company_id,
    external_id,
    receipt_number,
    receipt_type,
    period_start,
    period_end,
    issue_date,
    due_date,
    commercial_premium,
    total_premium,
    status,
    payment_date,
    payment_method,
    situation_date,
    cancellation_date,
    cancellation_reason,
    external_nature,
    external_payment_method,

    company:companies (
      id,
      code,
      name
    ),

    policy:policies (
      id,
      policy_number,
      product_code,
      product_name,
      issuing_store_id,

      client:clients (
        id,
        name,
        nif
      ),

      insurance_line:insurance_lines (
        id,
        code,
        name
      ),

      issuing_store:stores!policies_issuing_store_id_fkey (
        id,
        name
      )
    )
  `;

  // ==========================================
  // CARREGAR RECIBOS DO ÂMBITO
  // ==========================================

  let query =
    admin
      .from("receipts")
      .select(select);

  if (allowedPolicyIds) {
    query =
      query.in(
        "policy_id",
        allowedPolicyIds,
      );
  }

  if (companyId) {
    query =
      query.eq(
        "company_id",
        companyId,
      );
  }

  if (from) {
    query =
      query.gte(
        "due_date",
        from,
      );
  }

  if (to) {
    query =
      query.lte(
        "due_date",
        to,
      );
  }

  if (status) {
    query =
      query.eq(
        "status",
        status,
      );
  }

  const {
    data: rawReceipts,
    error: receiptsError,
  } = await query;

  if (receiptsError) {
    throw new Error(
      `Erro ao carregar recibos: ${receiptsError.message}`,
    );
  }

  let receipts =
    (
      rawReceipts ?? []
    ).map(
      (row) =>
        normalizeReceipt(
          row as unknown as RawReceipt,
        ),
    );

  // ==========================================
  // PESQUISA
  // ==========================================

  if (search) {
    const normalizedSearch =
      search
        .trim()
        .toLowerCase();

    receipts =
      receipts.filter(
        (receipt) => {
          const clientName =
            receipt.policy?.client?.name
              ?.toLowerCase() ?? "";

          const nif =
            receipt.policy?.client?.nif
              ?.toLowerCase() ?? "";

          const policyNumber =
            receipt.policy?.policy_number
              ?.toLowerCase() ?? "";

          const receiptNumber =
            receipt.receipt_number
              ?.toLowerCase() ?? "";

          return (
            clientName.includes(
              normalizedSearch,
            ) ||
            nif.includes(
              normalizedSearch,
            ) ||
            policyNumber.includes(
              normalizedSearch,
            ) ||
            receiptNumber.includes(
              normalizedSearch,
            )
          );
        },
      );
  }

  // ==========================================
  // ESTATÍSTICAS
  // ==========================================

  const stats = {
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
  };

  for (const receipt of receipts) {
    const commercial =
      normalizeNumber(
        receipt.commercial_premium,
      );

    const total =
      normalizeNumber(
        receipt.total_premium,
      );

    /*
     * Primeiro identificamos estorno.
     * Assim um estorno com status PAID não entra
     * também no card "Cobrado".
     */
    if (isReversal(receipt)) {
      stats.reversals.count += 1;
      stats.reversals.commercial +=
        commercial;
      stats.reversals.total +=
        total;

      continue;
    }

    switch (receipt.status) {
      case "PAID":
        stats.paid.count += 1;
        stats.paid.commercial +=
          commercial;
        stats.paid.total +=
          total;
        break;

      case "PENDING":
        stats.pending.count += 1;
        stats.pending.commercial +=
          commercial;
        stats.pending.total +=
          total;
        break;

      case "RETURNED":
        stats.returned.count += 1;
        stats.returned.commercial +=
          commercial;
        stats.returned.total +=
          total;
        break;
    }
  }

  // ==========================================
  // ORDENAÇÃO
  // ==========================================

  receipts.sort(
    (a, b) => {
      const aDate =
        a.due_date ??
        a.issue_date ??
        "";

      const bDate =
        b.due_date ??
        b.issue_date ??
        "";

      return bDate.localeCompare(
        aDate,
      );
    },
  );

  // ==========================================
  // PAGINAÇÃO
  // ==========================================

  const totalCount =
    receipts.length;

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        totalCount /
          RECEIPTS_PAGE_SIZE,
      ),
    );

  const page =
    Math.min(
      requestedPage,
      totalPages,
    );

  const offset =
    (page - 1) *
    RECEIPTS_PAGE_SIZE;

  const items =
    receipts.slice(
      offset,
      offset +
        RECEIPTS_PAGE_SIZE,
    );

  return {
    stats,
    items,

    page,
    totalPages,
    totalCount,

    companies,
  };
}