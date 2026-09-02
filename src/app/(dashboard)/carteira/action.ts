"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";

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
  product_code: string | null;
  product_name: string | null;
  annualized_premium: number | string | null;
  issue_date: string | null;
  issuing_store_id: string | null;
  insurance_line: { plan_type: string } | { plan_type: string }[] | null;
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
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

    return { stores: data ?? [], canAccessAll: true };
  }

  if (!profile.store) {
    return { stores: [], canAccessAll: false };
  }

  return {
    stores: [{ id: profile.store.id, name: profile.store.name }],
    canAccessAll: false,
  };
}

// ============================================================
// OVERVIEW DE COMPANHIAS (página inicial /carteira)
// ============================================================

export async function getCompaniesOverview(): Promise<CompanyOverview[]> {
  const admin = createAdminClient();

  const { stores } = await getAccessibleStores();
  const storeIds = stores.map((s) => s.id);

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

const todayKey = new Date().toISOString().slice(0, 10);

let query = admin
  .from("policies")
  .select("company_id, annualized_premium")
  .eq("status", "ACTIVE")
  .in("issuing_store_id", storeIds)
  .not("start_date", "is", null)
  .lte("start_date", todayKey);

  const { data: policies, error: policiesError } = await query;

  if (policiesError) {
    throw new Error(
      `Erro ao carregar carteira: ${policiesError.message}`,
    );
  }

  const totalsByCompany = new Map<
    string,
    { count: number; premium: number }
  >();

  for (const row of policies ?? []) {
    const current = totalsByCompany.get(row.company_id) ?? {
      count: 0,
      premium: 0,
    };

    current.count += 1;

    current.premium +=
      row.annualized_premium === null ? 0 : Number(row.annualized_premium);

    totalsByCompany.set(row.company_id, current);
  }

  return companies.map((company) => {
    const totals = totalsByCompany.get(company.id) ?? {
      count: 0,
      premium: 0,
    };

    return {
      id: company.id,
      code: company.code,
      name: company.name,
      totalCount: totals.count,
      totalAnualizado: totals.premium,
    };
  });
}

// ============================================================
// FETCH PARTILHADO
// ============================================================

async function fetchActivePolicies(
  storeIds: string[] | null,
  companyId: string,
): Promise<RawPolicyRow[]> {
  const admin = createAdminClient();

  const todayKey = new Date().toISOString().slice(0, 10);

let query = admin
  .from("policies")
  .select(`
    product_code,
    product_name,
    annualized_premium,
    start_date,
    issuing_store_id,
    insurance_line:insurance_lines ( plan_type )
  `)
  .eq("status", "ACTIVE")
  .eq("company_id", companyId)
  .not("start_date", "is", null)
  .lte("start_date", todayKey);

  if (storeIds) {
    query = query.in("issuing_store_id", storeIds);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Erro ao carregar carteira: ${error.message}`);
  }

  return (data ?? []) as unknown as RawPolicyRow[];
}

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

    const premium =
      row.annualized_premium === null ? 0 : Number(row.annualized_premium);

    const productKey = row.product_code ?? row.product_name ?? "sem-codigo";

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

  const order = ["VIDA", "NAO_VIDA", "FINANCEIROS", "NAO_CLASSIFICADO"];

  for (const planType of order as PlanBreakdown["planType"][]) {
    const productsMap = planGroups.get(planType)!;

    const products = Array.from(productsMap.values()).sort(
      (a, b) => b.annualizedPremium - a.annualizedPremium,
    );

    const planCount = products.reduce((sum, p) => sum + p.count, 0);
    const planPremium = products.reduce(
      (sum, p) => sum + p.annualizedPremium,
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

  return { plans, totalCount, totalAnualizado, seguroTotal };
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

  const rows = await fetchActivePolicies([storeId], companyId);
  const { plans, totalCount, totalAnualizado, seguroTotal } =
    buildPlans(rows);

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
// CARTEIRA DE TODAS AS LOJAS ACESSÍVEIS (agregado, por companhia)
// ============================================================

export async function getAllStoresPortfolio(
  companyId: string,
): Promise<StorePortfolio> {
  const { stores } = await getAccessibleStores();

  const storeIds = stores.map((s) => s.id);

  const rows =
    storeIds.length > 0
      ? await fetchActivePolicies(storeIds, companyId)
      : [];

  const { plans, totalCount, totalAnualizado, seguroTotal } =
    buildPlans(rows);

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
// PRODUÇÃO ANUAL (por ano de emissão, apólices ativas)
// ============================================================

export async function getYearlyProduction(
  storeId: string | "all",
  companyId: string,
): Promise<YearlyProduction[]> {
  const storeIds =
    storeId === "all"
      ? (await getAccessibleStores()).stores.map((s) => s.id)
      : [storeId];

  const rows =
    storeIds.length > 0
      ? await fetchActivePolicies(storeIds, companyId)
      : [];

  const byYear = new Map<number, { count: number; premium: number }>();

  for (const row of rows) {
    if (!row.issue_date) continue;

    const year = Number(row.issue_date.slice(0, 4));

    if (!Number.isFinite(year)) continue;

    const premium =
      row.annualized_premium === null ? 0 : Number(row.annualized_premium);

    const current = byYear.get(year) ?? { count: 0, premium: 0 };

    current.count += 1;
    current.premium += premium;

    byYear.set(year, current);
  }

  const years = Array.from(byYear.keys()).sort((a, b) => a - b);

  return years.map((year, index) => {
    const current = byYear.get(year)!;
    const previous = index > 0 ? byYear.get(years[index - 1]) : null;

    const growthPct =
      previous && previous.premium > 0
        ? ((current.premium - previous.premium) / previous.premium) * 100
        : null;

    return {
      year,
      count: current.count,
      totalAnualizado: current.premium,
      growthPct,
    };
  });
}