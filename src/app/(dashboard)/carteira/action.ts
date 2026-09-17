"use server";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";

export type StoreOption = {
  id: string;
  name: string;
};

export type CompanyOverview = {
  id: string;
  code: string;
  name: string;
  totalCount: number;
  totalAnualizado: number;
};

export type ProductBreakdown = {
  productCode: string | null;
  productName: string | null;
  count: number;
  annualizedPremium: number;
};

export type PlanBreakdown = {
  planType: "VIDA" | "NAO_VIDA" | "FINANCEIROS" | "NAO_CLASSIFICADO";
  count: number;
  annualizedPremium: number;
  products: ProductBreakdown[];
};

export type StorePortfolio = {
  storeId: string;
  storeName: string;
  totalCount: number;
  totalAnualizado: number;
  seguroTotal: number;
  plans: PlanBreakdown[];
};

export type YearlyProduction = {
  year: number;
  count: number;
  totalAnualizado: number;
  growthPct: number | null;
};

type RawPolicyRow = {
  id: string;
  product_code: string | null;
  product_name: string | null;
  annualized_premium: number | string | null;
  portfolio_premium: number;
  issue_date: string | null;
  start_date: string | null;
  issuing_store_id: string | null;
  insurance_line: { plan_type: string } | { plan_type: string }[] | null;
};

