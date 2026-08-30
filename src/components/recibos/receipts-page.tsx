"use client";

import Link from "next/link";
import {
  useRouter,
  useSearchParams,
} from "next/navigation";

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  RotateCcw,
  Search,
  Undo2,
} from "lucide-react";

import type {
  PremiumMode,
  ReceiptFilters,
  ReceiptRow,
  ReceiptsPageData,
} from "./types";

type Props = {
  data: ReceiptsPageData;
  filters: ReceiptFilters;
  premiumMode: PremiumMode;
};

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

  return new Intl.DateTimeFormat("pt-PT").format(
    new Date(`${value}T12:00:00`),
  );
}

function getStatusLabel(status: string) {
  switch (status) {
    case "PAID":
      return "Cobrado";
    case "PENDING":
      return "Pendente";
    case "RETURNED":
      return "Devolvido";
    case "CANCELLED":
      return "Cancelado";
    default:
      return status || "—";
  }
}

function isReversal(receipt: ReceiptRow) {
  const type = receipt.receipt_type?.trim().toUpperCase();

  return (
    receipt.external_nature === "9" ||
    type === "REVERSAL" ||
    type === "ESTORNO"
  );
}

function StatusBadge({ receipt }: { receipt: ReceiptRow }) {
  if (isReversal(receipt)) {
    return (
      <span className="inline-flex rounded-full bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-700">
        Estorno
      </span>
    );
  }

  const styles =
    receipt.status === "PAID"
      ? "bg-emerald-50 text-emerald-700"
      : receipt.status === "PENDING"
        ? "bg-amber-50 text-amber-700"
        : receipt.status === "RETURNED"
          ? "bg-red-50 text-red-700"
          : "bg-slate-100 text-slate-600";

  return (
    <span
      className={["inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", styles].join(" ")}
    >
      {getStatusLabel(receipt.status)}
    </span>
  );
}

function StatCard({
  title,
  count,
  value,
  icon: Icon,
}: {
  title: string;
  count: number;
  value: number;
  icon: typeof CheckCircle2;
}) {
  return (
    <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-[#737a84]">{title}</p>

        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f7f7f8]">
          <Icon className="h-5 w-5 text-[#4d5560]" />
        </div>
      </div>

      <p className="mt-4 text-2xl font-semibold tracking-tight text-[#17191d]">
        {formatCurrency(value)}
      </p>

      <p className="mt-1 text-xs text-[#8a9099]">
        {count} {count === 1 ? "recibo" : "recibos"}
      </p>
    </div>
  );
}

