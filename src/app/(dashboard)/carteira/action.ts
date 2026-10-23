"use server";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertStoreAccess, requireAdmin } from "@/lib/auth/access";
import {
  getCachedCompanies,
  getCachedStores,
} from "@/lib/cache/reference-data";

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
  payment_frequency: string | null;
  portfolio_premium: number;
  issue_date: string | null;
  start_date: string | null;
  issuing_store_id: string | null;
  insurance_line: { plan_type: string } | { plan_type: string }[] | null;
};

type ZurichReceiptRow = {
  policy_id: string | null;
  commercial_premium: number | string | null;
  period_start: string | null;
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
  // Área da agência: só OWNER/ADMIN (sem lógica de lojas — a loja é
  // só um filtro).
  await requireAdmin();

  const profile = await getCurrentProfile();

  if (!profile) {
    throw new Error("Não autenticado.");
  }

  const canAccessAll = profile.role === "OWNER" || profile.role === "ADMIN";

  if (canAccessAll) {
    const stores = await getCachedStores();

    return {
      stores: stores.map((store) => ({ id: store.id, name: store.name })),
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
 * Regra da Carteira para Zurich (valor ANUAL de cada apólice):
 *
 * - O ficheiro de apólices Zurich não traz PremioComercial; o de
 *   recibos traz. Para cada apólice usa-se o recibo válido mais
 *   recente com commercial_premium (estornos/reversões não contam).
 * - O recibo cobre só o seu período (um mês, um trimestre...): o valor
 *   é anualizado — prémio × 12 ÷ meses cobertos. Antes contava só a
 *   prestação, e uma apólice mensal valia 1/12 do real.
 * - Apólice SEM recibos no CRM (os ficheiros diários só existem desde
 *   a ativação dos WebServices): usa-se o prémio anual da própria
 *   apólice em vez de 0. Esse valor é o prémio TOTAL (com encargos),
 *   ligeiramente acima do comercial — melhor aproximação disponível.
 *
 * A ordenação é por period_end e depois issue_date, ambos descendentes.
 * Como percorremos nessa ordem e só guardamos o primeiro recibo válido
 * por policy_id, ficamos com o mais recente.
 */

// Ids por pedido: com centenas de ids, o URL do .in() fica grande
// demais e o pedido falha ("fetch failed").
const RECEIPTS_CHUNK = 150;

const INSTALLMENTS_PER_YEAR: Record<string, number> = {
  ANNUAL: 1,
  SEMIANNUAL: 2,
  QUARTERLY: 4,
  MONTHLY: 12,
};

/* Quantas vezes por ano se paga um recibo como este. */
function receiptsPerYear(
  receipt: ZurichReceiptRow,
  paymentFrequency: string | null,
): number {
  if (receipt.period_start && receipt.period_end) {
    const days =
      (Date.parse(receipt.period_end) - Date.parse(receipt.period_start)) /
        86_400_000 +
      1;
    const months = Math.min(12, Math.max(1, Math.round(days / 30.44)));

    if (Number.isFinite(months)) return 12 / months;
  }

  return INSTALLMENTS_PER_YEAR[(paymentFrequency ?? "").toUpperCase()] ?? 1;
}

async function getZurichAnnualPremiums(
  policies: Pick<RawPolicyRow, "id" | "payment_frequency">[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();

  if (policies.length === 0) {
    return result;
  }

  const frequencies = new Map(
    policies.map((policy) => [policy.id, policy.payment_frequency]),
  );
  const ids = policies.map((policy) => policy.id);
  const admin = createAdminClient();

  const chunks = await Promise.all(
    Array.from({ length: Math.ceil(ids.length / RECEIPTS_CHUNK) }, (_, i) =>
      admin
        .from("receipts")
        .select(`
          policy_id,
          commercial_premium,
          period_start,
          period_end,
          issue_date,
          receipt_type,
          external_nature
        `)
        .in("policy_id", ids.slice(i * RECEIPTS_CHUNK, (i + 1) * RECEIPTS_CHUNK))
        .not("commercial_premium", "is", null)
        .order("period_end", { ascending: false })
        .order("issue_date", { ascending: false }),
    ),
  );

  const receipts: ZurichReceiptRow[] = [];

  for (const { data, error } of chunks) {
    if (error) {
      throw new Error(
        `Erro ao carregar prémios comerciais Zurich: ${error.message}`,
      );
    }

    receipts.push(...((data ?? []) as ZurichReceiptRow[]));
  }

  // Cada bloco vem ordenado; juntos, reordenar para o mais recente
  // ficar primeiro.
  receipts.sort(
    (a, b) =>
      (b.period_end ?? "").localeCompare(a.period_end ?? "") ||
      (b.issue_date ?? "").localeCompare(a.issue_date ?? ""),
  );

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

    const premium =
      toNumber(receipt.commercial_premium) *
      receiptsPerYear(receipt, frequencies.get(receipt.policy_id) ?? null);

    result.set(receipt.policy_id, Math.round(premium * 100) / 100);
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
      payment_frequency,
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
   * Zurich: prémio comercial do último recibo, anualizado; sem
   * recibos, o prémio anual da apólice (ver getZurichAnnualPremiums).
   */
  const annualPremiums = await getZurichAnnualPremiums(rows);

  return rows.map((row) => ({
    ...row,
    portfolio_premium:
      annualPremiums.get(row.id) ?? toNumber(row.annualized_premium),
  }));
}

// ============================================================
// OVERVIEW DE COMPANHIAS (página inicial /carteira)
// ============================================================

export async function getCompaniesOverview(): Promise<CompanyOverview[]> {
  // Lojas e companhias em paralelo (e em cache de referência).
  const [{ stores }, companies] = await Promise.all([
    getAccessibleStores(),
    getCachedCompanies(),
  ]);

  const storeIds = stores.map((store) => store.id);

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
  await assertStoreAccess(storeId);

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
  if (storeId !== "all") await assertStoreAccess(storeId);

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
