"use client";

import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  ChevronDown,
  Minus,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

import {
  getAllStoresPortfolio,
  getStorePortfolio,
  getYearlyProduction,
  type StoreOption,
  type StorePortfolio,
  type YearlyProduction,
} from "@/app/(dashboard)/carteira/action";

type Props = {
  stores: StoreOption[];
  canAccessAll: boolean;
  initialPortfolio: StorePortfolio | null;
  companyId: string;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function formatPct(value: number | null) {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

const planLabels: Record<string, string> = {
  VIDA: "Vida",
  NAO_VIDA: "Não Vida",
  FINANCEIROS: "Financeiros",
  NAO_CLASSIFICADO: "Não classificado",
};

const planColors: Record<string, string> = {
  VIDA: "bg-[#ff4b0a]",
  NAO_VIDA: "bg-[#ff8a5c]",
  FINANCEIROS: "bg-[#20242a]",
  NAO_CLASSIFICADO: "bg-amber-400",
};

const ALL_STORES_ID = "all";

export function CarteiraBoard({
  stores,
  canAccessAll,
  initialPortfolio,
  companyId,
}: Props) {
  const [selectedStoreId, setSelectedStoreId] = useState(
    initialPortfolio?.storeId ?? stores[0]?.id ?? "",
  );

  const [portfolio, setPortfolio] = useState<StorePortfolio | null>(
    initialPortfolio,
  );

  const [yearly, setYearly] = useState<YearlyProduction[]>([]);
  const [loading, setLoading] = useState(false);

  const [expandedPlans, setExpandedPlans] = useState<Set<string>>(
    new Set(["VIDA", "NAO_VIDA", "FINANCEIROS"]),
  );

  useEffect(() => {
    if (!selectedStoreId) return;

    let cancelled = false;

    async function load() {
      setLoading(true);

      try {
        const [portfolioResult, yearlyResult] = await Promise.all([
            selectedStoreId === ALL_STORES_ID
                ? getAllStoresPortfolio(companyId)
                : getStorePortfolio(selectedStoreId, companyId),

            getYearlyProduction(
                selectedStoreId === ALL_STORES_ID ? "all" : selectedStoreId,
                companyId,
            ),
            ]);

        if (!cancelled) {
          setPortfolio(portfolioResult);
          setYearly(yearlyResult);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [selectedStoreId]);

  function togglePlan(planType: string) {
    setExpandedPlans((prev) => {
      const next = new Set(prev);

      if (next.has(planType)) {
        next.delete(planType);
      } else {
        next.add(planType);
      }

      return next;
    });
  }

  if (stores.length === 0) {
    return (
      <div className="rounded-2xl border border-[#e5e8ec] bg-white p-8 text-center text-sm text-[#7d848e]">
        Não tens nenhuma loja associada.
      </div>
    );
  }

  const currentYear = yearly[yearly.length - 1] ?? null;
  const previousYear = yearly[yearly.length - 2] ?? null;

  const maxYearlyPremium = Math.max(
    ...yearly.map((y) => y.totalAnualizado),
    1,
  );

  return (
    <div className="space-y-5">
      {/* SELETOR DE LOJA */}

      {(canAccessAll && stores.length > 1) && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelectedStoreId(ALL_STORES_ID)}
            className={[
              "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition",
              selectedStoreId === ALL_STORES_ID
                ? "bg-[#20242a] text-white shadow-sm"
                : "border border-[#e5e8ec] bg-white text-[#59616d] hover:bg-[#f5f6f7]",
            ].join(" ")}
          >
            Todas as lojas
          </button>

          {stores.map((store) => {
            const isActive = store.id === selectedStoreId;

            return (
              <button
                key={store.id}
                type="button"
                onClick={() => setSelectedStoreId(store.id)}
                className={[
                  "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition",
                  isActive
                    ? "bg-[#ff4b0a] text-white shadow-sm"
                    : "border border-[#e5e8ec] bg-white text-[#59616d] hover:bg-[#f5f6f7]",
                ].join(" ")}
              >
                <Building2 className="h-4 w-4" />
                {store.name}
              </button>
            );
          })}
        </div>
      )}

      {loading || !portfolio ? (
        <div className="rounded-2xl border border-[#e5e8ec] bg-white p-8 text-center text-sm text-[#7d848e]">
          A carregar carteira...
        </div>
      ) : (
        <>
          {/* RESUMO */}

          <section className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 font-semibold text-[#20242a]">
                  <ShieldCheck className="h-4 w-4 text-[#ff4b0a]" />
                  {portfolio.storeName}
                </h2>

                <p className="mt-1 text-sm text-[#7d848e]">
                  {portfolio.totalCount} apólices ativas
                </p>
              </div>

              <div className="rounded-xl bg-[#f7f8f9] px-3 py-2 text-right">
                <p className="text-xs text-[#8a9099]">Carteira de Seguros</p>
                <p className="mt-0.5 text-sm font-semibold text-[#20242a]">
                  {formatCurrency(portfolio.seguroTotal)}
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {portfolio.plans.map((plan) => {
                const percentage =
                  portfolio.totalAnualizado > 0
                    ? (plan.annualizedPremium / portfolio.totalAnualizado) *
                      100
                    : 0;

                return (
                  <div key={plan.planType}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium text-[#343940]">
                        {planLabels[plan.planType]}
                      </span>

                      <span className="text-xs text-[#7d848e]">
                        {formatCurrency(plan.annualizedPremium)} ·{" "}
                        {plan.count} apólices
                      </span>
                    </div>

                    <div className="h-2 overflow-hidden rounded-full bg-[#f0f1f3]">
                      <div
                        className={`h-full rounded-full ${planColors[plan.planType]}`}
                        style={{
                          width: `${Math.max(percentage, plan.annualizedPremium > 0 ? 2 : 0)}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* TOTAL GERAL */}

            <div className="mt-5 flex items-center justify-between rounded-xl border border-[#e5e8ec] bg-[#fafbfc] px-4 py-3">
              <span className="text-sm font-semibold text-[#20242a]">
                Total geral (Vida + Não Vida + Financeiros)
              </span>

              <span className="text-base font-bold text-[#20242a]">
                {formatCurrency(portfolio.totalAnualizado)}
              </span>
            </div>
          </section>

          {/* EVOLUÇÃO ANUAL */}

          {yearly.length > 0 && (
            <section className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="flex items-center gap-2 font-semibold text-[#20242a]">
                    <TrendingUp className="h-4 w-4 text-[#ff4b0a]" />
                    Evolução anual
                  </h2>

                  <p className="mt-1 text-sm text-[#7d848e]">
                    Produção de apólices ativas, por ano de emissão.
                  </p>
                </div>

                {currentYear && previousYear && (
                  <ComparisonBadge
                    currentYear={currentYear.year}
                    previousYear={previousYear.year}
                    growthPct={currentYear.growthPct}
                  />
                )}
              </div>

              <div className="mt-6 flex h-[180px] items-end gap-3">
                {yearly.map((y) => {
                  const height = Math.max(
                    (y.totalAnualizado / maxYearlyPremium) * 100,
                    y.totalAnualizado > 0 ? 4 : 1,
                  );

                  return (
                    <div
                      key={y.year}
                      className="group relative flex h-full flex-1 flex-col items-center justify-end"
                    >
                      <div
                        className="w-full rounded-t-md bg-[#ff4b0a] transition-opacity hover:opacity-80"
                        style={{ height: `${height}%` }}
                      />

                      <div className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-20 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#20242a] px-3 py-2 text-xs text-white shadow-lg group-hover:block">
                        <p className="font-medium">{y.year}</p>
                        <p>{y.count} apólices</p>
                        <p>{formatCurrency(y.totalAnualizado)}</p>
                        {y.growthPct !== null && (
                          <p>{formatPct(y.growthPct)} vs {y.year - 1}</p>
                        )}
                      </div>

                      <p className="mt-2 text-xs font-medium text-[#8a9099]">
                        {y.year}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* DETALHE POR PRODUTO */}

          {portfolio.plans.map((plan) => (
            <section
              key={plan.planType}
              className="overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]"
            >
              <button
                type="button"
                onClick={() => togglePlan(plan.planType)}
                className="flex w-full items-center justify-between border-b border-[#edf0f2] px-5 py-4 text-left transition hover:bg-[#fafbfc]"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${planColors[plan.planType]}`}
                  />

                  <div>
                    <h3 className="font-semibold text-[#20242a]">
                      {planLabels[plan.planType]}
                    </h3>

                    <p className="mt-0.5 text-xs text-[#7d848e]">
                      {plan.count} apólices ·{" "}
                      {formatCurrency(plan.annualizedPremium)}
                    </p>
                  </div>
                </div>

                <ChevronDown
                  className={`h-4 w-4 text-[#9aa0a8] transition-transform ${
                    expandedPlans.has(plan.planType) ? "rotate-180" : ""
                  }`}
                />
              </button>

              {expandedPlans.has(plan.planType) && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px] text-left">
                    <thead>
                      <tr className="border-b border-[#e8eaed] bg-[#fafafa]">
                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
                          Produto
                        </th>
                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
                          Código
                        </th>
                        <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
                          Apólices
                        </th>
                        <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
                          Prémio anualizado
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-[#eef0f2]">
                      {plan.products.map((product, index) => (
                        <tr
                          key={`${product.productCode}-${index}`}
                          className="transition-colors hover:bg-[#fafafa]"
                        >
                          <td className="px-5 py-3 text-sm font-medium text-[#24272d]">
                            {product.productName ?? "—"}
                          </td>

                          <td className="px-5 py-3 text-sm text-[#8a9099]">
                            {product.productCode ?? "—"}
                          </td>

                          <td className="px-5 py-3 text-right text-sm text-[#555d68]">
                            {product.count}
                          </td>

                          <td className="px-5 py-3 text-right text-sm font-semibold text-[#24272d]">
                            {formatCurrency(product.annualizedPremium)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function ComparisonBadge({
  currentYear,
  previousYear,
  growthPct,
}: {
  currentYear: number;
  previousYear: number;
  growthPct: number | null;
}) {
  const isPositive = growthPct !== null && growthPct > 0;
  const isNegative = growthPct !== null && growthPct < 0;

  return (
    <div className="text-right">
      <p className="text-xs text-[#8a9099]">
        Carteira {currentYear} vs {previousYear}
      </p>

      <div
        className={[
          "mt-1 inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-sm font-semibold",
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
        {formatPct(growthPct)}
      </div>
    </div>
  );
}