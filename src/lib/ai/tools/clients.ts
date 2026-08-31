import type { AiUserContext } from "@/lib/ai/context";

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

type SearchClientArgs = {
  search: string;
};

export async function searchClient(
  context: AiUserContext,
  args: SearchClientArgs,
) {
  const search = args.search.trim();

  if (!search) {
    return { clients: [] };
  }

  const normalized = search.toLowerCase();

  // ==========================================
  // 1. PROCURAR CLIENTES
  // ==========================================

  const { data: clients, error: clientsError } = await context.supabase
    .from("clients")
    .select(`
      id,
      name,
      nif,
      email,
      phone
    `)
    .or(
      [
        `name.ilike.%${search}%`,
        `nif.ilike.%${search}%`,
        `email.ilike.%${search}%`,
        `phone.ilike.%${search}%`,
      ].join(","),
    )
    .limit(20);

  if (clientsError) {
    throw new Error(`Erro ao procurar cliente: ${clientsError.message}`);
  }

  if (!clients?.length) {
    return { clients: [] };
  }

  // ==========================================
  // 2. FILTRAR CLIENTES PELAS APÓLICES
  // VISÍVEIS AO UTILIZADOR
  // ==========================================

  const clientIds = clients.map((client) => client.id);

  let policiesQuery = context.supabase
    .from("policies")
    .select("client_id")
    .in("client_id", clientIds);

  if (context.storeId) {
    policiesQuery = policiesQuery.eq("issuing_store_id", context.storeId);
  }

  const { data: visiblePolicies, error: policiesError } =
    await policiesQuery;

  if (policiesError) {
    throw new Error(
      `Erro ao validar carteira do cliente: ${policiesError.message}`,
    );
  }

  const visibleClientIds = new Set(
    (visiblePolicies ?? []).map((policy) => policy.client_id),
  );

  const visibleClients = clients
    .filter((client) => visibleClientIds.has(client.id))
    .sort((a, b) => {
      const aName = a.name?.toLowerCase() ?? "";
      const bName = b.name?.toLowerCase() ?? "";

      const aExact = aName === normalized ? 1 : 0;
      const bExact = bName === normalized ? 1 : 0;

      return bExact - aExact;
    })
    .slice(0, 10);

  return { clients: visibleClients };
}

type GetClientPoliciesArgs = {
  clientId: string;
};

export async function getClientPolicies(
  context: AiUserContext,
  args: GetClientPoliciesArgs,
) {
  const { clientId } = args;

  let query = context.supabase
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
      payment_frequency,
      status,
      commercial_user_id,
      issuing_store_id,
      company:companies ( name ),
      insurance_line:insurance_lines ( name ),
      commercial_user:profiles!policies_commercial_user_id_fkey ( full_name )
    `)
    .eq("client_id", clientId)
    .order("issue_date", { ascending: false });

  if (context.storeId) {
    query = query.eq("issuing_store_id", context.storeId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Erro ao carregar apólices do cliente: ${error.message}`);
  }

  const policies = (data ?? []).map((row: any) => {
    const company = firstRelation(row.company);
    const line = firstRelation(row.insurance_line);
    const commercialUser = firstRelation(row.commercial_user);

    return {
      id: row.id,
      policy_number: row.policy_number,
      company_name: company?.name ?? null,
      product_name: row.product_name,
      line_name: line?.name ?? null,
      issue_date: row.issue_date,
      start_date: row.start_date,
      end_date: row.end_date,
      renewal_date: row.renewal_date,
      annualized_premium:
        row.annualized_premium === null
          ? null
          : Number(row.annualized_premium),
      payment_frequency: row.payment_frequency,
      status: row.status,
      responsible_name: commercialUser?.full_name ?? null,
      commercial_user_id: row.commercial_user_id,
    };
  });

  return {
    clientId,
    count: policies.length,
    policies,
  };
}

export async function getClientDetails(
  context: AiUserContext,
  args: { clientId: string },
) {
  const { data, error } = await context.supabase
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
    .eq("id", args.clientId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return { found: false };
  }

  let visibilityQuery = context.supabase
    .from("policies")
    .select("id", { count: "exact", head: true })
    .eq("client_id", args.clientId);

  if (context.storeId) {
    visibilityQuery = visibilityQuery.eq(
      "issuing_store_id",
      context.storeId,
    );
  }

  const { count, error: visibilityError } = await visibilityQuery;

  if (visibilityError) {
    throw new Error(visibilityError.message);
  }

  if (!count) {
    return { found: false };
  }

  return {
    found: true,
    client: data,
  };
}