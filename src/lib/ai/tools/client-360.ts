import type {
  AiUserContext,
} from "@/lib/ai/context";

type ClientRow = {
  id: string;
  name: string;
  nif: string | null;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  city: string | null;
  street: string | null;
};

type PolicyRow = {
  id: string;
  policy_number: string;
  company_name: string | null;
  product_name: string | null;
  line_name: string | null;
  issue_date: string | null;
  start_date: string | null;
  end_date: string | null;
  renew_date: string | null;
  premium: number | null;
  status: number | null;
  responsible_name: string | null;
  assigned_user_id: string | null;
};

export async function getClient360(
  context: AiUserContext,
  args: {
    clientId: string;
  },
) {
  const clientId =
    args.clientId.trim();

  if (!clientId) {
    throw new Error(
      "clientId obrigatório.",
    );
  }

  // ==========================================
  // CLIENTE
  // ==========================================

  const {
    data: clientData,
    error: clientError,
  } = await context.supabase
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
    .eq(
      "id",
      clientId,
    )
    .maybeSingle();

  if (clientError) {
    throw new Error(
      `Erro ao consultar cliente: ${clientError.message}`,
    );
  }

  if (!clientData) {
    return {
      found: false,
      reason:
        "Cliente não encontrado.",
    };
  }

  const client =
    clientData as ClientRow;

  // ==========================================
  // APÓLICES VISÍVEIS
  // ==========================================

  let policiesQuery =
    context.supabase
      .from("policies")
      .select(`
        id,
        policy_number,
        company_name,
        product_name,
        line_name,
        issue_date,
        start_date,
        end_date,
        renew_date,
        premium,
        status,
        responsible_name,
        assigned_user_id
      `)
      .eq(
        "client_id",
        clientId,
      )
      .order(
        "renew_date",
        {
          ascending: true,
          nullsFirst: false,
        },
      );

  // Respeitar a loja atual
  if (context.storeId) {
    policiesQuery =
      policiesQuery.eq(
        "store_id",
        context.storeId,
      );
  }

  const {
    data: policiesData,
    error: policiesError,
  } = await policiesQuery;

  if (policiesError) {
    throw new Error(
      `Erro ao consultar apólices do cliente: ${policiesError.message}`,
    );
  }

  const policies =
    (policiesData ??
      []) as PolicyRow[];

  // Se o utilizador não consegue ver nenhuma
  // apólice deste cliente, não expomos o cliente.
  if (policies.length === 0) {
    return {
      found: false,
      reason:
        "Cliente não encontrado na carteira acessível.",
    };
  }

  // ==========================================
  // TOTAIS
  // ==========================================

  const totalPremium =
    policies.reduce(
      (total, policy) =>
        total +
        Number(
          policy.premium ?? 0,
        ),
      0,
    );

  const premiums =
    policies
      .map((policy) => ({
        policy,
        premium:
          Number(
            policy.premium ?? 0,
          ),
      }))
      .sort(
        (a, b) =>
          b.premium -
          a.premium,
      );

  const highestPremiumPolicy =
    premiums[0]?.policy ??
    null;

  // ==========================================
  // COMPANHIAS
  // ==========================================

  const companies =
    Array.from(
      new Set(
        policies
          .map(
            (policy) =>
              policy.company_name,
          )
          .filter(
            (
              value,
            ): value is string =>
              Boolean(value),
          ),
      ),
    );

  // ==========================================
  // RAMOS
  // ==========================================

  const lines =
    Array.from(
      new Set(
        policies
          .map(
            (policy) =>
              policy.line_name,
          )
          .filter(
            (
              value,
            ): value is string =>
              Boolean(value),
          ),
      ),
    );

  // ==========================================
  // PRÓXIMA RENOVAÇÃO
  // ==========================================

  const upcomingRenewals =
    policies
      .filter(
        (policy) =>
          policy.renew_date &&
          policy.renew_date >=
            context.today,
      )
      .sort((a, b) =>
        String(
          a.renew_date,
        ).localeCompare(
          String(
            b.renew_date,
          ),
        ),
      );

  const nextRenewal =
    upcomingRenewals[0] ??
    null;

  // ==========================================
  // RESPONSÁVEIS
  // ==========================================

  const responsibles =
    Array.from(
      new Set(
        policies
          .map(
            (policy) =>
              policy.responsible_name,
          )
          .filter(
            (
              value,
            ): value is string =>
              Boolean(value),
          ),
      ),
    );

  // ==========================================
  // RESULTADO
  // ==========================================

  return {
    found: true,

    client: {
      id:
        client.id,

      name:
        client.name,

      nif:
        client.nif,

      email:
        client.email,

      phone:
        client.phone,

      birthDate:
        client.birth_date,

      city:
        client.city,

      street:
        client.street,
    },

    portfolio: {
      policyCount:
        policies.length,

      totalPremium,

      averagePremium:
        policies.length > 0
          ? totalPremium /
            policies.length
          : 0,

      companyCount:
        companies.length,

      companies,

      lines,

      responsibles,
    },

    nextRenewal,

    highestPremiumPolicy,

    policies,
  };
}