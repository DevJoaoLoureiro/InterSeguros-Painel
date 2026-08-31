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
  payment_frequency,
  status,
  commercial_user_id,
  issuing_store_id,
  company:companies ( name ),
  insurance_line:insurance_lines ( name ),
  commercial_user:profiles!policies_commercial_user_id_fkey ( full_name )
`;

function applyPolicyVisibility(query: any, context: AiUserContext) {
  if (context.storeId) {
    query = query.eq("issuing_store_id", context.storeId);
  }

  return query;
}

/*
 * Resolve o id da companhia a partir de um nome/código
 * fornecido pelo agente. Não assume — se não encontrar,
 * devolve null e a tool simplesmente não filtra por
 * companhia (evita filtrar por um id inexistente).
 */
async function resolveCompanyId(
  context: AiUserContext,
  companyName: string | null | undefined,
): Promise<string | null> {
  if (!companyName) {
    return null;
  }

  const { data } = await context.supabase
    .from("companies")
    .select("id")
    .or(`name.ilike.%${companyName}%,code.ilike.%${companyName}%`)
    .limit(1)
    .maybeSingle();

  return data?.id ?? null;
}

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
    issue_date: row.issue_date,
    start_date: row.start_date,
    end_date: row.end_date,
    renewal_date: row.renewal_date,
    annualized_premium:
      row.annualized_premium === null ? null : Number(row.annualized_premium),
    payment_frequency: row.payment_frequency,
    status: row.status,
    responsible_name: commercialUser?.full_name ?? null,
    commercial_user_id: row.commercial_user_id,
  };
}

export async function getPoliciesByDate(
  context: AiUserContext,
  args: { date: string },
) {
  let query = context.supabase
    .from("policies")
    .select(POLICY_SELECT)
    .eq("issue_date", args.date);

  query = applyPolicyVisibility(query, context);

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  const policies = (data ?? []).map(normalizePolicyRow);

  return {
    date: args.date,
    count: policies.length,
    policies,
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
  let query = context.supabase
    .from("policies")
    .select(POLICY_SELECT)
    .gte("issue_date", args.from)
    .lte("issue_date", args.to);

  query = applyPolicyVisibility(query, context);

  const companyId = await resolveCompanyId(context, args.company);

  if (companyId) {
    query = query.eq("company_id", companyId);
  }

  if (args.responsibleId) {
    query = query.eq("commercial_user_id", args.responsibleId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  const policies = (data ?? []).map(normalizePolicyRow);

  const totalPremium = policies.reduce(
    (total, policy) => total + (policy.annualized_premium ?? 0),
    0,
  );

  return {
    from: args.from,
    to: args.to,
    count: policies.length,
    totalPremium,
    policies,
  };
}

export async function getUpcomingRenewals(
  context: AiUserContext,
  args: { from: string; to: string },
) {
  let query = context.supabase
    .from("policies")
    .select(POLICY_SELECT)
    .gte("renewal_date", args.from)
    .lte("renewal_date", args.to)
    .order("renewal_date", { ascending: true });

  query = applyPolicyVisibility(query, context);

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  const policies = (data ?? []).map(normalizePolicyRow);

  return {
    from: args.from,
    to: args.to,
    count: policies.length,
    policies,
  };
}

export async function getUnassignedPolicies(context: AiUserContext) {
  let query = context.supabase
    .from("policies")
    .select(POLICY_SELECT)
    .is("commercial_user_id", null);

  query = applyPolicyVisibility(query, context);

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  const policies = (data ?? []).map(normalizePolicyRow);

  return {
    count: policies.length,
    policies,
  };
}