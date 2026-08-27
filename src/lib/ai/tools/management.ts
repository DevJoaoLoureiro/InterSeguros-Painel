import type {
  AiUserContext,
} from "@/lib/ai/context";

type ProductionRow = {
  company_name: string | null;
  responsible_name: string | null;
  assigned_user_id: string | null;
  premium: number | null;
  issue_date: string | null;
};

type RenewalRow = {
  id: string;
  client_id: string;
  policy_number: string;
  company_name: string | null;
  product_name: string | null;
  premium: number | null;
  renew_date: string | null;
  responsible_name: string | null;
};

type RankingItem = {
  name: string;
  count: number;
  premium: number;
};

function getMonthStart(
  date: string,
) {
  return `${date.slice(0, 7)}-01`;
}

function addDays(
  date: string,
  days: number,
) {
  const value =
    new Date(
      `${date}T12:00:00Z`,
    );

  value.setUTCDate(
    value.getUTCDate() + days,
  );

  return value
    .toISOString()
    .slice(0, 10);
}

function buildRanking(
  rows: ProductionRow[],
  field:
    | "company_name"
    | "responsible_name",
): RankingItem[] {
  const ranking =
    new Map<
      string,
      RankingItem
    >();

  for (const row of rows) {
    const name =
      row[field]?.trim();

    if (!name) {
      continue;
    }

    const current =
      ranking.get(name) ?? {
        name,
        count: 0,
        premium: 0,
      };

    current.count += 1;

    current.premium +=
      Number(
        row.premium ?? 0,
      );

    ranking.set(
      name,
      current,
    );
  }

  return Array.from(
    ranking.values(),
  ).sort(
    (a, b) =>
      b.count - a.count ||
      b.premium - a.premium,
  );
}

export async function getManagementOverview(
  context: AiUserContext,
) {
  const today =
    context.today;

  const monthStart =
    getMonthStart(today);

  const renewalsUntil =
    addDays(
      today,
      7,
    );

  // ==========================================
  // PRODUÇÃO DE HOJE
  // ==========================================

  let todayQuery =
    context.supabase
      .from("policies")
      .select(`
        company_name,
        responsible_name,
        assigned_user_id,
        premium,
        issue_date
      `)
      .eq(
        "issue_date",
        today,
      );

  // ==========================================
  // PRODUÇÃO DO MÊS
  // ==========================================

  let monthQuery =
    context.supabase
      .from("policies")
      .select(`
        company_name,
        responsible_name,
        assigned_user_id,
        premium,
        issue_date
      `)
      .gte(
        "issue_date",
        monthStart,
      )
      .lte(
        "issue_date",
        today,
      );

  // ==========================================
  // RENOVAÇÕES DOS PRÓXIMOS 7 DIAS
  // ==========================================

  let renewalsQuery =
    context.supabase
      .from("policies")
      .select(`
        id,
        client_id,
        policy_number,
        company_name,
        product_name,
        premium,
        renew_date,
        responsible_name
      `)
      .gte(
        "renew_date",
        today,
      )
      .lte(
        "renew_date",
        renewalsUntil,
      )
      .order(
        "renew_date",
        {
          ascending: true,
        },
      );

  // ==========================================
  // PERMISSÕES / LOJA
  // ==========================================

  if (context.storeId) {
    todayQuery =
      todayQuery.eq(
        "store_id",
        context.storeId,
      );

    monthQuery =
      monthQuery.eq(
        "store_id",
        context.storeId,
      );

    renewalsQuery =
      renewalsQuery.eq(
        "store_id",
        context.storeId,
      );
  }

  // ==========================================
  // EXECUTAR EM PARALELO
  // ==========================================

  const [
    todayResult,
    monthResult,
    renewalsResult,
  ] = await Promise.all([
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

  const todayRows =
    (todayResult.data ??
      []) as ProductionRow[];

  const monthRows =
    (monthResult.data ??
      []) as ProductionRow[];

  const renewalRows =
    (renewalsResult.data ??
      []) as RenewalRow[];

  // ==========================================
  // TOTAIS
  // ==========================================

  const todayPremium =
    todayRows.reduce(
      (total, row) =>
        total +
        Number(
          row.premium ?? 0,
        ),
      0,
    );

  const monthPremium =
    monthRows.reduce(
      (total, row) =>
        total +
        Number(
          row.premium ?? 0,
        ),
      0,
    );

  const renewalPremium =
    renewalRows.reduce(
      (total, row) =>
        total +
        Number(
          row.premium ?? 0,
        ),
      0,
    );

  // ==========================================
  // RANKINGS
  // ==========================================

  const companies =
    buildRanking(
      monthRows,
      "company_name",
    );

  const responsibles =
    buildRanking(
      monthRows,
      "responsible_name",
    );

  // ==========================================
  // RESULTADO
  // ==========================================

  return {
    generatedAt:
      today,

    today: {
      date:
        today,

      policyCount:
        todayRows.length,

      totalPremium:
        todayPremium,
    },

    month: {
      from:
        monthStart,

      to:
        today,

      policyCount:
        monthRows.length,

      totalPremium:
        monthPremium,

      averagePremium:
        monthRows.length > 0
          ? monthPremium /
            monthRows.length
          : 0,

      topCompany:
        companies[0] ??
        null,

      topResponsible:
        responsibles[0] ??
        null,

      companies:
        companies.slice(
          0,
          5,
        ),

      responsibles:
        responsibles.slice(
          0,
          5,
        ),
    },

    upcomingRenewals: {
      from:
        today,

      to:
        renewalsUntil,

      count:
        renewalRows.length,

      totalPremium:
        renewalPremium,

      policies:
        renewalRows.slice(
          0,
          20,
        ),
    },
  };
}