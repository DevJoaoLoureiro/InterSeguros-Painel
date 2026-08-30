import {
  ArrowUpRight,
  CalendarDays,
  CircleUserRound,
  FileCheck2,
  Users,
} from "lucide-react";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { DashboardCharts } from "@/components/dashboard/dashboard-charts";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";

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

type RelatedCompany = {
  id: string;
  name: string;
  code: string;
};

type RelatedLine = {
  id: string;
  name: string;
  code: string;
  plan_type: string;
};

type PolicyRow = {
  id: string;
  client_id: string;
  policy_number: string;

  product_name: string | null;

  issue_date: string | null;
  start_date: string | null;
  renewal_date: string | null;

  commercial_premium: number | string | null;
  total_premium: number | string | null;
  annualized_premium: number | string | null;

  status: string;

  commercial_user_id: string | null;
  issued_by_user_id: string | null;
  issuing_store_id: string | null;

  created_at: string;

  company: RelatedCompany | RelatedCompany[] | null;
  insurance_line: RelatedLine | RelatedLine[] | null;
};

function getPortugalDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(
    new Date(`${value.slice(0, 10)}T12:00:00`),
  );
}

function getRelation<T>(
  relation: T | T[] | null,
): T | null {
  if (!relation) {
    return null;
  }

  if (Array.isArray(relation)) {
    return relation[0] ?? null;
  }

  return relation;
}

