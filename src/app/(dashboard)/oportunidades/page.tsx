import {
  BriefcaseBusiness,
  CircleDollarSign,
  Target,
  Trophy,
} from "lucide-react";

import {
  cookies,
} from "next/headers";

import Link from "next/link";

import {
  redirect,
} from "next/navigation";

import {
  CreateOpportunityDialog,
} from "@/components/opportunities/create-opportunity-dialog";

import {
  OpportunitiesKanban,
} from "@/components/opportunities/opportunities-kanban";

import {
  getCurrentProfile,
} from "@/lib/auth/get-current-profile";

import {
  getOpportunitiesData,
} from "./action";

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

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{
    closedPage?: string;
  }>;
}) {
  const profile =
    await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  const canAssignOthers =
    profile.role === "OWNER" ||
    profile.role === "ADMIN";

  const cookieStore =
    await cookies();

  const cookieStoreId =
    cookieStore.get(
      "selected_store_id",
    )?.value ?? "all";

  const selectedStoreId =
    canAssignOthers
      ? cookieStoreId
      : profile.store?.id ?? null;

  if (
    !canAssignOthers &&
    !selectedStoreId
  ) {
    throw new Error(
      "O utilizador não tem uma loja associada.",
    );
  }

  const params =
    await searchParams;

  const closedPage =
    Number(
      params.closedPage ?? "1",
    ) || 1;

  const {
    stats,
    conversionRate,
    openOpportunities,
    closedOpportunities,
    closedTotal,
    closedTotalPages,
    profiles,
  } = await getOpportunitiesData({
    selectedStoreId,
    privileged: canAssignOthers,
    currentProfileId: profile.id,
    closedPage,
  });

  return (
    <div className="space-y-6">
      {/* HEADER */}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-[#ff4b0a]">
            Comercial
          </p>

          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
            Oportunidades
          </h1>

          <p className="mt-1 text-sm text-[#737a84]">
            Acompanha o pipeline comercial desde a qualificação até ao fecho.
          </p>
        </div>

        <CreateOpportunityDialog
          users={profiles}
          canAssignOthers={
            canAssignOthers
          }
        />
      </div>

      {/* KPIs */}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Oportunidades abertas"
          value={String(
            stats.open_count,
          )}
          icon={
            <BriefcaseBusiness className="h-5 w-5 text-[#ff4b0a]" />
          }
        />

        <MetricCard
          label="Valor em pipeline"
          value={formatCurrency(
            stats.pipeline_value,
          )}
          icon={
            <CircleDollarSign className="h-5 w-5 text-blue-600" />
          }
        />

        <MetricCard
          label="Taxa de conversão"
          value={`${conversionRate.toFixed(
            1,
          )}%`}
          icon={
            <Target className="h-5 w-5 text-violet-600" />
          }
        />

        <MetricCard
          label="Valor ganho"
          value={formatCurrency(
            stats.won_value,
          )}
          icon={
            <Trophy className="h-5 w-5 text-green-600" />
          }
        />
      </section>

      {/* PIPELINE */}

      <section className="overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        <div className="border-b border-[#edf0f2] px-5 py-4">
          <h2 className="font-semibold text-[#20242a]">
            Pipeline comercial
          </h2>

          <p className="mt-1 text-sm text-[#7d848e]">
            Arrasta as oportunidades entre estados.
          </p>
        </div>

        <OpportunitiesKanban
          opportunities={
            openOpportunities
          }
          profiles={profiles}
          canAssignOthers={
            canAssignOthers
          }
        />
      </section>

      {/* NEGÓCIOS FECHADOS */}

      <section className="overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        <div className="border-b border-[#edf0f2] px-5 py-4">
          <h2 className="font-semibold text-[#20242a]">
            Negócios fechados
          </h2>

          <p className="mt-1 text-sm text-[#7d848e]">
            Histórico de oportunidades ganhas e perdidas.
          </p>
        </div>

        <div className="grid gap-4 border-b border-[#edf0f2] p-5 sm:grid-cols-2">
          <div className="rounded-xl bg-green-50 p-4">
            <p className="text-sm font-medium text-green-700">
              Ganhos
            </p>

            <div className="mt-2 flex items-end justify-between">
              <p className="text-3xl font-semibold text-green-800">
                {stats.won_count}
              </p>

              <span className="text-sm font-semibold text-green-700">
                {formatCurrency(
                  stats.won_value,
                )}
              </span>
            </div>
          </div>

          <div className="rounded-xl bg-red-50 p-4">
            <p className="text-sm font-medium text-red-700">
              Perdidos
            </p>

            <p className="mt-2 text-3xl font-semibold text-red-800">
              {stats.lost_count}
            </p>
          </div>
        </div>

        {closedTotal === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-[#7d848e]">
            Ainda não existem negócios fechados.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-left">
                <thead className="bg-[#fafbfc]">
                  <tr className="text-xs font-medium uppercase tracking-wide text-[#8a9099]">
                    <th className="px-5 py-3">
                      Oportunidade
                    </th>

                    <th className="px-5 py-3">
                      Seguro
                    </th>

                    <th className="px-5 py-3">
                      Responsável
                    </th>

                    <th className="px-5 py-3">
                      Valor
                    </th>

                    <th className="px-5 py-3">
                      Resultado
                    </th>

                    <th className="px-5 py-3">
                      Ação
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-[#edf0f2]">
                  {closedOpportunities.map(
                    (opportunity) => {
                      const responsible =
                        profiles.find(
                          (p) =>
                            p.id ===
                            opportunity.assigned_user_id,
                        );

                      return (
                        <tr
                          key={
                            opportunity.id
                          }
                          className="text-sm"
                        >
                          <td className="px-5 py-4 font-medium text-[#20242a]">
                            {
                              opportunity.title
                            }
                          </td>

                          <td className="px-5 py-4 text-[#606771]">
                            {opportunity.insurance_type ??
                              "—"}
                          </td>

                          <td className="px-5 py-4 text-[#606771]">
                            {responsible?.full_name ??
                              "Sem responsável"}
                          </td>

                          <td className="px-5 py-4 font-medium text-[#20242a]">
                            {formatCurrency(
                              Number(
                                opportunity.estimated_value ??
                                  0,
                              ),
                            )}
                          </td>

                          <td className="px-5 py-4">
                            {opportunity.status ===
                            "ganha" ? (
                              <span className="inline-flex rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                                Ganha
                              </span>
                            ) : (
                              <span className="inline-flex rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
                                Perdida
                              </span>
                            )}
                          </td>

                          <td className="px-5 py-4">
                            <ReopenButton
                              opportunityId={
                                opportunity.id
                              }
                            />
                          </td>
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>

            <ClosedPagination
              currentPage={
                closedPage
              }
              totalPages={
                closedTotalPages
              }
            />
          </>
        )}
      </section>
    </div>
  );
}

function ReopenButton({
  opportunityId,
}: {
  opportunityId: string;
}) {
  async function reopen() {
    "use server";

    const {
      updateOpportunityStatus,
    } = await import("./action");

    await updateOpportunityStatus(
      opportunityId,
      "proposta",
    );
  }

  return (
    <form action={reopen}>
      <button
        type="submit"
        className="rounded-lg border border-[#e1e4e8] px-3 py-1.5 text-xs font-medium text-[#59616d] transition hover:bg-[#f5f6f7]"
      >
        Reabrir
      </button>
    </form>
  );
}

function ClosedPagination({
  currentPage,
  totalPages,
}: {
  currentPage: number;
  totalPages: number;
}) {
  if (totalPages <= 1) {
    return null;
  }

  const prevPage = Math.max(
    1,
    currentPage - 1,
  );

  const nextPage = Math.min(
    totalPages,
    currentPage + 1,
  );

  return (
    <div className="flex items-center justify-between border-t border-[#edf0f2] px-5 py-3">
      <p className="text-xs text-[#8a9099]">
        Página {currentPage} de{" "}
        {totalPages}
      </p>

      <div className="flex gap-2">
        <Link
          href={`/oportunidades?closedPage=${prevPage}`}
          className={`rounded-lg border border-[#e1e4e8] px-3 py-1.5 text-xs font-medium text-[#59616d] transition hover:bg-[#f5f6f7] ${
            currentPage === 1
              ? "pointer-events-none opacity-40"
              : ""
          }`}
        >
          Anterior
        </Link>

        <Link
          href={`/oportunidades?closedPage=${nextPage}`}
          className={`rounded-lg border border-[#e1e4e8] px-3 py-1.5 text-xs font-medium text-[#59616d] transition hover:bg-[#f5f6f7] ${
            currentPage === totalPages
              ? "pointer-events-none opacity-40"
              : ""
          }`}
        >
          Seguinte
        </Link>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-[#737a84]">
            {label}
          </p>

          <p className="mt-3 text-2xl font-semibold tracking-tight text-[#17191d]">
            {value}
          </p>
        </div>

        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f7f8fa]">
          {icon}
        </div>
      </div>
    </div>
  );
}