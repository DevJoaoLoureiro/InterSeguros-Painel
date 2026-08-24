import {
  Building2,
  CalendarDays,
  Car,
  CircleUserRound,
  CreditCard,
  FileText,
  ShieldCheck,
  Users,
} from "lucide-react";

import {
  createAdminClient,
} from "@/lib/supabase/admin";

import { cookies } from "next/headers";



type ClientRow = {
  id: string;
  source: string;
  external_id: string;
  name: string;
  nif: string | null;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  city: string | null;
  street: string | null;
  last_synced_at: string;
  created_at: string;
};

type PolicyRow = {
  id: string;
  source: string;
  external_id: string;
  client_id: string;

  responsible_name: string | null;
  assigned_user_id: string | null;
  store_id: string | null;

  policy_number: string;

  company_external_id: string | null;
  company_name: string | null;

  product_external_id: string | null;
  product_name: string | null;

  line_external_id: string | null;
  line_name: string | null;

  issue_date: string | null;
  start_date: string | null;
  end_date: string | null;
  renew_date: string | null;

  premium: number | null;

  fraction_type: number | null;
  status: number | null;

  last_synced_at: string;
  created_at: string;
};

type ProfileRow = {
  id: string;
  full_name: string;
  store_id: string | null;
};

function formatDate(
  value: string | null | undefined,
) {
  if (!value) {
    return "—";
  }

  const date =
    new Date(
      `${value.slice(0, 10)}T12:00:00`,
    );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "pt-PT",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    },
  ).format(date);
}

function formatCurrency(
  value: number | null | undefined,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "—";
  }

  return new Intl.NumberFormat(
    "pt-PT",
    {
      style: "currency",
      currency: "EUR",
    },
  ).format(value);
}

function getFractionLabel(
  fractionType:
    | number
    | null,
) {
  const labels: Record<
    number,
    string
  > = {
    0: "Anual",
    1: "Semestral",
    2: "Trimestral",
    3: "Mensal",
  };

  if (
    fractionType === null
  ) {
    return "—";
  }

  return (
    labels[fractionType] ??
    `Tipo ${fractionType}`
  );
}