export default async function DashboardPage() {
  // ========================================
  // UTILIZADOR
  // ========================================

  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  // ========================================
  // LOJA ATIVA
  // ========================================

  const cookieStore = await cookies();

  const cookieStoreId =
    cookieStore.get("selected_store_id")?.value ?? "all";

  const canAccessAllStores =
    profile.role === "OWNER" ||
    profile.role === "ADMIN";

  const selectedStoreId =
    canAccessAllStores
      ? cookieStoreId
      : profile.store?.id ?? null;

  if (
    !canAccessAllStores &&
    !selectedStoreId
  ) {
    throw new Error(
      "O utilizador não tem uma loja associada.",
    );
  }

  const supabase = createAdminClient();

  // ========================================
  // QUERIES
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
      product_name,
      issue_date,
      start_date,
      renewal_date,
      commercial_premium,
      total_premium,
      annualized_premium,
      status,
      commercial_user_id,
      issued_by_user_id,
      issuing_store_id,
      created_at,
      company:companies (
        id,
        name,
        code
      ),
      insurance_line:insurance_lines (
        id,
        name,
        code,
        plan_type
      )
    `);

  // ========================================
  // FILTRO POR LOJA
  // ========================================

  if (
    selectedStoreId &&
    selectedStoreId !== "all"
  ) {
    leadsQuery = leadsQuery.eq(
      "store_id",
      selectedStoreId,
    );

    policiesQuery = policiesQuery.eq(
      "issuing_store_id",
      selectedStoreId,
    );
  }

  // ========================================
  // CARREGAR
  // ========================================

  const [
    leadsResult,
    clientsResult,
    policiesResult,
  ] = await Promise.all([
    leadsQuery.order("created_at", {
      ascending: false,
    }),

    supabase
      .from("clients")
      .select(`
        id,
        name,
        created_at
      `)
      .order("created_at", {
        ascending: false,
      }),

    policiesQuery.order("issue_date", {
      ascending: false,
      nullsFirst: false,
    }),
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
  // CLIENTES VISÍVEIS
  // ========================================

  const visibleClientIds = new Set(
    policies.map(
      (policy) => policy.client_id,
    ),
  );

  const clients =
    selectedStoreId === "all"
      ? allClients
      : allClients.filter((client) =>
          visibleClientIds.has(client.id),
        );

  const today = getPortugalDateKey();

  // ========================================
  // MÉTRICAS
  // ========================================

  const newLeads = leads.filter(
    (lead) => lead.status === "nova",
  ).length;

  const convertedLeads = leads.filter(
    (lead) =>
      lead.status === "convertida" ||
      Boolean(lead.converted_at),
  ).length;

  const policiesToday = policies.filter(
    (policy) => policy.issue_date === today,
  );

  // Produção do dia:
  // usamos prémio comercial quando disponível.
  const premiumToday = policiesToday.reduce(
    (total, policy) =>
      total +
      Number(
        policy.commercial_premium ?? 0,
      ),
    0,
  );

  // Carteira anualizada:
  // valor normalizado da companhia/provider.
  const annualizedPortfolio =
    policies
      .filter(
        (policy) =>
          policy.status === "ACTIVE",
      )
      .reduce(
        (total, policy) =>
          total +
          Number(
            policy.annualized_premium ?? 0,
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

  const last30Days: {
    date: string;
    label: string;
    policies: number;
    premium: number;
  }[] = [];

  for (let i = 29; i >= 0; i--) {
    const date = new Date();

    date.setDate(
      date.getDate() - i,
    );

    const key =
      getPortugalDateKey(date);

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

  const dailyMap = new Map(
    last30Days.map((day) => [
      day.date,
      day,
    ]),
  );

  for (const policy of policies) {
    if (!policy.issue_date) {
      continue;
    }

    const day =
      dailyMap.get(
        policy.issue_date,
      );

    if (!day) {
      continue;
    }

    day.policies += 1;

    day.premium += Number(
      policy.commercial_premium ?? 0,
    );
  }

  // ========================================
  // PRODUÇÃO POR COMPANHIA
  // ========================================

  const companyMap = new Map<
    string,
    {
      company: string;
      policies: number;
      premium: number;
    }
  >();

  for (const policy of policies) {
    const companyRelation =
      getRelation(policy.company);

    const company =
      companyRelation?.name ??
      "Sem companhia";

    const current =
      companyMap.get(company) ?? {
        company,
        policies: 0,
        premium: 0,
      };

    current.policies += 1;

    current.premium += Number(
      policy.commercial_premium ?? 0,
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
          b.premium - a.premium,
      )
      .slice(0, 8);

  // ========================================
  // LEADS POR ESTADO
  // ========================================

  const leadStatusMap =
    new Map<string, number>();

  for (const lead of leads) {
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
    ).map(([status, count]) => ({
      status,
      count,
    }));

  // ========================================
  // CARTEIRA POR RAMO
  // ========================================

  const lineMap =
    new Map<string, number>();

  for (const policy of policies) {
    const lineRelation =
      getRelation(
        policy.insurance_line,
      );

    const line =
      lineRelation?.name ??
      policy.product_name ??
      "Outros";

    lineMap.set(
      line,
      (lineMap.get(line) ?? 0) + 1,
    );
  }

  const lines =
    Array.from(
      lineMap.entries(),
    )
      .map(([name, value]) => ({
        name,
        value,
      }))
      .sort(
        (a, b) =>
          b.value - a.value,
      );


      // ========================================
// CARTEIRA POR PLANO (VIDA / NÃO VIDA / FINANCEIROS)
// ========================================

const activePolicies = policies.filter(
  (policy) => policy.status === "ACTIVE",
);

let vidaTotal = 0;
let naoVidaTotal = 0;
let financeirosTotal = 0;
let naoClassificadoTotal = 0;

for (const policy of activePolicies) {
  const lineRelation = getRelation(policy.insurance_line);
  const premium = Number(policy.annualized_premium ?? 0);

  if (lineRelation?.plan_type === "VIDA") {
    vidaTotal += premium;
  } else if (lineRelation?.plan_type === "NAO_VIDA") {
    naoVidaTotal += premium;
  } else if (lineRelation?.plan_type === "FINANCEIROS") {
    financeirosTotal += premium;
  } else {
    // sem insurance_line, ou plan_type desconhecido
    naoClassificadoTotal += premium;
  }
}

const seguroTotal = vidaTotal + naoVidaTotal;
  // ========================================
  // APÓLICES RECENTES
  // ========================================

  const clientMap = new Map(
    clients.map((client) => [
      client.id,
      client.name,
    ]),
  );

  const recentPolicies =
    policies
      .slice(0, 6)
      .map((policy) => ({
        ...policy,

        clientName:
          clientMap.get(
            policy.client_id,
          ) ?? "Cliente",

        companyName:
          getRelation(
            policy.company,
          )?.name ?? "—",

        lineName:
          getRelation(
            policy.insurance_line,
          )?.name ??
          policy.product_name ??
          "—",
      }));

      // ========================================
// RENOVAÇÃO — a partir do último recibo
// ========================================

const recentPolicyIds = recentPolicies.map((p) => p.id);

const renewalByPolicy = new Map<string, string>();

if (recentPolicyIds.length > 0) {
  const { data: recentReceipts } = await supabase
    .from("receipts")
    .select("policy_id, period_end, external_nature, receipt_type")
    .in("policy_id", recentPolicyIds)
    .not("period_end", "is", null)
    .order("period_end", { ascending: false });

  for (const receipt of recentReceipts ?? []) {
    if (renewalByPolicy.has(receipt.policy_id)) {
      continue;
    }

    const isReversal =
      receipt.external_nature === "9" ||
      (receipt.receipt_type ?? "").toUpperCase().includes("ESTORNO") ||
      (receipt.receipt_type ?? "").toUpperCase().includes("REVERSAL");

    if (isReversal) {
      continue;
    }

    renewalByPolicy.set(receipt.policy_id, receipt.period_end as string);
  }
}

  // ========================================
  // RENDER
  // ========================================

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-[#ff4b0a]">
          Visão geral
        </p>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
          Dashboard
        </h1>

        <p className="mt-1 text-sm text-[#737a84]">
          Dados comerciais, produção e
          carteira da Inter Seguros.
        </p>
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Leads novas"
          value={String(newLeads)}
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
          )} em prémio comercial`}
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

      <section className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold text-[#20242a]">
                Produção
              </h2>

              <p className="mt-1 text-sm text-[#7d848e]">
                Apólices emitidas nos
                últimos 30 dias.
              </p>
            </div>

            <div className="rounded-xl bg-[#f7f8f9] px-3 py-2 text-right">
              <p className="text-xs text-[#8a9099]">
                Carteira anualizada
              </p>

              <p className="mt-0.5 text-sm font-semibold text-[#20242a]">
                {formatCurrency(
                  annualizedPortfolio,
                )}
              </p>
            </div>
          </div>

          <div className="mt-6">
            <DashboardCharts
              dailyProduction={
                last30Days
              }
              companies={companies}
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
            Prémio comercial acumulado
            por seguradora.
          </p>

          <div className="mt-6">
            <DashboardCharts
              dailyProduction={
                last30Days
              }
              companies={companies}
              leadStatuses={
                leadStatuses
              }
              lines={lines}
              mode="companies"
            />
          </div>
        </div>
      </section>


    <section>
      <PortfolioBreakdownCard
        vida={vidaTotal}
        naoVida={naoVidaTotal}
        financeiros={financeirosTotal}
        naoClassificado={naoClassificadoTotal}
      />
    </section>
      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
          <h2 className="font-semibold text-[#20242a]">
            Leads por estado
          </h2>

          <p className="mt-1 text-sm text-[#7d848e]">
            Distribuição atual do funil
            comercial.
          </p>

          <div className="mt-6">
            <DashboardCharts
              dailyProduction={
                last30Days
              }
              companies={companies}
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
            Distribuição das apólices
            por ramo.
          </p>

          <div className="mt-6">
            <DashboardCharts
              dailyProduction={
                last30Days
              }
              companies={companies}
              leadStatuses={
                leadStatuses
              }
              lines={lines}
              mode="lines"
            />
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        <div className="flex items-center justify-between border-b border-[#edf0f2] px-5 py-4">
          <div>
            <h2 className="font-semibold text-[#20242a]">
              Últimas apólices
            </h2>

            <p className="mt-1 text-sm text-[#7d848e]">
              Produção mais recente
              integrada das seguradoras.
            </p>
          </div>

          <CalendarDays className="h-5 w-5 text-[#a0a5ac]" />
        </div>

        {recentPolicies.length === 0 ? (
          <div className="px-5 py-14 text-center text-sm text-[#7d848e]">
            Ainda não existem apólices.
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
                    Prémio comercial
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
                      key={policy.id}
                      className="text-sm"
                    >
                      <td className="px-5 py-4 font-medium text-[#20242a]">
                        {policy.clientName}
                      </td>

                      <td className="px-5 py-4 text-[#606771]">
                        {
                          policy.policy_number
                        }
                      </td>

                      <td className="px-5 py-4 text-[#606771]">
                        {policy.companyName}
                      </td>

                      <td className="px-5 py-4 text-[#606771]">
                        {policy.lineName}
                      </td>

                      <td className="px-5 py-4 font-medium text-[#20242a]">
                        {formatCurrency(
                          Number(
                            policy.commercial_premium ??
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
                      {renewalByPolicy.has(policy.id)
                        ? formatDate(renewalByPolicy.get(policy.id)!)
                        : "—"}
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

function PortfolioBreakdownCard({
  vida,
  naoVida,
  financeiros,
  naoClassificado,
}: {
  vida: number;
  naoVida: number;
  financeiros: number;
  naoClassificado: number;
}) {
  const seguroTotal = vida + naoVida;
  const grandTotal = seguroTotal + financeiros + naoClassificado;

  const rows = [
    { label: "Vida", value: vida, color: "bg-[#ff4b0a]" },
    { label: "Não Vida", value: naoVida, color: "bg-[#ff8a5c]" },
    { label: "Financeiros", value: financeiros, color: "bg-[#20242a]" },
  ];

  if (naoClassificado > 0) {
    rows.push({
      label: "Não classificado",
      value: naoClassificado,
     color: "bg-amber-400"
    });
  }

  return (
    <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-[#20242a]">
            Carteira por plano
          </h2>

          <p className="mt-1 text-sm text-[#7d848e]">
            Vida + Não Vida = Carteira de Seguros
          </p>
        </div>

        <div className="rounded-xl bg-[#f7f8f9] px-3 py-2 text-right">
          <p className="text-xs text-[#8a9099]">
            Carteira de Seguros
          </p>

          <p className="mt-0.5 text-sm font-semibold text-[#20242a]">
            {formatCurrency(seguroTotal)}
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-4">
        {rows.map((row) => {
          const percentage =
            grandTotal > 0
              ? (row.value / grandTotal) * 100
              : 0;

          return (
            <div key={row.label}>
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="font-medium text-[#343940]">
                  {row.label}
                </span>

                <span className="text-xs text-[#7d848e]">
                  {formatCurrency(row.value)}
                </span>
              </div>

              <div className="h-2 overflow-hidden rounded-full bg-[#f0f1f3]">
                <div
                  className={`h-full rounded-full ${row.color}`}
                  style={{
                    width: `${Math.max(percentage, row.value > 0 ? 2 : 0)}%`,
                  }}
                />
              </div>
            </div>
          );
        })}

        {naoClassificado > 0 && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {formatCurrency(naoClassificado)} em apólices sem ramo classificado.
            Estas apólices não contam para nenhuma categoria acima.
          </p>
        )}
      </div>
    </div>
  );
}