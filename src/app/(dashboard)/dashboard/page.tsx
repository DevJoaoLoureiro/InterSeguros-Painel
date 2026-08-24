import {
  ArrowUpRight,
  CalendarDays,
  CircleUserRound,
  FileCheck2,
  Users,
  WalletCards,
} from "lucide-react";

import {
  DashboardCharts,
} from "@/components/dashboard/dashboard-charts";

import {
  createAdminClient,
} from "@/lib/supabase/admin";

import { cookies } from "next/headers";

type LeadRow = {
  id: string;
  name: string;
  insurance_type: string | null;
  status: string;
  source: string | null;
  created_at: string;
  converted_at: string | null;
  store_id: string | null;
};

type ClientRow = {
  id: string;
  name: string;
  created_at: string;
};

type PolicyRow = {
  id: string;
  client_id: string;
  policy_number: string;

  company_name: string | null;
  product_name: string | null;
  line_name: string | null;

  issue_date: string | null;
  start_date: string | null;
  renew_date: string | null;

  premium: number | string | null;

  created_at: string;

  responsible_name: string | null;
  assigned_user_id: string | null;
  store_id: string | null;
};

function getPortugalDateKey(
  date = new Date(),
) {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Europe/Lisbon",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  ).format(date);
}

function formatCurrency(
  value: number,
) {
  return new Intl.NumberFormat(
    "pt-PT",
    {
      style: "currency",
      currency: "EUR",
    },
  ).format(value);
}

function formatDate(
  value: string | null,
) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "pt-PT",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    },
  ).format(
    new Date(
      `${value.slice(0, 10)}T12:00:00`,
    ),
  );
}

