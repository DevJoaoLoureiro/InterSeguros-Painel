"use server";

import { createAdminClient } from "@/lib/supabase/admin";

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat("pt-PT", {
    month: "short",
    year: "2-digit",
  }).format(date);
}

export type MonthlyProduction = {
  monthKey: string;
  label: string;
  policiesCount: number;
  commercialPremium: number;
};

export type PersonRanking = {
  userId: string;
  name: string;
  role: string | null;
  policiesCount: number;
  annualizedPremium: number;
};

export type StoreRanking = {
  storeId: string;
  storeName: string;
  policiesCount: number;
  annualizedPremium: number;
};

export type MonthComparison = {
  currentMonth: { label: string; policiesCount: number; commercialPremium: number };
  previousMonth: { label: string; policiesCount: number; commercialPremium: number };
  policiesChangePct: number | null;
  premiumChangePct: number | null;
};

type PolicyRow = {
  id: string;
  issue_date: string | null;
  status: string;
  commercial_premium: number | string | null;
  annualized_premium: number | string | null;
  commercial_user_id: string | null;
  issuing_store_id: string | null;
};

async function loadPolicies({
  storeId,
}: {
  storeId: string | null;
}): Promise<PolicyRow[]> {
  const supabase = createAdminClient();

  let query = supabase
    .from("policies")
    .select(`
      id,
      issue_date,
      status,
      commercial_premium,
      annualized_premium,
      commercial_user_id,
      issuing_store_id
    `);

  if (storeId && storeId !== "all") {
    query = query.eq("issuing_store_id", storeId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(
      `Erro ao carregar apólices para estatísticas: ${error.message}`,
    );
  }

  return data ?? [];
}

/*
 * Evolução mensal dos últimos 12 meses,
 * baseada em issue_date (mesma definição de
 * "produção" já usada no Dashboard).
 */
export async function getMonthlyProduction({
  storeId,
}: {
  storeId: string | null;
}): Promise<MonthlyProduction[]> {
  const policies = await loadPolicies({ storeId });

  const months: MonthlyProduction[] = [];

  for (let i = 11; i >= 0; i--) {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() - i);

    months.push({
      monthKey: monthKey(date),
      label: monthLabel(date),
      policiesCount: 0,
      commercialPremium: 0,
    });
  }

  const monthMap = new Map(months.map((m) => [m.monthKey, m]));

  for (const policy of policies) {
    if (!policy.issue_date) {
      continue;
    }

    const issueDate = new Date(policy.issue_date);
    const key = monthKey(issueDate);
    const month = monthMap.get(key);

    if (!month) {
      continue;
    }

    month.policiesCount += 1;
    month.commercialPremium += Number(policy.commercial_premium ?? 0);
  }

  return months;
}

export async function getMonthComparison({
  storeId,
}: {
  storeId: string | null;
}): Promise<MonthComparison> {
  const months = await getMonthlyProduction({ storeId });

  const currentMonth = months[months.length - 1];
  const previousMonth = months[months.length - 2];

  function pctChange(current: number, previous: number): number | null {
    if (previous === 0) {
      return current > 0 ? 100 : null;
    }

    return ((current - previous) / previous) * 100;
  }

  return {
    currentMonth: {
      label: currentMonth.label,
      policiesCount: currentMonth.policiesCount,
      commercialPremium: currentMonth.commercialPremium,
    },

    previousMonth: {
      label: previousMonth.label,
      policiesCount: previousMonth.policiesCount,
      commercialPremium: previousMonth.commercialPremium,
    },

    policiesChangePct: pctChange(
      currentMonth.policiesCount,
      previousMonth.policiesCount,
    ),

    premiumChangePct: pctChange(
      currentMonth.commercialPremium,
      previousMonth.commercialPremium,
    ),
  };
}

/*
 * Ranking por comercial, com base na carteira
 * ativa (annualized_premium de policies ACTIVE).
 */
export async function getRankingByPerson({
  storeId,
}: {
  storeId: string | null;
}): Promise<PersonRanking[]> {
  const supabase = createAdminClient();
  const policies = await loadPolicies({ storeId });

  const activePolicies = policies.filter((p) => p.status === "ACTIVE");

  const userIds = Array.from(
    new Set(
      activePolicies
        .map((p) => p.commercial_user_id)
        .filter(Boolean) as string[],
    ),
  );

  if (userIds.length === 0) {
    return [];
  }

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .in("id", userIds);

  if (error) {
    throw new Error(
      `Erro ao carregar utilizadores para ranking: ${error.message}`,
    );
  }

  const profileMap = new Map(
    (profiles ?? []).map((p) => [p.id, p]),
  );

  const grouped = new Map<string, PersonRanking>();

  for (const policy of activePolicies) {
    if (!policy.commercial_user_id) {
      continue;
    }

    const profile = profileMap.get(policy.commercial_user_id);

    const current = grouped.get(policy.commercial_user_id) ?? {
      userId: policy.commercial_user_id,
      name: profile?.full_name ?? "Sem nome",
      role: profile?.role ?? null,
      policiesCount: 0,
      annualizedPremium: 0,
    };

    current.policiesCount += 1;
    current.annualizedPremium += Number(policy.annualized_premium ?? 0);

    grouped.set(policy.commercial_user_id, current);
  }

  return Array.from(grouped.values()).sort(
    (a, b) => b.annualizedPremium - a.annualizedPremium,
  );
}

/*
 * Ranking por loja, mesma métrica.
 */
export async function getRankingByStore({
  storeId,
}: {
  storeId: string | null;
}): Promise<StoreRanking[]> {
  const supabase = createAdminClient();
  const policies = await loadPolicies({ storeId });

  const activePolicies = policies.filter((p) => p.status === "ACTIVE");

  const storeIds = Array.from(
    new Set(
      activePolicies
        .map((p) => p.issuing_store_id)
        .filter(Boolean) as string[],
    ),
  );

  if (storeIds.length === 0) {
    return [];
  }

  const { data: stores, error } = await supabase
    .from("stores")
    .select("id, name")
    .in("id", storeIds);

  if (error) {
    throw new Error(
      `Erro ao carregar lojas para ranking: ${error.message}`,
    );
  }

  const storeMap = new Map((stores ?? []).map((s) => [s.id, s.name]));

  const grouped = new Map<string, StoreRanking>();

  for (const policy of activePolicies) {
    if (!policy.issuing_store_id) {
      continue;
    }

    const current = grouped.get(policy.issuing_store_id) ?? {
      storeId: policy.issuing_store_id,
      storeName: storeMap.get(policy.issuing_store_id) ?? "Sem loja",
      policiesCount: 0,
      annualizedPremium: 0,
    };

    current.policiesCount += 1;
    current.annualizedPremium += Number(policy.annualized_premium ?? 0);

    grouped.set(policy.issuing_store_id, current);
  }

  return Array.from(grouped.values()).sort(
    (a, b) => b.annualizedPremium - a.annualizedPremium,
  );
}