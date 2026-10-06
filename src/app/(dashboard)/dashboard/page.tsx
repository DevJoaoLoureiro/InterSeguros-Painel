import {
  AlertCircle,
  CalendarDays,
  CheckSquare,
  FileCheck2,
  TrendingUp,
  Users,
} from "lucide-react";

import Link from "next/link";
import { redirect } from "next/navigation";

import { DashboardCharts } from "@/components/dashboard/dashboard-charts";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { getSelectedStoreId } from "@/lib/auth/store-selection";
import { clientHref } from "@/lib/clients/client-link";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getExpiryAlerts,
  getVencimentosSnapshot,
} from "@/lib/alerts/expiry-alerts";
import { ExpiryAlertsBanner } from "@/components/alerts/expiry-alerts";
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

  client: { name: string } | { name: string }[] | null;
  company: RelatedCompany | RelatedCompany[] | null;
  insurance_line: RelatedLine | RelatedLine[] | null;
};

type TaskRow = {
  id: string;
  title: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  priority: "LOW" | "MEDIUM" | "HIGH";
  due_at: string | null;
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

  const date = new Date(`${value.slice(0, 10)}T12:00:00`);

  // Datas mal escritas (ex.: ano 20226) não podem rebentar a página.
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function getRelation<T>(relation: T | T[] | null): T | null {
  if (!relation) {
    return null;
  }

  if (Array.isArray(relation)) {
    return relation[0] ?? null;
  }

  return relation;
}

const priorityStyles: Record<TaskRow["priority"], string> = {
  LOW: "bg-[#f4f5f7] text-[#59616d]",
  MEDIUM: "bg-amber-50 text-amber-700",
  HIGH: "bg-red-50 text-red-700",
};

const priorityLabels: Record<TaskRow["priority"], string> = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
};

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

  // Loja = filtro do seletor do topo, igual para todos.
  const selectedStoreId = await getSelectedStoreId();

  const supabase = createAdminClient();

  // ========================================
  // QUERIES
  // ========================================

  let leadsQuery = supabase.from("leads").select(`
      id,
      name,
      insurance_type,
      status,
      source,
      store_id,
      created_at,
      converted_at
    `);

  let policiesQuery = supabase.from("policies").select(`
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
      client:clients ( name ),
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

  const tasksQuery = supabase
    .from("tasks")
    .select("id, title, status, priority, due_at")
    .eq("assigned_user_id", profile.id)
    .not("status", "in", "(COMPLETED,CANCELLED)")
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(5);

  // ========================================
  // FILTRO POR LOJA
  // ========================================

  if (selectedStoreId && selectedStoreId !== "all") {
    leadsQuery = leadsQuery.eq("store_id", selectedStoreId);
    policiesQuery = policiesQuery.eq(
      "issuing_store_id",
      selectedStoreId,
    );
  }

  // ========================================
  // CARREGAR
  // ========================================

const [leadsResult, policiesResult, tasksResult, upcomingReceipts, expiryAlerts] =
  await Promise.all([
      leadsQuery.order("created_at", { ascending: false }),

      policiesQuery.order("issue_date", {
        ascending: false,
        nullsFirst: false,
      }),

      tasksQuery,
      // Mesma cache do layout (sino/alertas): não recalcula.
      getVencimentosSnapshot(
        selectedStoreId === "all" ? null : selectedStoreId,
      ).then((snapshot) => snapshot.receipts),
      getExpiryAlerts(),
    ]);

  if (leadsResult.error) {
    throw new Error(`Erro ao carregar leads: ${leadsResult.error.message}`);
  }

  if (policiesResult.error) {
    throw new Error(
      `Erro ao carregar apólices: ${policiesResult.error.message}`,
    );
  }

  if (tasksResult.error) {
    throw new Error(
      `Erro ao carregar tarefas: ${tasksResult.error.message}`,
    );
  }

  const leads = (leadsResult.data ?? []) as LeadRow[];
  const policies = (policiesResult.data ?? []) as PolicyRow[];
  const myTasks = (tasksResult.data ?? []) as TaskRow[];

  const today = getPortugalDateKey();
  const monthStart = `${today.slice(0, 7)}-01`;

  // ========================================
  // MÉTRICAS
  // ========================================

  const newLeads = leads.filter((lead) => lead.status === "nova").length;

    const policiesToday = policies.filter(
      (policy) => policy.issue_date === today,
    );

  const premiumToday = policiesToday.reduce(
  (total, policy) => total + Number(policy.annualized_premium ?? 0),
  0,
);

  // ========================================
  // PRODUÇÃO MENSAL
  // ========================================

const policiesThisMonth = policies.filter(
  (policy) =>
    policy.issue_date &&
    policy.issue_date >= monthStart &&
    policy.issue_date <= today,
);

  const premiumThisMonth = policiesThisMonth.reduce(
    (total, policy) => total + Number(policy.commercial_premium ?? 0),
    0,
  );


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
    date.setDate(date.getDate() - i);

    const key = getPortugalDateKey(date);

    last30Days.push({
      date: key,
      label: new Intl.DateTimeFormat("pt-PT", {
        day: "2-digit",
        month: "2-digit",
      }).format(date),
      policies: 0,
      premium: 0,
    });
  }

  const dailyMap = new Map(last30Days.map((day) => [day.date, day]));

for (const policy of policies) {
  if (!policy.issue_date) {
    continue;
  }
  const day = dailyMap.get(policy.issue_date);

    if (!day) {
      continue;
    }

    day.policies += 1;
    day.premium += Number(policy.commercial_premium ?? 0);
  }

  // ========================================
  // PRODUÇÃO POR COMPANHIA
  // ========================================

  const companyMap = new Map<
    string,
    { company: string; policies: number; premium: number }
  >();

  for (const policy of policies) {
    const companyRelation = getRelation(policy.company);
    const company = companyRelation?.name ?? "Sem companhia";

    const current = companyMap.get(company) ?? {
      company,
      policies: 0,
      premium: 0,
    };

    current.policies += 1;
    current.premium += Number(policy.commercial_premium ?? 0);

    companyMap.set(company, current);
  }

  const companies = Array.from(companyMap.values())
    .sort((a, b) => b.premium - a.premium)
    .slice(0, 8);

  // ========================================
  // LEADS POR ESTADO
  // ========================================

  const leadStatusMap = new Map<string, number>();

  for (const lead of leads) {
    leadStatusMap.set(
      lead.status,
      (leadStatusMap.get(lead.status) ?? 0) + 1,
    );
  }

  const leadStatuses = Array.from(leadStatusMap.entries()).map(
    ([status, count]) => ({ status, count }),
  );

  // ========================================
  // APÓLICES RECENTES
  // ========================================

  const recentPolicies = policies.slice(0, 6).map((policy) => ({
    ...policy,
    clientName: getRelation(policy.client)?.name ?? "Cliente",
    companyName: getRelation(policy.company)?.name ?? "—",
    lineName:
      getRelation(policy.insurance_line)?.name ?? policy.product_name ?? "—",
  }));

  // ========================================
  // RENOVAÇÃO — a partir do último recibo
  // ========================================

  const recentPolicyIds = recentPolicies.map((p) => p.id);

  const renewalByPolicy = new Map<string, string>();
  const latestCommercialByPolicy = new Map<string, number>();

  if (recentPolicyIds.length > 0) {
    const { data: recentReceipts } = await supabase
      .from("receipts")
      .select("policy_id, period_end, commercial_premium, external_nature, receipt_type")
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

        if (
          !latestCommercialByPolicy.has(receipt.policy_id) &&
          receipt.commercial_premium !== null
        ) {
          latestCommercialByPolicy.set(
            receipt.policy_id,
            Number(receipt.commercial_premium),
          );
        }
    }
  }

  // ========================================
  // RENDER
  // ========================================

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-[#ff4b0a]">Visão geral</p>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
          Olá, {profile.full_name.split(" ")[0]}
        </h1>

        <p className="mt-1 text-sm text-[#737a84]">
          A tua atividade comercial de hoje.
        </p>
      </div>

      {/* ALERTAS DE VENCIMENTO */}

      <ExpiryAlertsBanner alerts={expiryAlerts} />

      {/* MÉTRICAS RÁPIDAS */}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Leads novas"
          value={String(newLeads)}
          description={`${leads.length} leads no total`}
          icon={<Users className="h-5 w-5" />}
        />

        <MetricCard
          label="Produção hoje"
          value={formatCurrency(premiumToday)}
          description={`${policiesToday.length} apólice${policiesToday.length === 1 ? "" : "s"} emitida${policiesToday.length === 1 ? "" : "s"}`}
          icon={<TrendingUp className="h-5 w-5" />}
        />

        <MetricCard
          label="Produção do mês"
          value={formatCurrency(premiumThisMonth)}
          description={`${policiesThisMonth.length} apólice${policiesThisMonth.length === 1 ? "" : "s"} este mês`}
          icon={<FileCheck2 className="h-5 w-5" />}
        />

        <MetricCard
          label="Minhas tarefas"
          value={String(myTasks.length)}
          description="pendentes ou em progresso"
          icon={<CheckSquare className="h-5 w-5" />}
        />
      </section>

      {/* PRODUÇÃO 30 DIAS */}

      <section className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        <h2 className="font-semibold text-[#20242a]">Produção</h2>

        <p className="mt-1 text-sm text-[#7d848e]">
          Apólices emitidas nos últimos 30 dias.
        </p>

        <div className="mt-6">
          <DashboardCharts
            dailyProduction={last30Days}
            companies={companies}
            leadStatuses={leadStatuses}
            lines={[]}
            mode="production"
          />
        </div>
      </section>

      {/* PRODUÇÃO POR COMPANHIA + MINHAS TAREFAS */}

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
          <h2 className="font-semibold text-[#20242a]">
            Produção por companhia
          </h2>

          <p className="mt-1 text-sm text-[#7d848e]">
            Prémio comercial acumulado no período.
          </p>

          <div className="mt-5 space-y-3">
            {companies.length === 0 ? (
              <p className="py-6 text-center text-sm text-[#8a9099]">
                Sem dados suficientes.
              </p>
            ) : (
              companies.slice(0, 5).map((item) => (
                <div
                  key={item.company}
                  className="flex items-center justify-between border-b border-[#edf0f2] pb-3 last:border-0 last:pb-0"
                >
                  <div>
                    <p className="text-sm font-medium text-[#20242a]">
                      {item.company}
                    </p>
                    <p className="text-xs text-[#8a9099]">
                      {item.policies} apólices
                    </p>
                  </div>

                  <p className="text-sm font-semibold text-[#20242a]">
                    {formatCurrency(item.premium)}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="flex items-center gap-2 font-semibold text-[#20242a]">
                <CheckSquare className="h-4 w-4 text-[#ff4b0a]" />
                Minhas tarefas
              </h2>

              <p className="mt-1 text-sm text-[#7d848e]">
                Pendentes e em progresso.
              </p>
            </div>

            <Link
              href="/tarefas"
              className="text-xs font-semibold text-[#ff4b0a] hover:text-[#df3f06]"
            >
              Ver todas
            </Link>
          </div>

          <div className="mt-5 space-y-2">
            {myTasks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#dfe2e6] py-8 text-center text-sm text-[#8a9099]">
                Sem tarefas pendentes. 🎉
              </div>
            ) : (
              myTasks.map((task) => {
                const isOverdue =
                  task.due_at &&
                  task.status !== "COMPLETED" &&
                  new Date(task.due_at) < new Date();

                return (
                  <Link
                    key={task.id}
                    href="/tarefas"
                    className="flex items-center justify-between gap-3 rounded-xl border border-[#edf0f2] px-3 py-2.5 transition hover:bg-[#fafbfc]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[#20242a]">
                        {task.title}
                      </p>

                      {task.due_at && (
                        <p
                          className={[
                            "mt-0.5 flex items-center gap-1 text-xs",
                            isOverdue ? "text-red-600" : "text-[#8a9099]",
                          ].join(" ")}
                        >
                          {isOverdue && (
                            <AlertCircle className="h-3 w-3" />
                          )}
                          {formatDate(task.due_at)}
                        </p>
                      )}
                    </div>

                    <span
                      className={[
                        "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium",
                        priorityStyles[task.priority],
                      ].join(" ")}
                    >
                      {priorityLabels[task.priority]}
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      </section>


      <section className="overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        <div className="flex items-center justify-between border-b border-[#edf0f2] px-5 py-4">
          <div>
            <h2 className="font-semibold text-[#20242a]">Recibos a vencer</h2>
            <p className="mt-1 text-sm text-[#7d848e]">
              Próximos 30 dias, incluindo atrasados.
            </p>
          </div>

          <Link
            href="/vencimentos"
            className="text-xs font-semibold text-[#ff4b0a] hover:text-[#df3f06]"
          >
            Ver todos
          </Link>
        </div>

        {upcomingReceipts.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-[#7d848e]">
            Sem recibos a vencer nesta janela.
          </div>
        ) : (
          <div className="divide-y divide-[#edf0f2]">
            {upcomingReceipts.slice(0, 5).map((receipt) => (
              <Link
                key={receipt.receiptId}
                href={
                  receipt.clientId
                    ? clientHref(receipt.clientId)
                    : "/vencimentos"
                }
                title="Abrir cliente"
                className="flex items-center justify-between gap-3 px-5 py-3 transition hover:bg-[#fff7f3]"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[#20242a]">
                    {receipt.clientName}
                  </p>
                  <p className="mt-0.5 text-xs text-[#8a9099]">
                    Recibo {receipt.receiptNumber ?? "—"} · {receipt.companyName}
                  </p>
                </div>

                <span
                  className={[
                    "shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium",
                    receipt.overdue
                      ? "bg-red-50 text-red-700"
                      : "bg-[#f4f5f7] text-[#59616d]",
                  ].join(" ")}
                >
                  {new Intl.DateTimeFormat("pt-PT", {
                    day: "2-digit",
                    month: "2-digit",
                  }).format(new Date(`${receipt.dueDate.slice(0, 10)}T12:00:00`))}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ÚLTIMAS APÓLICES */}

      <section className="overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        <div className="flex items-center justify-between border-b border-[#edf0f2] px-5 py-4">
          <div>
            <h2 className="font-semibold text-[#20242a]">
              Últimas apólices
            </h2>

            <p className="mt-1 text-sm text-[#7d848e]">
              Produção mais recente integrada das seguradoras.
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
                  <th className="px-5 py-3">Cliente</th>
                  <th className="px-5 py-3">Apólice</th>
                  <th className="px-5 py-3">Companhia</th>
                  <th className="px-5 py-3">Ramo</th>
                  <th className="px-5 py-3">Prémio comercial</th>
                  <th className="px-5 py-3">Emissão</th>
                  <th className="px-5 py-3">Renovação</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[#edf0f2]">
                {recentPolicies.map((policy) => (
                  <tr
                    key={policy.id}
                    className="text-sm transition hover:bg-[#fff7f3]"
                  >
                    <td className="font-medium text-[#20242a]">
                      <Link
                        href={clientHref(policy.client_id)}
                        title="Abrir cliente"
                        className="block px-5 py-4 hover:text-[#ff4b0a] hover:underline"
                      >
                        {policy.clientName}
                      </Link>
                    </td>

                    <td className="px-5 py-4 text-[#606771]">
                      {policy.policy_number}
                    </td>

                    <td className="px-5 py-4 text-[#606771]">
                      {policy.companyName}
                    </td>

                    <td className="px-5 py-4 text-[#606771]">
                      {policy.lineName}
                    </td>

                 <td className="px-5 py-4 font-medium text-[#20242a]">
                  {latestCommercialByPolicy.has(policy.id)
                    ? formatCurrency(latestCommercialByPolicy.get(policy.id)!)
                    : "—"}
                </td>

                    <td className="px-5 py-4 text-[#606771]">
                      {formatDate(policy.issue_date)}
                    </td>

                    <td className="px-5 py-4 text-[#606771]">
                      {renewalByPolicy.has(policy.id)
                        ? formatDate(renewalByPolicy.get(policy.id)!)
                        : "—"}
                    </td>
                  </tr>
                ))}
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
        <p className="text-sm font-medium text-[#737a84]">{label}</p>

        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-[#ff4b0a]">
          {icon}
        </div>
      </div>

      <p className="mt-4 text-3xl font-semibold tracking-tight text-[#17191d]">
        {value}
      </p>

      <p className="mt-1 text-xs text-[#8a9099]">{description}</p>
    </div>
  );
}