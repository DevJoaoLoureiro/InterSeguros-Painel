import type {
  AiUserContext,
} from "@/lib/ai/context";

export async function getProductionSummary(
  context: AiUserContext,
  args: {
    from: string;
    to: string;
  },
) {
  let query =
    context.supabase
      .from("policies")
      .select(`
        id,
        company_name,
        assigned_user_id,
        responsible_name,
        premium,
        issue_date
      `)
      .gte(
        "issue_date",
        args.from,
      )
      .lte(
        "issue_date",
        args.to,
      );

  if (context.storeId) {
    query =
      query.eq(
        "store_id",
        context.storeId,
      );
  }

  const {
    data,
    error,
  } = await query;

  if (error) {
    throw new Error(
      error.message,
    );
  }

  const rows =
    data ?? [];

  const byCompany =
    new Map<
      string,
      {
        count: number;
        premium: number;
      }
    >();

  const byResponsible =
    new Map<
      string,
      {
        count: number;
        premium: number;
      }
    >();

  let totalPremium = 0;

  for (const row of rows) {
    const premium =
      Number(
        row.premium ?? 0,
      );

    totalPremium +=
      premium;

    const company =
      row.company_name ??
      "Sem companhia";

    const currentCompany =
      byCompany.get(
        company,
      ) ?? {
        count: 0,
        premium: 0,
      };

    currentCompany.count++;
    currentCompany.premium +=
      premium;

    byCompany.set(
      company,
      currentCompany,
    );

    const responsible =
      row.responsible_name ??
      "Sem responsável";

    const currentResponsible =
      byResponsible.get(
        responsible,
      ) ?? {
        count: 0,
        premium: 0,
      };

    currentResponsible.count++;
    currentResponsible.premium +=
      premium;

    byResponsible.set(
      responsible,
      currentResponsible,
    );
  }

  return {
    from:
      args.from,

    to:
      args.to,

    policyCount:
      rows.length,

    totalPremium,

    byCompany:
      Array.from(
        byCompany.entries(),
      )
        .map(
          ([
            name,
            value,
          ]) => ({
            name,
            ...value,
          }),
        )
        .sort(
          (a, b) =>
            b.premium -
            a.premium,
        ),

    byResponsible:
      Array.from(
        byResponsible.entries(),
      )
        .map(
          ([
            name,
            value,
          ]) => ({
            name,
            ...value,
          }),
        )
        .sort(
          (a, b) =>
            b.premium -
            a.premium,
        ),
  };
}

export async function compareProductionPeriods(
  context: AiUserContext,
  args: {
    firstFrom: string;
    firstTo: string;
    secondFrom: string;
    secondTo: string;
  },
) {
  const first =
    await getProductionSummary(
      context,
      {
        from:
          args.firstFrom,
        to:
          args.firstTo,
      },
    );

  const second =
    await getProductionSummary(
      context,
      {
        from:
          args.secondFrom,
        to:
          args.secondTo,
      },
    );

  return {
    first,
    second,

    difference: {
      policies:
        first.policyCount -
        second.policyCount,

      premium:
        first.totalPremium -
        second.totalPremium,
    },
  };
}