import type { AiUserContext } from "@/lib/ai/context";

type NormalizedRow = {
  company_name: string | null;
  responsible_name: string | null;
  premium: number;
};

type NormalizedRenewal = {
  id: string;
  client_id: string;
  policy_number: string;
  company_name: string | null;
  product_name: string | null;
  premium: number;
  renew_date: string | null;
  responsible_name: string | null;
};

type RankingItem = {
  name: string;
  count: number;
  premium: number;
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function getMonthStart(date: string) {
  return `${date.slice(0, 7)}-01`;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function buildRanking(
  rows: NormalizedRow[],
  field: "company_name" | "responsible_name",
): RankingItem[] {
  const ranking = new Map<string, RankingItem>();

  for (const row of rows) {
    const name = row[field]?.trim();

    if (!name) continue;

    const current = ranking.get(name) ?? { name, count: 0, premium: 0 };

    current.count += 1;
    current.premium += row.premium;

    ranking.set(name, current);
  }

  return Array.from(ranking.values()).sort(
    (a, b) => b.count - a.count || b.premium - a.premium,
  );
}

export async function getManagementOverview(context: AiUserContext) {
  const today = context.today;
  const monthStart = getMonthStart(today);
  const renewalsUntil = addDays(today, 7);

  const baseSelect = `
    id,
    client_id,
    policy_number,
    product_name,
    annualized_premium,
    issue_date,
    renewal_date,
    company:companies ( name ),
    commercial_user:profiles!policies_commercial_user_id_fkey ( full_name )
  `;

  let todayQuery = context.supabase
    .from("policies")
    .select(baseSelect)
    .eq("issue_date", today);

  let monthQuery = context.supabase
    .from("policies")
    .select(baseSelect)
    .gte("issue_date", monthStart)
    .lte("issue_date", today);

  let renewalsQuery = context.supabase
    .from("policies")
    .select(baseSelect)
    .gte("renewal_date", today)
    .lte("renewal_date", renewalsUntil)
    .order("renewal_date", { ascending: true });

  if (context.storeId) {
    todayQuery = todayQuery.eq("issuing_store_id", context.storeId);
    monthQuery = monthQuery.eq("issuing_store_id", context.storeId);
    renewalsQuery = renewalsQuery.eq("issuing_store_id", context.storeId);
  }

  const [todayResult, monthResult, renewalsResult] = await Promise.all([
    todayQuery,
    monthQuery,
    renewalsQuery,
  ]);

  if (todayResult.error) {
    throw new Error(
      `Erro ao consultar produção de hoje: ${todayResult.error.message}`,
    );
  }

  if (monthResult.error) {
    throw new Error(
      `Erro ao consultar produção mensal: ${monthResult.error.message}`,
    );
  }

  if (renewalsResult.error) {
    throw new Error(
      `Erro ao consultar renovações: ${renewalsResult.error.message}`,
    );
  }

  function normalize(row: any): NormalizedRow {
    return {
      company_name: firstRelation(row.company)?.name ?? null,
      responsible_name: firstRelation(row.commercial_user)?.full_name ?? null,
      premium:
        row.annualized_premium === null ? 0 : Number(row.annualized_premium),
    };
  }

  const todayRows = (todayResult.data ?? []).map(normalize);
  const monthRows = (monthResult.data ?? []).map(normalize);

  const renewalRows: NormalizedRenewal[] = (renewalsResult.data ?? []).map(
    (row: any) => ({
      id: row.id,
      client_id: row.client_id,
      policy_number: row.policy_number,
      company_name: firstRelation(row.company)?.name ?? null,
      product_name: row.product_name,
      premium:
        row.annualized_premium === null ? 0 : Number(row.annualized_premium),
      renew_date: row.renewal_date,
      responsible_name: firstRelation(row.commercial_user)?.full_name ?? null,
    }),
  );

  const todayPremium = todayRows.reduce((total, r) => total + r.premium, 0);
  const monthPremium = monthRows.reduce((total, r) => total + r.premium, 0);
  const renewalPremium = renewalRows.reduce(
    (total, r) => total + r.premium,
    0,
  );

  const companies = buildRanking(monthRows, "company_name");
  const responsibles = buildRanking(monthRows, "responsible_name");

  return {
    generatedAt: today,

    today: {
      date: today,
      policyCount: todayRows.length,
      totalPremium: todayPremium,
    },

    month: {
      from: monthStart,
      to: today,
      policyCount: monthRows.length,
      totalPremium: monthPremium,
      averagePremium:
        monthRows.length > 0 ? monthPremium / monthRows.length : 0,
      topCompany: companies[0] ?? null,
      topResponsible: responsibles[0] ?? null,
      companies: companies.slice(0, 5),
      responsibles: responsibles.slice(0, 5),
    },

    upcomingRenewals: {
      from: today,
      to: renewalsUntil,
      count: renewalRows.length,
      totalPremium: renewalPremium,
      policies: renewalRows.slice(0, 20),
    },
  };
}