export default async function DashboardPage() {
  const cookieStore =
    await cookies();

  const selectedStoreId =
    cookieStore.get(
      "selected_store_id",
    )?.value ?? "all";

  const supabase =
    createAdminClient();

  // ========================================
  // QUERIES BASE
  // ========================================

  let leadsQuery = supabase
    .from("leads")
    .select(`
      id,
      name,
      insurance_type,
      status,
      source,
      store_id,
      created_at,
      converted_at
    `);

  let policiesQuery = supabase
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
      renew_date,
      premium,
      responsible_name,
      assigned_user_id,
      store_id,
      created_at
    `);

  // ========================================
  // FILTRO POR LOJA
  // ========================================

  if (
    selectedStoreId &&
    selectedStoreId !== "all"
  ) {
    leadsQuery =
      leadsQuery.eq(
        "store_id",
        selectedStoreId,
      );

    policiesQuery =
      policiesQuery.eq(
        "store_id",
        selectedStoreId,
      );
  }

  // ========================================
  // CARREGAR DADOS
  // ========================================

  const [
    leadsResult,
    clientsResult,
    policiesResult,
  ] = await Promise.all([
    leadsQuery.order(
      "created_at",
      {
        ascending: false,
      },
    ),

    supabase
      .from("clients")
      .select(`
        id,
        name,
        created_at
      `)
      .order(
        "created_at",
        {
          ascending: false,
        },
      ),

    policiesQuery.order(
      "issue_date",
      {
        ascending: false,
      },
    ),
  ]);

  if (leadsResult.error) {
    throw new Error(
      `Erro ao carregar leads: ${leadsResult.error.message}`,
    );
  }

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

  const leads =
    (leadsResult.data ?? []) as LeadRow[];

  const allClients =
    (clientsResult.data ?? []) as ClientRow[];

  const policies =
    (policiesResult.data ?? []) as PolicyRow[];

  // ========================================
  // CLIENTES VISÍVEIS DA LOJA
  // ========================================

  const visibleClientIds =
    new Set(
      policies.map(
        (policy) =>
          policy.client_id,
      ),
    );

  const clients =
    selectedStoreId === "all"
      ? allClients
      : allClients.filter(
          (client) =>
            visibleClientIds.has(
              client.id,
            ),
        );

  const today =
    getPortugalDateKey();



  // ========================================
  // MÉTRICAS
  // ========================================

  const newLeads =
    leads.filter(
      (lead) =>
        lead.status === "nova",
    ).length;

  const convertedLeads =
    leads.filter(
      (lead) =>
        lead.status ===
          "convertida" ||
        Boolean(
          lead.converted_at,
        ),
    ).length;

  const policiesToday =
    policies.filter(
      (policy) =>
        policy.issue_date ===
        today,
    );

  const premiumToday =
    policiesToday.reduce(
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

  const conversionRate =
    leads.length > 0
      ? (
          (convertedLeads /
            leads.length) *
          100
        ).toFixed(1)
      : "0.0";

  // ========================================
  // ÚLTIMOS 30 DIAS
  // ========================================

  const last30Days = [];

  for (
    let i = 29;
    i >= 0;
    i--
  ) {
    const date =
      new Date();

    date.setDate(
      date.getDate() - i,
    );

    const key =
      getPortugalDateKey(
        date,
      );

    last30Days.push({
      date: key,
      label:
        new Intl.DateTimeFormat(
          "pt-PT",
          {
            day: "2-digit",
            month: "2-digit",
          },
        ).format(date),

      policies: 0,
      premium: 0,
    });
  }

  for (
    const policy
    of policies
  ) {
    if (!policy.issue_date) {
      continue;
    }

    const day =
      last30Days.find(
        (item) =>
          item.date ===
          policy.issue_date,
      );

    if (!day) {
      continue;
    }

    day.policies += 1;

    day.premium +=
      Number(
        policy.premium ?? 0,
      );
  }

  // ========================================
  // PRODUÇÃO POR COMPANHIA
  // ========================================

  const companyMap =
    new Map<
      string,
      {
        company: string;
        policies: number;
        premium: number;
      }
    >();

  for (
    const policy
    of policies
  ) {
    const company =
      policy.company_name ??
      "Sem companhia";

    const current =
      companyMap.get(
        company,
      ) ?? {
        company,
        policies: 0,
        premium: 0,
      };

    current.policies += 1;

    current.premium +=
      Number(
        policy.premium ?? 0,
      );

    companyMap.set(
      company,
      current,
    );
  }

  const companies =
    Array.from(
      companyMap.values(),
    )
      .sort(
        (a, b) =>
          b.premium -
          a.premium,
      )
      .slice(0, 8);

  // ========================================
  // LEADS POR ESTADO
  // ========================================

  const leadStatusMap =
    new Map<
      string,
      number
    >();

  for (
    const lead
    of leads
  ) {
    leadStatusMap.set(
      lead.status,
      (leadStatusMap.get(
        lead.status,
      ) ?? 0) + 1,
    );
  }

  const leadStatuses =
    Array.from(
      leadStatusMap.entries(),
    ).map(
      ([status, count]) => ({
        status,
        count,
      }),
    );

  // ========================================
  // RAMOS
  // ========================================

  const lineMap =
    new Map<
      string,
      number
    >();

  for (
    const policy
    of policies
  ) {
    const line =
      policy.line_name ??
      "Outros";

    lineMap.set(
      line,
      (lineMap.get(line) ??
        0) + 1,
    );
  }

  const lines =
    Array.from(
      lineMap.entries(),
    )
      .map(
        ([name, value]) => ({
          name,
          value,
        }),
      )
      .sort(
        (a, b) =>
          b.value - a.value,
      );

  // ========================================
  // CLIENTES PARA APÓLICES RECENTES
  // ========================================

  const clientMap =
    new Map(
      clients.map(
        (client) => [
          client.id,
          client.name,
        ],
      ),
    );

  const recentPolicies =
    policies
      .slice(0, 6)
      .map(
        (policy) => ({
          ...policy,

          clientName:
            clientMap.get(
              policy.client_id,
            ) ??
            "Cliente",
        }),
      );

  return (
    <div className="space-y-6">
      {/* HEADER */}

      <div>
        <p className="text-sm font-medium text-[#ff4b0a]">
          Visão geral
        </p>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
          Dashboard
        </h1>

        <p className="mt-1 text-sm text-[#737a84]">
          Dados comerciais,
          produção e carteira em
          tempo real.
        </p>
      </div>

      {/* MÉTRICAS */}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Leads novas"
          value={String(
            newLeads,
          )}
          description={`${leads.length} leads no total`}
          icon={
            <Users className="h-5 w-5" />
          }
        />

        <MetricCard
          label="Emitidas hoje"
          value={String(
            policiesToday.length,
          )}
          description={`${formatCurrency(
            premiumToday,
          )} em prémios`}
          icon={
            <FileCheck2 className="h-5 w-5" />
          }
        />

        <MetricCard
          label="Clientes"
          value={String(
            clients.length,
          )}
          description={`${policies.length} apólices na carteira`}
          icon={
            <CircleUserRound className="h-5 w-5" />
          }
        />

        <MetricCard
          label="Taxa conversão"
          value={`${conversionRate}%`}
          description={`${convertedLeads} leads convertidas`}
          icon={
            <ArrowUpRight className="h-5 w-5" />
          }
        />
      </section>

      {/* PRODUÇÃO */}

      <section className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold text-[#20242a]">
                Produção
              </h2>

              <p className="mt-1 text-sm text-[#7d848e]">
                Apólices emitidas
                nos últimos 30 dias.
              </p>
            </div>

            <div className="rounded-xl bg-[#f7f8f9] px-3 py-2 text-right">
              <p className="text-xs text-[#8a9099]">
                Prémio carteira
              </p>

              <p className="mt-0.5 text-sm font-semibold text-[#20242a]">
                {formatCurrency(
                  totalPremium,
                )}
              </p>
            </div>
          </div>

          <div className="mt-6">
            <DashboardCharts
              dailyProduction={
                last30Days
              }
              companies={
                companies
              }
              leadStatuses={
                leadStatuses
              }
              lines={lines}
              mode="production"
            />
          </div>
        </div>

        <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
          <h2 className="font-semibold text-[#20242a]">
            Produção por companhia
          </h2>

          <p className="mt-1 text-sm text-[#7d848e]">
            Prémios acumulados por
            seguradora.
          </p>

          <div className="mt-6">
            <DashboardCharts
              dailyProduction={
                last30Days
              }
              companies={
                companies
              }
              leadStatuses={
                leadStatuses
              }
              lines={lines}
              mode="companies"
            />
          </div>
        </div>
      </section>

      {/* LEADS + RAMOS */}

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
          <h2 className="font-semibold text-[#20242a]">
            Leads por estado
          </h2>

          <p className="mt-1 text-sm text-[#7d848e]">
            Distribuição atual do
            funil comercial.
          </p>

          <div className="mt-6">
            <DashboardCharts
              dailyProduction={
                last30Days
              }
              companies={
                companies
              }
              leadStatuses={
                leadStatuses
              }
              lines={lines}
              mode="leads"
            />
          </div>
        </div>

        <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
          <h2 className="font-semibold text-[#20242a]">
            Carteira por ramo
          </h2>

          <p className="mt-1 text-sm text-[#7d848e]">
            Distribuição das
            apólices por tipo de
            seguro.
          </p>

          <div className="mt-6">
            <DashboardCharts
              dailyProduction={
                last30Days
              }
              companies={
                companies
              }
              leadStatuses={
                leadStatuses
              }
              lines={lines}
              mode="lines"
            />
          </div>
        </div>
      </section>

      {/* APÓLICES RECENTES */}

      <section className="overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        <div className="flex items-center justify-between border-b border-[#edf0f2] px-5 py-4">
          <div>
            <h2 className="font-semibold text-[#20242a]">
              Últimas apólices
            </h2>

            <p className="mt-1 text-sm text-[#7d848e]">
              Produção mais recente
              importada da Libax.
            </p>
          </div>

          <CalendarDays className="h-5 w-5 text-[#a0a5ac]" />
        </div>

        {recentPolicies.length ===
        0 ? (
          <div className="px-5 py-14 text-center text-sm text-[#7d848e]">
            Ainda não existem
            apólices.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left">
              <thead className="bg-[#fafbfc]">
                <tr className="text-xs font-medium uppercase tracking-wide text-[#8a9099]">
                  <th className="px-5 py-3">
                    Cliente
                  </th>

                  <th className="px-5 py-3">
                    Apólice
                  </th>

                  <th className="px-5 py-3">
                    Companhia
                  </th>

                  <th className="px-5 py-3">
                    Ramo
                  </th>

                  <th className="px-5 py-3">
                    Prémio
                  </th>

                  <th className="px-5 py-3">
                    Emissão
                  </th>

                  <th className="px-5 py-3">
                    Renovação
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[#edf0f2]">
                {recentPolicies.map(
                  (policy) => (
                    <tr
                      key={
                        policy.id
                      }
                      className="text-sm"
                    >
                      <td className="px-5 py-4 font-medium text-[#20242a]">
                        {
                          policy.clientName
                        }
                      </td>

                      <td className="px-5 py-4 text-[#606771]">
                        {
                          policy.policy_number
                        }
                      </td>

                      <td className="px-5 py-4 text-[#606771]">
                        {policy.company_name ??
                          "—"}
                      </td>

                      <td className="px-5 py-4 text-[#606771]">
                        {policy.line_name ??
                          policy.product_name ??
                          "—"}
                      </td>

                      <td className="px-5 py-4 font-medium text-[#20242a]">
                        {formatCurrency(
                          Number(
                            policy.premium ??
                              0,
                          ),
                        )}
                      </td>

                      <td className="px-5 py-4 text-[#606771]">
                        {formatDate(
                          policy.issue_date,
                        )}
                      </td>

                      <td className="px-5 py-4 text-[#606771]">
                        {formatDate(
                          policy.renew_date,
                        )}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  description,
  icon,
}: {
  label: string;
  value: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-[#737a84]">
          {label}
        </p>

        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-[#ff4b0a]">
          {icon}
        </div>
      </div>

      <p className="mt-4 text-3xl font-semibold tracking-tight text-[#17191d]">
        {value}
      </p>

      <p className="mt-1 text-xs text-[#8a9099]">
        {description}
      </p>
    </div>
  );
}