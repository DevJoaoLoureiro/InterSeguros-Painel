import type { AiUserContext } from "@/lib/ai/context";

const POLICY_SELECT = `
  id,
  client_id,
  policy_number,
  product_name,
  issue_date,
  start_date,
  end_date,
  renewal_date,
  annualized_premium,
  status,
  commercial_user_id,
  issuing_store_id,
  company:companies ( name ),
  insurance_line:insurance_lines ( name ),
  commercial_user:profiles!policies_commercial_user_id_fkey ( full_name )
`;

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function normalizePolicyRow(row: any) {
  const company = firstRelation(row.company);
  const line = firstRelation(row.insurance_line);
  const commercialUser = firstRelation(row.commercial_user);

  return {
    id: row.id,
    client_id: row.client_id,
    policy_number: row.policy_number,
    company_name: company?.name ?? null,
    product_name: row.product_name,
    line_name: line?.name ?? null,
    premium:
      row.annualized_premium === null ? null : Number(row.annualized_premium),
    issue_date: row.issue_date,
    start_date: row.start_date,
    end_date: row.end_date,
    renew_date: row.renewal_date,
    responsible_name: commercialUser?.full_name ?? null,
    commercial_user_id: row.commercial_user_id,
    status: row.status,
  };
}

// ==========================================
// APÓLICES EMITIDAS HOJE
// ==========================================

export async function getPoliciesIssuedToday(context: AiUserContext) {
  let query = context.supabase
    .from("policies")
    .select(POLICY_SELECT)
    .eq("issue_date", context.today)
    .order("issue_date", { ascending: false });

  if (context.storeId) {
    query = query.eq("issuing_store_id", context.storeId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Erro ao consultar apólices de hoje: ${error.message}`);
  }

  const policies = (data ?? []).map(normalizePolicyRow);

  return {
    date: context.today,
    count: policies.length,
    policies,
  };
}

// ==========================================
// APÓLICES EMITIDAS NUMA DATA
// ==========================================

export async function getPoliciesByDate(
  context: AiUserContext,
  args: { date: string },
) {
  const date = args.date.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Data inválida. Usa o formato YYYY-MM-DD.");
  }

  let query = context.supabase
    .from("policies")
    .select(POLICY_SELECT)
    .eq("issue_date", date)
    .order("issue_date", { ascending: false });

  if (context.storeId) {
    query = query.eq("issuing_store_id", context.storeId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Erro ao consultar apólices de ${date}: ${error.message}`);
  }

  const policies = (data ?? []).map(normalizePolicyRow);

  return {
    date,
    count: policies.length,
    policies,
  };
}