import type { AiUserContext } from "@/lib/ai/context";

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

type NormalizedPolicy = {
  id: string;
  policy_number: string;
  company_name: string | null;
  product_name: string | null;
  line_name: string | null;
  issue_date: string | null;
  start_date: string | null;
  end_date: string | null;
  renew_date: string | null;
  premium: number;
  status: string;
  responsible_name: string | null;
};

export async function getClient360(
  context: AiUserContext,
  args: { clientId: string },
) {
  const clientId = args.clientId.trim();

  if (!clientId) {
    throw new Error("clientId obrigatório.");
  }

  // ==========================================
  // CLIENTE
  // ==========================================

  const { data: client, error: clientError } = await context.supabase
    .from("clients")
    .select(`
      id,
      name,
      nif,
      email,
      phone,
      birth_date,
      city,
      street
    `)
    .eq("id", clientId)
    .maybeSingle();

  if (clientError) {
    throw new Error(`Erro ao consultar cliente: ${clientError.message}`);
  }

  if (!client) {
    return { found: false, reason: "Cliente não encontrado." };
  }

  // ==========================================
  // APÓLICES VISÍVEIS
  // ==========================================

  let policiesQuery = context.supabase
    .from("policies")
    .select(`
      id,
      policy_number,
      product_name,
      issue_date,
      start_date,
      end_date,
      renewal_date,
      annualized_premium,
      status,
      company:companies ( name ),
      insurance_line:insurance_lines ( name ),
      commercial_user:profiles!policies_commercial_user_id_fkey ( full_name )
    `)
    .eq("client_id", clientId)
    .order("renewal_date", { ascending: true, nullsFirst: false });

  if (context.storeId) {
    policiesQuery = policiesQuery.eq("issuing_store_id", context.storeId);
  }

  const { data: policiesData, error: policiesError } = await policiesQuery;

  if (policiesError) {
    throw new Error(
      `Erro ao consultar apólices do cliente: ${policiesError.message}`,
    );
  }

  const policies: NormalizedPolicy[] = (policiesData ?? []).map(
    (row: any) => ({
      id: row.id,
      policy_number: row.policy_number,
      company_name: firstRelation(row.company)?.name ?? null,
      product_name: row.product_name,
      line_name: firstRelation(row.insurance_line)?.name ?? null,
      issue_date: row.issue_date,
      start_date: row.start_date,
      end_date: row.end_date,
      renew_date: row.renewal_date,
      premium:
        row.annualized_premium === null ? 0 : Number(row.annualized_premium),
      status: row.status,
      responsible_name: firstRelation(row.commercial_user)?.full_name ?? null,
    }),
  );

  // Se o utilizador não consegue ver nenhuma
  // apólice deste cliente, não expomos o cliente.
  if (policies.length === 0) {
    return {
      found: false,
      reason: "Cliente não encontrado na carteira acessível.",
    };
  }

  // ==========================================
  // TOTAIS
  // ==========================================

  const totalPremium = policies.reduce((total, p) => total + p.premium, 0);

  const premiums = [...policies].sort((a, b) => b.premium - a.premium);
  const highestPremiumPolicy = premiums[0] ?? null;

  // ==========================================
  // COMPANHIAS / RAMOS / RESPONSÁVEIS
  // ==========================================

  const companies = Array.from(
    new Set(policies.map((p) => p.company_name).filter(Boolean)),
  ) as string[];

  const lines = Array.from(
    new Set(policies.map((p) => p.line_name).filter(Boolean)),
  ) as string[];

  const responsibles = Array.from(
    new Set(policies.map((p) => p.responsible_name).filter(Boolean)),
  ) as string[];

  // ==========================================
  // PRÓXIMA RENOVAÇÃO
  // ==========================================

  const upcomingRenewals = policies
    .filter((p) => p.renew_date && p.renew_date >= context.today)
    .sort((a, b) => String(a.renew_date).localeCompare(String(b.renew_date)));

  const nextRenewal = upcomingRenewals[0] ?? null;

  // ==========================================
  // RESULTADO
  // ==========================================

  return {
    found: true,

    client: {
      id: client.id,
      name: client.name,
      nif: client.nif,
      email: client.email,
      phone: client.phone,
      birthDate: client.birth_date,
      city: client.city,
      street: client.street,
    },

    portfolio: {
      policyCount: policies.length,
      totalPremium,
      averagePremium:
        policies.length > 0 ? totalPremium / policies.length : 0,
      companyCount: companies.length,
      companies,
      lines,
      responsibles,
    },

    nextRenewal,
    highestPremiumPolicy,
    policies,
  };
}