export function ReceiptsPage({ data, filters, premiumMode }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function updateParams(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }

    router.push(`/recibos?${params.toString()}`);
  }

  const premiumKey = premiumMode === "total" ? "total" : "commercial";
  const hasFilters = Boolean(
    filters.search ||
      filters.from ||
      filters.to ||
      filters.company ||
      filters.status,
  );

  return (
    <div className="space-y-6">
      {/* ====================================
          HEADER
      ==================================== */}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-[#ff4b0a]">Carteira</p>

          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
            Recibos
          </h1>

          <p className="mt-1 text-sm text-[#707782]">
            Cobranças, pendentes, devoluções e estornos.
          </p>
        </div>

        <div className="inline-flex w-fit rounded-xl border border-[#e5e8ec] bg-white p-1">
          <button
            type="button"
            onClick={() =>
              updateParams({ premium: "commercial", page: "1" })
            }
            className={[
              "rounded-lg px-4 py-2 text-sm font-medium transition",
              premiumMode === "commercial"
                ? "bg-[#242a32] text-white"
                : "text-[#68707b] hover:bg-[#f5f6f7]",
            ].join(" ")}
          >
            Prémio Comercial
          </button>

          <button
            type="button"
            onClick={() => updateParams({ premium: "total", page: "1" })}
            className={[
              "rounded-lg px-4 py-2 text-sm font-medium transition",
              premiumMode === "total"
                ? "bg-[#242a32] text-white"
                : "text-[#68707b] hover:bg-[#f5f6f7]",
            ].join(" ")}
          >
            Prémio Total
          </button>
        </div>
      </div>

      {/* ====================================
          METRICS
      ==================================== */}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Cobrado"
          count={data.stats.paid.count}
          value={data.stats.paid[premiumKey]}
          icon={CheckCircle2}
        />

        <StatCard
          title="Pendente"
          count={data.stats.pending.count}
          value={data.stats.pending[premiumKey]}
          icon={Clock3}
        />

        <StatCard
          title="Devolvido"
          count={data.stats.returned.count}
          value={data.stats.returned[premiumKey]}
          icon={Undo2}
        />

        <StatCard
          title="Estornos"
          count={data.stats.reversals.count}
          value={data.stats.reversals[premiumKey]}
          icon={RotateCcw}
        />
      </section>

      {/* ====================================
          FILTERS
      ==================================== */}

      <section className="rounded-2xl border border-[#e5e8ec] bg-white p-4 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        <form
          className="grid gap-3 md:grid-cols-2 xl:grid-cols-6"
          onSubmit={(event) => {
            event.preventDefault();

            const formData = new FormData(event.currentTarget);

            updateParams({
              search: String(formData.get("search") ?? ""),
              from: String(formData.get("from") ?? ""),
              to: String(formData.get("to") ?? ""),
              company: String(formData.get("company") ?? ""),
              status: String(formData.get("status") ?? ""),
              page: "1",
            });
          }}
        >
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa0a8]" />

            <input
              name="search"
              defaultValue={filters.search}
              placeholder="Cliente, NIF, apólice ou recibo..."
              className="w-full rounded-xl border border-[#e1e4e8] py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-[#ff4b0a]"
            />
          </div>

          <input
            type="date"
            name="from"
            defaultValue={filters.from}
            className="rounded-xl border border-[#e1e4e8] px-4 py-2.5 text-sm outline-none focus:border-[#ff4b0a]"
          />

          <input
            type="date"
            name="to"
            defaultValue={filters.to}
            className="rounded-xl border border-[#e1e4e8] px-4 py-2.5 text-sm outline-none focus:border-[#ff4b0a]"
          />

          <select
            name="company"
            defaultValue={filters.company}
            className="rounded-xl border border-[#e1e4e8] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#ff4b0a]"
          >
            <option value="">Todas as companhias</option>

            {data.companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>

          <select
            name="status"
            defaultValue={filters.status}
            className="rounded-xl border border-[#e1e4e8] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#ff4b0a]"
          >
            <option value="">Todos os estados</option>
            <option value="PAID">Cobrado</option>
            <option value="PENDING">Pendente</option>
            <option value="RETURNED">Devolvido</option>
            <option value="CANCELLED">Cancelado</option>
          </select>

          <div className="flex gap-2 md:col-span-2 xl:col-span-6">
            <button
              type="submit"
              className="rounded-xl bg-[#ff4b0a] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#e7430a]"
            >
              Aplicar filtros
            </button>

            {hasFilters && (
              <Link
                href={`/recibos?premium=${premiumMode}`}
                className="rounded-xl border border-[#e1e4e8] px-5 py-2.5 text-sm font-medium text-[#59616d] transition hover:bg-[#f5f6f7]"
              >
                Limpar
              </Link>
            )}
          </div>
        </form>
      </section>

      {/* ====================================
          LIST
      ==================================== */}

      <section className="overflow-hidden rounded-2xl border border-[#e8eaed] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        <div className="flex items-center justify-between border-b border-[#edf0f2] px-5 py-4">
          <div>
            <h2 className="font-semibold text-[#20242a]">Recibos</h2>

            <p className="mt-1 text-sm text-[#7d848e]">
              {data.totalCount} {data.totalCount === 1 ? "recibo" : "recibos"}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px]">
            <thead>
              <tr className="border-b border-[#e8eaed] bg-[#fafafa]">
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
                  Recibo
                </th>

                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
                  Apólice
                </th>

                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
                  Cliente
                </th>

                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
                  Companhia
                </th>

                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
                  Loja
                </th>

                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
                  Vencimento
                </th>

                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
                  Estado
                </th>

                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
                  Prémio Comercial
                </th>

                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
                  Prémio Total
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[#eef0f2]">
              {data.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-5 py-16 text-center text-sm text-[#8a9099]"
                  >
                    Nenhum recibo encontrado.
                  </td>
                </tr>
              ) : (
                data.items.map((receipt) => (
                  <tr
                    key={receipt.id}
                    className="transition-colors hover:bg-[#fafafa]"
                  >
                    <td className="px-5 py-4 text-sm font-semibold text-[#24272d]">
                      {receipt.receipt_number ?? "—"}
                    </td>

                    <td className="px-5 py-4 text-sm text-[#555d68]">
                      {receipt.policy?.policy_number ?? "—"}
                    </td>

                    <td className="px-5 py-4">
                      <p className="text-sm font-medium text-[#24272d]">
                        {receipt.policy?.client?.name ?? "—"}
                      </p>

                      {receipt.policy?.client?.nif && (
                        <p className="mt-0.5 text-xs text-[#8a9099]">
                          NIF {receipt.policy.client.nif}
                        </p>
                      )}
                    </td>

                    <td className="px-5 py-4 text-sm text-[#555d68]">
                      {receipt.company?.name ?? "—"}
                    </td>

                    <td className="px-5 py-4 text-sm text-[#555d68]">
                      {receipt.policy?.issuing_store?.name ?? "—"}
                    </td>

                    <td className="px-5 py-4 text-sm text-[#555d68]">
                      {formatDate(receipt.due_date)}
                    </td>

                    <td className="px-5 py-4">
                      <StatusBadge receipt={receipt} />
                    </td>

                    <td className="px-5 py-4 text-right text-sm font-medium text-[#343941]">
                      {formatCurrency(receipt.commercial_premium ?? 0)}
                    </td>

                    <td className="px-5 py-4 text-right text-sm font-semibold text-[#24272d]">
                      {formatCurrency(receipt.total_premium ?? 0)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* PAGINATION */}

        {data.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-[#edf0f2] px-5 py-3">
            <p className="text-xs text-[#8a9099]">
              Página {data.page} de {data.totalPages}
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={data.page <= 1}
                onClick={() =>
                  updateParams({ page: String(data.page - 1) })
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e1e4e8] px-3 py-1.5 text-xs font-medium text-[#59616d] transition hover:bg-[#f5f6f7] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Anterior
              </button>

              <button
                type="button"
                disabled={data.page >= data.totalPages}
                onClick={() =>
                  updateParams({ page: String(data.page + 1) })
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e1e4e8] px-3 py-1.5 text-xs font-medium text-[#59616d] transition hover:bg-[#f5f6f7] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Seguinte
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}