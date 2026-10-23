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
  missingCommercialCount: number;
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
  missingCommercialCount: number;
  // Zurich: prémio comercial dos recibos de 1 de janeiro até hoje — o
  // valor de "Produção" do painel MyZurich (que mete os Financeiros
  // dentro do Vida).
  yearProduction: { vida: number; naoVida: number; total: number } | null;
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
  // Zurich sem recibo no CRM: não há prémio comercial (conta 0).
  missing_commercial: boolean;
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

/*
 * Entregas pontuais (ex.: PPR): não são o prémio periódico da apólice,
 * por isso não se anualizam nem servem de "último recibo".
 */
function isOneOffReceipt(receipt: ZurichReceiptRow): boolean {
  const receiptType = (receipt.receipt_type ?? "").trim().toUpperCase();

  return (
    receiptType.includes("SUPLEMENTAR") ||
    receiptType.includes("PRÉMIO ÚNICO") ||
    receiptType.includes("PREMIO UNICO")
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
 * - A Carteira é SEMPRE prémio comercial. Apólice SEM recibo no CRM
 *   conta 0 e é sinalizada (missing_commercial) — o prémio da própria
 *   apólice é o TOTAL (com encargos) e não serve.
 *
 * A ordenação é por period_end e depois issue_date, ambos descendentes.
 * Como percorremos nessa ordem e só guardamos o primeiro recibo válido
 * por policy_id, ficamos com o mais recente.
 */

// Ids por pedido: com centenas de ids, o URL do .in() fica grande
// demais e o pedido falha ("fetch failed").
const RECEIPTS_CHUNK = 150;

// Limite de linhas por pedido do Supabase.
const POLICIES_PAGE = 1000;

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

  async function loadChunk(chunkIds: string[]): Promise<ZurichReceiptRow[]> {
    const out: ZurichReceiptRow[] = [];

    for (let from = 0; ; from += POLICIES_PAGE) {
      const { data, error } = await admin
        .from("receipts")
        .select(`
          id,
          policy_id,
          commercial_premium,
          period_start,
          period_end,
          issue_date,
          receipt_type,
          external_nature
        `)
        .in("policy_id", chunkIds)
        .not("commercial_premium", "is", null)
        .order("id")
        .range(from, from + POLICIES_PAGE - 1);

      if (error) {
        throw new Error(
          `Erro ao carregar prémios comerciais Zurich: ${error.message}`,
        );
      }

      out.push(...((data ?? []) as ZurichReceiptRow[]));

      if ((data ?? []).length < POLICIES_PAGE) return out;
    }
  }

  const chunks = await Promise.all(
    Array.from({ length: Math.ceil(ids.length / RECEIPTS_CHUNK) }, (_, i) =>
      loadChunk(ids.slice(i * RECEIPTS_CHUNK, (i + 1) * RECEIPTS_CHUNK)),
    ),
  );

  const receipts = chunks.flat();

  // Ordenar para o mais recente ficar primeiro.
  receipts.sort(
    (a, b) =>
      (b.period_end ?? "").localeCompare(a.period_end ?? "") ||
      (b.issue_date ?? "").localeCompare(a.issue_date ?? ""),
  );

  const oneYearAgo = new Date(Date.now() - 365 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const oneOffTotals = new Map<string, number>();

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

    if (isOneOffReceipt(receipt)) {
      // Prémio único / entregas livres (PPR, Investimento): sem prémio
      // periódico — soma-se o que entrou nos últimos 12 meses, sem
      // anualizar (ver abaixo).
      if ((receipt.period_start ?? "") >= oneYearAgo) {
        oneOffTotals.set(
          receipt.policy_id,
          (oneOffTotals.get(receipt.policy_id) ?? 0) +
            toNumber(receipt.commercial_premium),
        );
      }

      continue;
    }

    const perYear = receiptsPerYear(
      receipt,
      frequencies.get(receipt.policy_id) ?? null,
    );

    result.set(
      receipt.policy_id,
      Math.round(toNumber(receipt.commercial_premium) * perYear * 100) / 100,
    );
  }

  for (const [policyId, total] of oneOffTotals) {
    if (!result.has(policyId)) {
      result.set(policyId, Math.round(total * 100) / 100);
    }
  }

  return result;
}

// ============================================================
// ZURICH — PRODUÇÃO DO ANO (como no painel MyZurich)
// ============================================================

type YearReceiptRow = ZurichReceiptRow & {
  status: string | null;
  policy:
    | {
        issuing_store_id: string | null;
        insurance_line: { plan_type: string } | { plan_type: string }[] | null;
      }
    | null;
};

/*
 * O painel MyZurich ("Produção") NÃO é a carteira anual: é o prémio
 * comercial dos recibos com início entre 1 de janeiro e hoje, sem os
 * anulados e com os estornos a abater. O "Vida" do painel inclui os
 * Financeiros (PPR, Unit Linked, poupança), que o CRM classifica à
 * parte. Confirmado a 2026-10-23: 540.084 € no CRM vs 546.894 € no
 * painel (98,8 %). Só para Zurich; nas outras companhias devolve null.
 */
async function getZurichYearProduction(
  storeIds: string[],
  companyId: string,
): Promise<{ vida: number; naoVida: number; total: number } | null> {
  const companies = await getCachedCompanies();
  const company = companies.find((item) => item.id === companyId);

  if (!isZurichCompanyCode(company?.code)) {
    return null;
  }

  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const allowedStores = new Set(storeIds);
  let vida = 0;
  let naoVida = 0;

  for (let from = 0; ; from += POLICIES_PAGE) {
    const { data, error } = await admin
      .from("receipts")
      .select(`
        id,
        policy_id,
        commercial_premium,
        period_start,
        period_end,
        issue_date,
        receipt_type,
        external_nature,
        status,
        policy:policies!inner (
          issuing_store_id,
          insurance_line:insurance_lines ( plan_type )
        )
      `)
      .eq("company_id", companyId)
      .gte("period_start", yearStart)
      .lte("period_start", today)
      .neq("status", "CANCELLED")
      .not("commercial_premium", "is", null)
      .order("id")
      .range(from, from + POLICIES_PAGE - 1);

    if (error) {
      throw new Error(`Erro ao carregar produção Zurich: ${error.message}`);
    }

    const page = (data ?? []) as unknown as YearReceiptRow[];

    for (const receipt of page) {
      const storeId = receipt.policy?.issuing_store_id ?? null;

      if (storeId && !allowedStores.has(storeId)) continue;

      const planType = firstRelation(receipt.policy?.insurance_line)?.plan_type;

      const absolute = Math.abs(toNumber(receipt.commercial_premium));
      const premium = isReversalReceipt(receipt) ? -absolute : absolute;

      if (planType === "VIDA" || planType === "FINANCEIROS") vida += premium;
      else if (planType === "NAO_VIDA") naoVida += premium;
    }

    if (page.length < POLICIES_PAGE) break;
  }

  const round = (value: number) => Math.round(value * 100) / 100;

  return {
    vida: round(vida),
    naoVida: round(naoVida),
    total: round(vida + naoVida),
  };
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

  if (storeIds !== null && storeIds.length === 0) {
    return [];
  }

  function pageQuery(from: number) {
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
      query = query.or(storeOrUnassignedFilter(storeIds));
    }

    return query.order("id").range(from, from + POLICIES_PAGE - 1);
  }

  /*
   * O Supabase devolve no máximo 1000 linhas por pedido: sem paginar,
   * uma companhia com mais apólices ficava cortada (e com um corte
   * arbitrário — ex.: só apólices até 2023).
   */
  const rows: Omit<
    RawPolicyRow,
    "portfolio_premium" | "missing_commercial"
  >[] = [];

  for (let from = 0; ; from += POLICIES_PAGE) {
    const { data, error } = await pageQuery(from);

    if (error) {
      throw new Error(`Erro ao carregar carteira: ${error.message}`);
    }

    const page = (data ?? []) as unknown as typeof rows;

    rows.push(...page);

    if (page.length < POLICIES_PAGE) break;
  }

  /*
   * Todas as companhias, exceto Zurich:
   * mantém o comportamento atual da aplicação.
   */
  if (!isZurichCompanyCode(companyCode)) {
    return rows.map((row) => ({
      ...row,
      portfolio_premium: toNumber(row.annualized_premium),
      missing_commercial: false,
    }));
  }

  /*
   * Zurich: prémio comercial do último recibo, anualizado; sem
   * recibo conta 0 (ver getZurichAnnualPremiums).
   */
  const annualPremiums = await getZurichAnnualPremiums(rows);

  return rows.map((row) => {
    const premium = annualPremiums.get(row.id);

    return {
      ...row,
      portfolio_premium: premium ?? 0,
      missing_commercial: premium === undefined,
    };
  });
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
        missingCommercialCount: rows.filter((row) => row.missing_commercial)
          .length,
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
  missingCommercialCount: number;
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
    missingCommercialCount: rows.filter((row) => row.missing_commercial)
      .length,
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
  const [rows, yearProduction] = await Promise.all([
    fetchActivePolicies([storeId], companyId),
    getZurichYearProduction([storeId], companyId),
  ]);

  const {
    plans,
    totalCount,
    totalAnualizado,
    seguroTotal,
    missingCommercialCount,
  } = buildPlans(rows);

  return {
    storeId: store.id,
    storeName: store.name,
    totalCount,
    totalAnualizado,
    seguroTotal,
    missingCommercialCount,
    yearProduction,
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

  const [rows, yearProduction] =
    storeIds.length > 0
      ? await Promise.all([
          fetchActivePolicies(storeIds, companyId),
          getZurichYearProduction(storeIds, companyId),
        ])
      : [[], null];

  const {
    plans,
    totalCount,
    totalAnualizado,
    seguroTotal,
    missingCommercialCount,
  } = buildPlans(rows);

  return {
    storeId: "all",
    storeName: "Todas as lojas",
    totalCount,
    totalAnualizado,
    seguroTotal,
    missingCommercialCount,
    yearProduction,
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
