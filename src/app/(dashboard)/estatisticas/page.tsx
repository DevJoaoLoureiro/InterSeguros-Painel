import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ArrowDown, ArrowUp, Minus, TrendingUp, Trophy } from "lucide-react";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";

import {
  getMonthComparison,
  getMonthlyProduction,
  getRankingByPerson,
  getRankingByStore,
} from "./action";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function formatPct(value: number | null) {
  if (value === null) {
    return "—";
  }

  const sign = value > 0 ? "+" : "";

  return `${sign}${value.toFixed(1)}%`;
}

function roleLabel(role: string | null) {
  switch (role) {
    case "ADMIN":
      return "Administrador";
    case "OWNER":
      return "Owner";
    case "GESTOR_LOJA":
      return "Gestor de Loja";
    case "COMERCIAL":
      return "Comercial";
    default:
      return role ?? "—";
  }
}

export default async function EstatisticasPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  const cookieStore = await cookies();

  const cookieStoreId =
    cookieStore.get("selected_store_id")?.value ?? "all";

  const canAccessAllStores =
    profile.role === "OWNER" || profile.role === "ADMIN";

  const selectedStoreId = canAccessAllStores
    ? cookieStoreId
    : profile.store?.id ?? null;

  const [monthly, comparison, personRanking, storeRanking] =
    await Promise.all([
      getMonthlyProduction({ storeId: selectedStoreId }),
      getMonthComparison({ storeId: selectedStoreId }),
      getRankingByPerson({ storeId: selectedStoreId }),
      getRankingByStore({ storeId: selectedStoreId }),
    ]);

  const maxPremium = Math.max(
    ...monthly.map((m) => m.commercialPremium),
    1,
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-[#ff4b0a]">
          Análises
        </p>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
          Estatísticas
        </h1>

        <p className="mt-1 text-sm text-[#737a84]">
          Evolução histórica e rankings de produção.
        </p>
      </div>

      {/* COMPARAÇÃO MÊS A MÊS */}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ComparisonCard
          label="Apólices emitidas"
          currentLabel={comparison.currentMonth.label}
          currentValue={String(comparison.currentMonth.policiesCount)}
          previousLabel={comparison.previousMonth.label}
          previousValue={String(comparison.previousMonth.policiesCount)}
          changePct={comparison.policiesChangePct}
        />

        <ComparisonCard
          label="Prémio comercial"
          currentLabel={comparison.currentMonth.label}
          currentValue={formatCurrency(comparison.currentMonth.commercialPremium)}
          previousLabel={comparison.previousMonth.label}
          previousValue={formatCurrency(comparison.previousMonth.commercialPremium)}
          changePct={comparison.premiumChangePct}
        />
      </section>

      {/* EVOLUÇÃO 12 MESES */}

      <section className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold text-[#20242a]">
              Evolução mensal
            </h2>

            <p className="mt-1 text-sm text-[#7d848e]">
              Prémio comercial dos últimos 12 meses.
            </p>
          </div>

          <TrendingUp className="h-5 w-5 text-[#a0a5ac]" />
        </div>

        <div className="mt-6 flex h-[220px] items-end gap-2">
          {monthly.map((month) => {
            const height = Math.max(
              (month.commercialPremium / maxPremium) * 100,
              month.commercialPremium > 0 ? 4 : 1,
            );

            return (
              <div
                key={month.monthKey}
                className="group relative flex h-full flex-1 flex-col items-center justify-end"
              >
                <div
                  className="w-full rounded-t-md bg-[#ff4b0a] transition-opacity hover:opacity-80"
                  style={{ height: `${height}%` }}
                />

                <div className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-20 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#20242a] px-3 py-2 text-xs text-white shadow-lg group-hover:block">
                  <p className="font-medium">{month.label}</p>
                  <p>{month.policiesCount} apólices</p>
                  <p>{formatCurrency(month.commercialPremium)}</p>
                </div>

                <p className="mt-2 text-[10px] text-[#a0a5ac]">
                  {month.label}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* RANKING POR COMERCIAL */}

      <section className="overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        <div className="flex items-center justify-between border-b border-[#edf0f2] px-5 py-4">
          <div>
            <h2 className="font-semibold text-[#20242a]">
              Ranking por comercial
            </h2>

            <p className="mt-1 text-sm text-[#7d848e]">
              Carteira ativa (prémio anualizado) por comercial.
            </p>
          </div>

          <Trophy className="h-5 w-5 text-[#a0a5ac]" />
        </div>

        {personRanking.length === 0 ? (
          <div className="px-5 py-14 text-center text-sm text-[#7d848e]">
            Ainda não existem apólices com comercial associado.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left">
              <thead className="bg-[#fafbfc]">
                <tr className="text-xs font-medium uppercase tracking-wide text-[#8a9099]">
                  <th className="px-5 py-3">#</th>
                  <th className="px-5 py-3">Comercial</th>
                  <th className="px-5 py-3">Função</th>
                  <th className="px-5 py-3">Apólices</th>
                  <th className="px-5 py-3">Carteira anualizada</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[#edf0f2]">
                {personRanking.map((person, index) => (
                  <tr key={person.userId} className="text-sm">
                    <td className="px-5 py-4 text-[#a0a5ac]">
                      {index + 1}
                    </td>

                    <td className="px-5 py-4 font-medium text-[#20242a]">
                      {person.name}
                    </td>

                    <td className="px-5 py-4 text-[#606771]">
                      {roleLabel(person.role)}
                    </td>

                    <td className="px-5 py-4 text-[#606771]">
                      {person.policiesCount}
                    </td>

                    <td className="px-5 py-4 font-medium text-[#20242a]">
                      {formatCurrency(person.annualizedPremium)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* RANKING POR LOJA */}

      <section className="overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        <div className="flex items-center justify-between border-b border-[#edf0f2] px-5 py-4">
          <div>
            <h2 className="font-semibold text-[#20242a]">
              Ranking por loja
            </h2>

            <p className="mt-1 text-sm text-[#7d848e]">
              Carteira ativa (prémio anualizado) por loja.
            </p>
          </div>

          <Trophy className="h-5 w-5 text-[#a0a5ac]" />
        </div>

        {storeRanking.length === 0 ? (
          <div className="px-5 py-14 text-center text-sm text-[#7d848e]">
            Ainda não existem apólices com loja associada.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left">
              <thead className="bg-[#fafbfc]">
                <tr className="text-xs font-medium uppercase tracking-wide text-[#8a9099]">
                  <th className="px-5 py-3">#</th>
                  <th className="px-5 py-3">Loja</th>
                  <th className="px-5 py-3">Apólices</th>
                  <th className="px-5 py-3">Carteira anualizada</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[#edf0f2]">
                {storeRanking.map((store, index) => (
                  <tr key={store.storeId} className="text-sm">
                    <td className="px-5 py-4 text-[#a0a5ac]">
                      {index + 1}
                    </td>

                    <td className="px-5 py-4 font-medium text-[#20242a]">
                      {store.storeName}
                    </td>

                    <td className="px-5 py-4 text-[#606771]">
                      {store.policiesCount}
                    </td>

                    <td className="px-5 py-4 font-medium text-[#20242a]">
                      {formatCurrency(store.annualizedPremium)}
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

function ComparisonCard({
  label,
  currentLabel,
  currentValue,
  previousLabel,
  previousValue,
  changePct,
}: {
  label: string;
  currentLabel: string;
  currentValue: string;
  previousLabel: string;
  previousValue: string;
  changePct: number | null;
}) {
  const isPositive = changePct !== null && changePct > 0;
  const isNegative = changePct !== null && changePct < 0;

  return (
    <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
      <p className="text-sm font-medium text-[#737a84]">{label}</p>

      <div className="mt-3 flex items-end justify-between">
        <div>
          <p className="text-xs text-[#8a9099]">{currentLabel}</p>
          <p className="mt-1 text-2xl font-semibold text-[#17191d]">
            {currentValue}
          </p>
        </div>

        <div
          className={[
            "flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold",
            isPositive
              ? "bg-green-50 text-green-700"
              : isNegative
                ? "bg-red-50 text-red-700"
                : "bg-[#f4f5f7] text-[#7d848e]",
          ].join(" ")}
        >
          {isPositive && <ArrowUp className="h-3.5 w-3.5" />}
          {isNegative && <ArrowDown className="h-3.5 w-3.5" />}
          {!isPositive && !isNegative && <Minus className="h-3.5 w-3.5" />}
          {formatPct(changePct)}
        </div>
      </div>

      <p className="mt-2 text-xs text-[#a0a5ac]">
        vs {previousLabel}: {previousValue}
      </p>
    </div>
  );
}