export default async function ClientsPage() {

  
  const cookieStore =
  await cookies();

const selectedStoreId =
  cookieStore.get(
    "selected_store_id",
  )?.value ?? null;

  const supabase =
    createAdminClient();
let policiesQuery = supabase
  .from("policies")
  .select("*");

if (
  selectedStoreId &&
  selectedStoreId !== "all"
) {
  policiesQuery =
    policiesQuery.eq(
      "store_id",
      selectedStoreId,
    );
}

const [
  clientsResult,
  policiesResult,
  profilesResult,
] = await Promise.all([
  supabase
    .from("clients")
    .select("*")
    .order(
      "name",
      {
        ascending: true,
      },
    ),

  policiesQuery.order(
    "issue_date",
    {
      ascending: false,
    },
  ),

  supabase
    .from("profiles")
    .select(`
      id,
      full_name,
      store_id
    `)
    .order(
      "full_name",
      {
        ascending: true,
      },
    ),
]);

  if (clientsResult.error) {
    throw new Error(
      `Erro ao carregar clientes: ${clientsResult.error.message}`,
    );
  }

  if (policiesResult.error) {
    throw new Error(
      `Erro ao carregar apólices: ${policiesResult.error.message}`,
    );
  }

  if (profilesResult.error) {
    throw new Error(
      `Erro ao carregar utilizadores: ${profilesResult.error.message}`,
    );
  }

  const clients =
    (clientsResult.data ??
      []) as ClientRow[];

  const policies =
    (policiesResult.data ??
      []) as PolicyRow[];

  const profiles =
    (profilesResult.data ??
      []) as ProfileRow[];

  const profilesById =
    new Map(
      profiles.map(
        (profile) => [
          profile.id,
          profile,
        ],
      ),
    );

    const visibleClientIds =
  new Set(
    policies.map(
      (policy) =>
        policy.client_id,
    ),
  );

const visibleClients =
  clients.filter(
    (client) =>
      visibleClientIds.has(
        client.id,
      ),
  );

  const policiesByClient =
    new Map<
      string,
      PolicyRow[]
    >();

  for (
    const policy
    of policies
  ) {
    const current =
      policiesByClient.get(
        policy.client_id,
      ) ?? [];

    current.push(policy);

    policiesByClient.set(
      policy.client_id,
      current,
    );
  }

  const totalPremium =
    policies.reduce(
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

  const today =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Europe/Lisbon",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      },
    ).format(
      new Date(),
    );

  const policiesToday =
    policies.filter(
      (policy) =>
        policy.issue_date ===
        today,
    );

  const companies =
    new Set(
      policies
        .map(
          (policy) =>
            policy.company_name,
        )
        .filter(Boolean),
    );

  return (
    <div className="space-y-6">
      {/* HEADER */}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-[#ff4b0a]">
            Carteira
          </p>

          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
            Clientes
          </h1>

          <p className="mt-1 text-sm text-[#707782]">
            Clientes e apólices
            sincronizados com a
            Libax.
          </p>
        </div>

        <div className="inline-flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2 text-sm font-medium text-green-700">
          <ShieldCheck className="h-4 w-4" />

          Sincronização Libax ativa
        </div>
      </div>

      {/* CARDS */}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[#737a84]">
              Clientes
            </p>

            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50">
              <Users className="h-5 w-5 text-[#ff4b0a]" />
            </div>
          </div>

          <p className="mt-4 text-3xl font-semibold tracking-tight text-[#17191d]">
            {visibleClients.length}
          </p>

          <p className="mt-1 text-xs text-[#8a9099]">
            Na carteira
          </p>
        </div>

        <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[#737a84]">
              Apólices
            </p>

            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
              <FileText className="h-5 w-5 text-blue-600" />
            </div>
          </div>

          <p className="mt-4 text-3xl font-semibold tracking-tight text-[#17191d]">
            {policies.length}
          </p>

          <p className="mt-1 text-xs text-[#8a9099]">
            Importadas
          </p>
        </div>

        <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[#737a84]">
              Emitidas hoje
            </p>

            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-50">
              <CalendarDays className="h-5 w-5 text-green-600" />
            </div>
          </div>

          <p className="mt-4 text-3xl font-semibold tracking-tight text-[#17191d]">
            {
              policiesToday.length
            }
          </p>

          <p className="mt-1 text-xs text-[#8a9099]">
            Produção de hoje
          </p>
        </div>

        <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[#737a84]">
              Prémio
            </p>

            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50">
              <CreditCard className="h-5 w-5 text-violet-600" />
            </div>
          </div>

          <p className="mt-4 text-2xl font-semibold tracking-tight text-[#17191d]">
            {formatCurrency(
              totalPremium,
            )}
          </p>

          <p className="mt-1 text-xs text-[#8a9099]">
            Total registado
          </p>
        </div>
      </section>

      {/* CARTEIRA */}

      <section className="overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        <div className="flex items-center justify-between border-b border-[#edf0f2] px-5 py-4">
          <div>
            <h2 className="font-semibold text-[#20242a]">
              Carteira de clientes
            </h2>

            <p className="mt-1 text-sm text-[#7d848e]">
              Clientes e respetivas
              apólices.
            </p>
          </div>

          <div className="hidden text-sm text-[#7d848e] sm:block">
            {
              companies.size
            }{" "}
            companhias
          </div>
        </div>

        {visibleClients.length ===
        0 ? (
          <div className="px-5 py-16 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f5f6f7]">
              <CircleUserRound className="h-6 w-6 text-[#7d848e]" />
            </div>

            <h3 className="mt-4 font-semibold text-[#20242a]">
              Ainda não existem
              clientes
            </h3>

            <p className="mt-1 text-sm text-[#7d848e]">
              Os clientes importados
              da Libax irão aparecer
              aqui.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#edf0f2]">
            {visibleClients.map(
              (client) => {
                const clientPolicies =
                  policiesByClient.get(
                    client.id,
                  ) ?? [];

                return (
                  <article
                    key={
                      client.id
                    }
                    className="p-5 transition hover:bg-[#fafbfc]"
                  >
                    <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                      {/* CLIENTE */}

                      <div className="min-w-0 xl:w-[30%]">
                        <div className="flex items-start gap-3">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50">
                            <CircleUserRound className="h-5 w-5 text-[#ff4b0a]" />
                          </div>

                          <div className="min-w-0">
                            <h3 className="truncate font-semibold text-[#20242a]">
                              {
                                client.name
                              }
                            </h3>

                            <p className="mt-1 text-sm text-[#7d848e]">
                              NIF{" "}
                              {client.nif ??
                                "—"}
                            </p>

                            <p className="mt-1 text-xs text-[#a0a5ac]">
                              ID Libax:{" "}
                              {
                                client.external_id
                              }
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* APÓLICES */}

                      <div className="min-w-0 flex-1">
                        {clientPolicies.length >
                        0 ? (
                          <div className="space-y-3">
                            {clientPolicies.map(
                              (
                                policy,
                              ) => {
                                const assignedProfile =
                                  policy.assigned_user_id
                                    ? profilesById.get(
                                        policy.assigned_user_id,
                                      )
                                    : undefined;

                                return (
                                  <div
                                    key={
                                      policy.id
                                    }
                                    className="grid gap-4 rounded-xl border border-[#e8eaed] bg-[#fafbfc] p-4 md:grid-cols-2 xl:grid-cols-[1.2fr_1.2fr_0.8fr_0.9fr_1fr]"
                                  >
                                    {/* COMPANHIA */}

                                    <div>
                                      <div className="flex items-center gap-2 text-xs font-medium text-[#8a9099]">
                                        <Building2 className="h-3.5 w-3.5" />

                                        Companhia
                                      </div>

                                      <p className="mt-1 text-sm font-semibold text-[#20242a]">
                                        {policy.company_name ??
                                          "—"}
                                      </p>

                                      <p className="mt-1 text-xs text-[#7d848e]">
                                        Apólice{" "}
                                        {
                                          policy.policy_number
                                        }
                                      </p>
                                    </div>

                                    {/* PRODUTO */}

                                    <div>
                                      <div className="flex items-center gap-2 text-xs font-medium text-[#8a9099]">
                                        <Car className="h-3.5 w-3.5" />

                                        Seguro
                                      </div>

                                      <p className="mt-1 text-sm font-semibold text-[#20242a]">
                                        {policy.line_name ??
                                          policy.product_name ??
                                          "—"}
                                      </p>

                                      <p className="mt-1 truncate text-xs text-[#7d848e]">
                                        {policy.product_name ??
                                          "—"}
                                      </p>
                                    </div>

                                    {/* PRÉMIO */}

                                    <div>
                                      <p className="text-xs font-medium text-[#8a9099]">
                                        Prémio
                                      </p>

                                      <p className="mt-1 text-sm font-semibold text-[#20242a]">
                                        {formatCurrency(
                                          policy.premium,
                                        )}
                                      </p>

                                      <p className="mt-1 text-xs text-[#7d848e]">
                                        {getFractionLabel(
                                          policy.fraction_type,
                                        )}
                                      </p>
                                    </div>

                                    {/* DATAS */}

                                    <div>
                                      <p className="text-xs font-medium text-[#8a9099]">
                                        Emissão
                                      </p>

                                      <p className="mt-1 text-sm font-semibold text-[#20242a]">
                                        {formatDate(
                                          policy.issue_date,
                                        )}
                                      </p>

                                      <p className="mt-1 text-xs text-[#7d848e]">
                                        Renova{" "}
                                        {formatDate(
                                          policy.renew_date,
                                        )}
                                      </p>
                                    </div>

                                    {/* RESPONSÁVEL */}

                                    <div>
                                      <p className="text-xs font-medium text-[#8a9099]">
                                        Responsável
                                      </p>

                                      {assignedProfile ? (
                                        <>
                                          <p className="mt-1 text-sm font-semibold text-[#20242a]">
                                            {
                                              assignedProfile.full_name
                                            }
                                          </p>

                                          <p className="mt-1 text-xs text-[#7d848e]">
                                            {policy.responsible_name
                                              ? `${policy.responsible_name} · Libax`
                                              : "Associado ao painel"}
                                          </p>
                                        </>
                                      ) : policy.responsible_name ? (
                                        <>
                                          <p className="mt-1 text-sm font-semibold text-amber-700">
                                            {
                                              policy.responsible_name
                                            }
                                          </p>

                                          <p className="mt-1 text-xs font-medium text-amber-600">
                                            Por associar ao painel
                                          </p>
                                        </>
                                      ) : (
                                        <>
                                          <p className="mt-1 text-sm font-semibold text-[#20242a]">
                                            Sem responsável
                                          </p>

                                          <p className="mt-1 text-xs text-[#7d848e]">
                                            Não definido na Libax
                                          </p>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                );
                              },
                            )}
                          </div>
                        ) : (
                          <div className="rounded-xl border border-dashed border-[#dfe2e6] px-4 py-5 text-sm text-[#7d848e]">
                            Este cliente ainda
                            não tem apólices
                            associadas.
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              },
            )}
          </div>
        )}
      </section>
    </div>
  );
}