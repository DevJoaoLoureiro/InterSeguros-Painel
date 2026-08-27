import type {
  AiUserContext,
} from "@/lib/ai/context";

// ==========================================
// APÓLICES EMITIDAS HOJE
// ==========================================

export async function getPoliciesIssuedToday(
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
        product_name,
        line_name,
        premium,
        issue_date,
        start_date,
        end_date,
        renew_date,
        responsible_name,
        assigned_user_id,
        status
      `)
      .eq(
        "issue_date",
        context.today,
      )
      .order(
        "issue_date",
        {
          ascending: false,
        },
      );

  // Restringir à loja atual
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
      `Erro ao consultar apólices de hoje: ${error.message}`,
    );
  }

  return {
    date:
      context.today,

    count:
      data?.length ?? 0,

    policies:
      data ?? [],
  };
}

// ==========================================
// APÓLICES EMITIDAS NUMA DATA
// ==========================================

export async function getPoliciesByDate(
  context: AiUserContext,
  args: {
    date: string;
  },
) {
  const date =
    args.date.trim();

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      date,
    )
  ) {
    throw new Error(
      "Data inválida. Usa o formato YYYY-MM-DD.",
    );
  }

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
        premium,
        issue_date,
        start_date,
        end_date,
        renew_date,
        responsible_name,
        assigned_user_id,
        status
      `)
      .eq(
        "issue_date",
        date,
      )
      .order(
        "issue_date",
        {
          ascending: false,
        },
      );

  // Restringir à loja atual
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
      `Erro ao consultar apólices de ${date}: ${error.message}`,
    );
  }

  return {
    date,

    count:
      data?.length ?? 0,

    policies:
      data ?? [],
  };
}