type ZurichReceiptRow = {
  policy_id: string | null;
  commercial_premium: number | string | null;
  period_end: string | null;
  issue_date: string | null;
  receipt_type: string | null;
  external_nature: string | null;
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/*
 * Inclui tanto as lojas acessíveis como registos sem loja atribuída.
 * `.in()` sozinho não inclui NULL, por isso usamos `.or()`.
 */
function storeOrUnassignedFilter(storeIds: string[]): string {
  const idsList = storeIds.join(",");
  return `issuing_store_id.in.(${idsList}),issuing_store_id.is.null`;
}

function isZurichCompanyCode(code: string | null | undefined): boolean {
  return (code ?? "").trim().toUpperCase() === "ZURICH";
}

function isReversalReceipt(receipt: ZurichReceiptRow): boolean {
  const receiptType = (receipt.receipt_type ?? "").trim().toUpperCase();
  const externalNature = (receipt.external_nature ?? "").trim().toUpperCase();

  return (
    externalNature === "9" ||
    receiptType.includes("ESTORNO") ||
    receiptType.includes("REVERSAL")
  );
}

// ============================================================
// LOJAS ACESSÍVEIS
// ============================================================

export async function getAccessibleStores(): Promise<{
  stores: StoreOption[];
  canAccessAll: boolean;
}> {
  const profile = await getCurrentProfile();

  if (!profile) {
    throw new Error("Não autenticado.");
  }

  const canAccessAll = profile.role === "OWNER" || profile.role === "ADMIN";
  const admin = createAdminClient();

  if (canAccessAll) {
    const { data, error } = await admin
      .from("stores")
      .select("id, name")
      .order("name", { ascending: true });

    if (error) {
      throw new Error(`Erro ao carregar lojas: ${error.message}`);
    }

    return {
      stores: data ?? [],
      canAccessAll: true,
    };
  }

  if (!profile.store) {
    return {
      stores: [],
      canAccessAll: false,
    };
  }

  return {
    stores: [
      {
        id: profile.store.id,
        name: profile.store.name,
      },
    ],
    canAccessAll: false,
  };
}

// ============================================================
// ZURICH — PRÉMIO COMERCIAL DOS RECIBOS
// ============================================================

/*
 * Regra da Carteira para Zurich:
 *
 * - O ficheiro de apólices Zurich não traz PremioComercial.
 * - O ficheiro de recibos traz PremioComercial.
 * - Para cada apólice, usamos o recibo válido mais recente que tenha
 *   commercial_premium preenchido.
 * - Estornos/reversões não são usados como valor da carteira.
 *
 * A ordenação é por period_end e depois issue_date, ambos descendentes.
 * Como percorremos nessa ordem e só guardamos o primeiro recibo válido
 * por policy_id, ficamos com o valor mais recente.
 */
async function getZurichCommercialPremiums(
  policyIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();

  if (policyIds.length === 0) {
    return result;
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("receipts")
    .select(`
      policy_id,
      commercial_premium,
      period_end,
      issue_date,
      receipt_type,
      external_nature
    `)
    .in("policy_id", policyIds)
    .not("commercial_premium", "is", null)
    .order("period_end", { ascending: false })
    .order("issue_date", { ascending: false });

  if (error) {
    throw new Error(
      `Erro ao carregar prémios comerciais Zurich: ${error.message}`,
    );
  }

  const receipts = (data ?? []) as ZurichReceiptRow[];

  for (const receipt of receipts) {
    if (!receipt.policy_id) {
      continue;
    }

    if (result.has(receipt.policy_id)) {
      continue;
    }

    if (isReversalReceipt(receipt)) {
      continue;
    }

    const premium = toNumber(receipt.commercial_premium);

    result.set(receipt.policy_id, premium);
  }

  return result;
}

// ============================================================
// FETCH PARTILHADO DE APÓLICES ATIVAS
// ============================================================

async function fetchActivePolicies(
  storeIds: string[] | null,
  companyId: string,
  knownCompanyCode?: string,
): Promise<RawPolicyRow[]> {
  const admin = createAdminClient();
  const todayKey = new Date().toISOString().slice(0, 10);

  let companyCode = knownCompanyCode;

  if (!companyCode) {
    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("code")
      .eq("id", companyId)
      .maybeSingle();

    if (companyError) {
      throw new Error(
        `Erro ao carregar companhia: ${companyError.message}`,
      );
    }

    if (!company) {
      throw new Error("Companhia não encontrada.");
    }

    companyCode = company.code;
  }

  let query = admin
    .from("policies")
    .select(`
      id,
      product_code,
      product_name,
      annualized_premium,
      issue_date,
      start_date,
      issuing_store_id,
      insurance_line:insurance_lines ( plan_type )
    `)
    .eq("status", "ACTIVE")
    .eq("company_id", companyId)
    .not("start_date", "is", null)
    .lte("start_date", todayKey);

  if (storeIds !== null) {
    if (storeIds.length === 0) {
      return [];
    }

    query = query.or(storeOrUnassignedFilter(storeIds));
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Erro ao carregar carteira: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as Omit<
    RawPolicyRow,
    "portfolio_premium"
  >[];

  /*
   * Todas as companhias, exceto Zurich:
   * mantém o comportamento atual da aplicação.
   */
  if (!isZurichCompanyCode(companyCode)) {
    return rows.map((row) => ({
      ...row,
      portfolio_premium: toNumber(row.annualized_premium),
    }));
  }

  /*
   * Zurich:
   * o valor da Carteira vem de receipts.commercial_premium.
   */
  const commercialPremiums = await getZurichCommercialPremiums(
    rows.map((row) => row.id),
  );

  return rows.map((row) => ({
    ...row,
    portfolio_premium: commercialPremiums.get(row.id) ?? 0,
  }));
}

// ============================================================
// OVERVIEW DE COMPANHIAS (página inicial /carteira)
// ============================================================

export async function getCompaniesOverview(): Promise<CompanyOverview[]> {
  const admin = createAdminClient();

  const { stores } = await getAccessibleStores();
  const storeIds = stores.map((store) => store.id);

  const { data: companies, error: companiesError } = await admin
    .from("companies")
    .select("id, code, name")
    .eq("active", true)
    .order("name", { ascending: true });

  if (companiesError) {
    throw new Error(
      `Erro ao carregar companhias: ${companiesError.message}`,
    );
  }

  if (!companies || companies.length === 0 || storeIds.length === 0) {
    return [];
  }

  /*
   * Usamos fetchActivePolicies também no overview.
   * Assim a regra do prémio é exatamente a mesma em:
   *
   * - /carteira
   * - detalhe da companhia
   * - detalhe por loja
   * - produção anual
   *
   * Para Zurich isto significa commercial_premium dos recibos.
   */
  const overview = await Promise.all(
    companies.map(async (company) => {
      const rows = await fetchActivePolicies(
        storeIds,
        company.id,
        company.code,
      );

      const totalPremium = rows.reduce(
        (sum, row) => sum + row.portfolio_premium,
        0,
      );

      return {
        id: company.id,
        code: company.code,
        name: company.name,
        totalCount: rows.length,
        totalAnualizado: totalPremium,
      } satisfies CompanyOverview;
    }),
  );

  return overview;
}

// ============================================================
// AGREGAÇÃO POR PLANO / PRODUTO
// ============================================================

function buildPlans(rows: RawPolicyRow[]): {
  plans: PlanBreakdown[];
  totalCount: number;
  totalAnualizado: number;
  seguroTotal: number;
} {
  type ProductKey = string;

  const planGroups = new Map<
    PlanBreakdown["planType"],
    Map<ProductKey, ProductBreakdown>
  >([
    ["VIDA", new Map()],
    ["NAO_VIDA", new Map()],
    ["FINANCEIROS", new Map()],
    ["NAO_CLASSIFICADO", new Map()],
  ]);

  for (const row of rows) {
    const line = firstRelation(row.insurance_line);

    const planType: PlanBreakdown["planType"] =
      line?.plan_type === "VIDA" ||
      line?.plan_type === "NAO_VIDA" ||
      line?.plan_type === "FINANCEIROS"
        ? line.plan_type
        : "NAO_CLASSIFICADO";

    const premium = row.portfolio_premium;
    const productKey =
      row.product_code ?? row.product_name ?? "sem-codigo";

    const group = planGroups.get(planType)!;

    const current = group.get(productKey) ?? {
      productCode: row.product_code,
      productName: row.product_name,
      count: 0,
      annualizedPremium: 0,
    };

    current.count += 1;
    current.annualizedPremium += premium;

    group.set(productKey, current);
  }

  const plans: PlanBreakdown[] = [];

  let totalCount = 0;
  let totalAnualizado = 0;
  let seguroTotal = 0;

  const order: PlanBreakdown["planType"][] = [
    "VIDA",
    "NAO_VIDA",
    "FINANCEIROS",
    "NAO_CLASSIFICADO",
  ];

  for (const planType of order) {
    const productsMap = planGroups.get(planType)!;

    const products = Array.from(productsMap.values()).sort(
      (a, b) => b.annualizedPremium - a.annualizedPremium,
    );

    const planCount = products.reduce(
      (sum, product) => sum + product.count,
      0,
    );

    const planPremium = products.reduce(
      (sum, product) => sum + product.annualizedPremium,
      0,
    );

    if (planCount === 0) {
      continue;
    }

    plans.push({
      planType,
      count: planCount,
      annualizedPremium: planPremium,
      products,
    });

    totalCount += planCount;
    totalAnualizado += planPremium;

    if (planType === "VIDA" || planType === "NAO_VIDA") {
      seguroTotal += planPremium;
    }
  }

  return {
    plans,
    totalCount,
    totalAnualizado,
    seguroTotal,
  };
}

// ============================================================
// CARTEIRA DE UMA LOJA (dentro de uma companhia)
// ============================================================

export async function getStorePortfolio(
  storeId: string,
  companyId: string,
): Promise<StorePortfolio> {
  const admin = createAdminClient();

  const { data: store, error: storeError } = await admin
    .from("stores")
    .select("id, name")
    .eq("id", storeId)
    .maybeSingle();

  if (storeError) {
    throw new Error(`Erro ao carregar loja: ${storeError.message}`);
  }

  if (!store) {
    throw new Error("Loja não encontrada.");
  }

  /*
   * Mantém a regra atual:
   * loja selecionada + apólices ainda sem issuing_store_id.
   */
  const rows = await fetchActivePolicies([storeId], companyId);

  const {
    plans,
    totalCount,
    totalAnualizado,
    seguroTotal,
  } = buildPlans(rows);

  return {
    storeId: store.id,
    storeName: store.name,
    totalCount,
    totalAnualizado,
    seguroTotal,
    plans,
  };
}

// ============================================================
// CARTEIRA DE TODAS AS LOJAS ACESSÍVEIS
// ============================================================

export async function getAllStoresPortfolio(
  companyId: string,
): Promise<StorePortfolio> {
  const { stores } = await getAccessibleStores();
  const storeIds = stores.map((store) => store.id);

  const rows =
    storeIds.length > 0
      ? await fetchActivePolicies(storeIds, companyId)
      : [];

  const {
    plans,
    totalCount,
    totalAnualizado,
    seguroTotal,
  } = buildPlans(rows);

  return {
    storeId: "all",
    storeName: "Todas as lojas",
    totalCount,
    totalAnualizado,
    seguroTotal,
    plans,
  };
}

// ============================================================
// PRODUÇÃO ANUAL
// ============================================================

export async function getYearlyProduction(
  storeId: string | "all",
  companyId: string,
): Promise<YearlyProduction[]> {
  const storeIds =
    storeId === "all"
      ? (await getAccessibleStores()).stores.map((store) => store.id)
      : [storeId];

  const rows =
    storeIds.length > 0
      ? await fetchActivePolicies(storeIds, companyId)
      : [];

  const byYear = new Map<
    number,
    {
      count: number;
      premium: number;
    }
  >();

  for (const row of rows) {
    if (!row.issue_date) {
      continue;
    }

    const year = Number(row.issue_date.slice(0, 4));

    if (!Number.isFinite(year)) {
      continue;
    }

    const current = byYear.get(year) ?? {
      count: 0,
      premium: 0,
    };

    current.count += 1;
    current.premium += row.portfolio_premium;

    byYear.set(year, current);
  }

  const years = Array.from(byYear.keys()).sort((a, b) => a - b);

  return years.map((year, index) => {
    const current = byYear.get(year)!;
    const previous =
      index > 0 ? byYear.get(years[index - 1]) : null;

    const growthPct =
      previous && previous.premium > 0
        ? ((current.premium - previous.premium) /
            previous.premium) *
          100
        : null;

    return {
      year,
      count: current.count,
      totalAnualizado: current.premium,
      growthPct,
    };
  });
}
