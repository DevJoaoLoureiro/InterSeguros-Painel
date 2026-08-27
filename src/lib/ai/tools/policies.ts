import type {
  AiUserContext,
} from "@/lib/ai/context";

type PolicyFilters = {
  from?: string | null;
  to?: string | null;
  company?: string | null;
  responsibleId?: string | null;
  clientId?: string | null;
  status?: number | null;
};

function applyPolicyVisibility(
  query: any,
  context: AiUserContext,
) {
  if (context.storeId) {
    query = query.eq(
      "store_id",
      context.storeId,
    );
  }

  return query;
}

export async function getPoliciesByDate(
  context: AiUserContext,
  args: {
    date: string;
  },
) {
  let query =
    context.supabase
      .from("policies")
      .select(`
        id,
        client_id,
        policy_number,
        company_name,
        product_name,
        line_name,
        issue_date,
        start_date,
        end_date,
        renew_date,
        premium,
        fraction_type,
        status,
        responsible_name,
        assigned_user_id
      `)
      .eq(
        "issue_date",
        args.date,
      );

  query =
    applyPolicyVisibility(
      query,
      context,
    );

  const {
    data,
    error,
  } = await query;

  if (error) {
    throw new Error(
      error.message,
    );
  }

  return {
    date:
      args.date,

    count:
      data?.length ?? 0,

    policies:
      data ?? [],
  };
}

export async function getPoliciesByPeriod(
  context: AiUserContext,
  args: {
    from: string;
    to: string;
    company?: string | null;
    responsibleId?: string | null;
  },
) {
  let query =
    context.supabase
      .from("policies")
      .select(`
        id,
        client_id,
        policy_number,
        company_name,
        product_name,
        line_name,
        issue_date,
        renew_date,
        premium,
        responsible_name,
        assigned_user_id
      `)
      .gte(
        "issue_date",
        args.from,
      )
      .lte(
        "issue_date",
        args.to,
      );

  query =
    applyPolicyVisibility(
      query,
      context,
    );

  if (args.company) {
    query =
      query.eq(
        "company_name",
        args.company,
      );
  }

  if (args.responsibleId) {
    query =
      query.eq(
        "assigned_user_id",
        args.responsibleId,
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

  const totalPremium =
    (data ?? []).reduce(
      (
        total,
        policy,
      ) =>
        total +
        Number(
          policy.premium ?? 0,
        ),
      0,
    );

  return {
    from:
      args.from,

    to:
      args.to,

    count:
      data?.length ?? 0,

    totalPremium,

    policies:
      data ?? [],
  };
}

export async function getUpcomingRenewals(
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
        client_id,
        policy_number,
        company_name,
        product_name,
        renew_date,
        premium,
        responsible_name
      `)
      .gte(
        "renew_date",
        args.from,
      )
      .lte(
        "renew_date",
        args.to,
      )
      .order(
        "renew_date",
        {
          ascending: true,
        },
      );

  query =
    applyPolicyVisibility(
      query,
      context,
    );

  const {
    data,
    error,
  } = await query;

  if (error) {
    throw new Error(
      error.message,
    );
  }

  return {
    from:
      args.from,

    to:
      args.to,

    count:
      data?.length ?? 0,

    policies:
      data ?? [],
  };
}

export async function getUnassignedPolicies(
  context: AiUserContext,
) {
  let query =
    context.supabase
      .from("policies")
      .select(`
        id,
        client_id,
        policy_number,
        company_name,
        issue_date,
        responsible_name,
        responsible_pending
      `)
      .eq(
        "responsible_pending",
        true,
      );

  query =
    applyPolicyVisibility(
      query,
      context,
    );

  const {
    data,
    error,
  } = await query;

  if (error) {
    throw new Error(
      error.message,
    );
  }

  return {
    count:
      data?.length ?? 0,

    policies:
      data ?? [],
  };
}