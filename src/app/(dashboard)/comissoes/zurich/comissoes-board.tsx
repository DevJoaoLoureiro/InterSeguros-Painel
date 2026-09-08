"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, CircleAlert, Loader2 } from "lucide-react";

import {
  getZurichCommissionsDetail,
  getZurichCommissionsSummaryByStore,
  type CommissionReceiptRow,
  type StoreCommissionSummary,
  type StoreOption,
} from "./actions";

type Props = {
  stores: StoreOption[];
  canAccessAll: boolean;
  initialMonth: string;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

function monthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);

  return new Intl.DateTimeFormat("pt-PT", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, monthNumber - 1, 1));
}

function planTypeLabel(planType: string | null) {
  switch (planType) {
    case "VIDA":
      return "Vida";
    case "NAO_VIDA":
      return "Não Vida";
    case "FINANCEIROS":
      return "Financeiros";
    default:
      return "Não classificado";
  }
}

function MetricCard({
  label,
  value,
  helper,
  tone = "default",
}: {
  label: string;
  value: string;
  helper?: string;
  tone?: "default" | "orange";
}) {
  return (
    <div className="rounded-2xl border border-[#e7e9ec] bg-white p-4 shadow-[0_2px_8px_rgba(20,25,35,0.03)]">
      <p className="text-xs font-medium text-[#858c96]">{label}</p>
      <p
        className={`mt-1.5 text-xl font-semibold tracking-tight ${
          tone === "orange" ? "text-[#ff4b0a]" : "text-[#1f2329]"
        }`}
      >
        {value}
      </p>
      {helper ? <p className="mt-1 text-xs text-[#a0a6ae]">{helper}</p> : null}
    </div>
  );
}

export function ComissoesBoardZurich({ stores, initialMonth }: Props) {
  const [month, setMonth] = useState(initialMonth);

  const [summary, setSummary] = useState<StoreCommissionSummary[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommissionReceiptRow[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadedDetailKey, setLoadedDetailKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadingOverview(true);
      setOverviewError(null);
      setLoadedDetailKey(null);
      setDetail([]);

      try {
        const result = await getZurichCommissionsSummaryByStore(month);
        if (cancelled) return;

        setSummary(result);
        setSelectedStoreId((current) => {
          if (current && result.some((item) => item.storeId === current)) {
            return current;
          }
          return result[0]?.storeId ?? null;
        });
      } catch (error) {
        if (!cancelled) {
          setOverviewError(
            error instanceof Error
              ? error.message
              : "Não foi possível carregar as comissões.",
          );
        }
      } finally {
        if (!cancelled) setLoadingOverview(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [month]);

  useEffect(() => {
    if (!selectedStoreId) return;

    const key = `${month}:${selectedStoreId}`;
    if (loadedDetailKey === key) return;

    let cancelled = false;

    async function loadDetail() {
      setLoadingDetail(true);

      try {
        const result = await getZurichCommissionsDetail(
          selectedStoreId!,
          month,
        );
        if (cancelled) return;

        setDetail(result);
        setLoadedDetailKey(key);
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    }

    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [loadedDetailKey, month, selectedStoreId]);

  const totalMonth = useMemo(
    () => summary.reduce((sum, store) => sum + store.totalGeral, 0),
    [summary],
  );

  const selectedStore = useMemo(
    () => summary.find((store) => store.storeId === selectedStoreId) ?? null,
    [selectedStoreId, summary],
  );

  if (stores.length === 0) {
    return (
      <div className="rounded-2xl border border-[#e5e8ec] bg-white p-8 text-center text-sm text-[#7d848e]">
        Não tens nenhuma loja associada.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-[#e7e9ec] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-[#a0a6ae]">
            Período
          </p>
          <p className="mt-1 text-lg font-semibold capitalize text-[#20242a]">
            {monthLabel(month)}
          </p>
        </div>

        <input
          type="month"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
          className="h-10 rounded-xl border border-[#e1e4e8] bg-white px-3 text-sm outline-none focus:border-[#ff4b0a]"
        />
      </div>

      {overviewError ? (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <CircleAlert className="h-4 w-4 shrink-0" />
          {overviewError}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <MetricCard
          label="Total do mês"
          value={loadingOverview ? "—" : formatCurrency(totalMonth)}
          helper="Soma de Comissão de Cobrança + Angariação"
          tone="orange"
        />
        <MetricCard
          label="Recibos com comissão"
          value={
            loadingOverview
              ? "—"
              : String(summary.reduce((s, x) => s + x.receiptCount, 0))
          }
        />
      </div>

      <section className="space-y-4">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {summary.map((store) => {
            const active = store.storeId === selectedStoreId;
            return (
              <button
                key={store.storeId}
                type="button"
                onClick={() => {
                  setSelectedStoreId(store.storeId);
                  setLoadedDetailKey(null);
                }}
                className={[
                  "inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition",
                  active
                    ? "bg-[#20242a] text-white"
                    : "border border-[#e5e8ec] bg-white text-[#59616d] hover:bg-[#f7f8f9]",
                ].join(" ")}
              >
                <Building2 className="h-4 w-4" />
                {store.storeName}
                <span className={active ? "text-white/70" : "text-[#a0a6ae]"}>
                  {formatCurrency(store.totalGeral)}
                </span>
              </button>
            );
          })}
        </div>

        {selectedStore ? (
          <div className="overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white">
            <div className="grid gap-3 border-b border-[#edf0f2] p-4 sm:grid-cols-3">
              <MetricCard label="Vida" value={formatCurrency(selectedStore.vidaTotal)} />
              <MetricCard
                label="Não Vida"
                value={formatCurrency(selectedStore.naoVidaTotal)}
              />
              <MetricCard
                label="Total da loja"
                value={formatCurrency(selectedStore.totalGeral)}
                tone="orange"
              />
            </div>

            <div className="overflow-x-auto">
              {loadingDetail ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-[#8a9099]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  A carregar detalhe da loja...
                </div>
              ) : detail.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-[#8a9099]">
                  Sem recibos com comissão neste mês.
                </p>
              ) : (
                <table className="w-full min-w-[860px] text-left">
                  <thead>
                    <tr className="border-b border-[#e8eaed] bg-[#fafafa]">
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">Cliente</th>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">Apólice</th>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">Recibo</th>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">Ramo</th>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">Data</th>
                      <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#7a818c]">Cobrança</th>
                      <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#7a818c]">Angariação</th>
                      <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#7a818c]">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#eef0f2]">
                    {detail.map((row) => (
                      <tr key={row.receiptId} className="hover:bg-[#fafafa]">
                        <td className="px-5 py-3 text-sm font-medium text-[#24272d]">{row.clientName}</td>
                        <td className="px-5 py-3 text-sm text-[#555d68]">{row.policyNumber}</td>
                        <td className="px-5 py-3 text-sm text-[#555d68]">{row.receiptNumber ?? "—"}</td>
                        <td className="px-5 py-3 text-sm text-[#555d68]">{planTypeLabel(row.planType)}</td>
                        <td className="px-5 py-3 text-sm text-[#555d68]">{formatDate(row.commissionDate)}</td>
                        <td className="px-5 py-3 text-right text-sm text-[#555d68]">{formatCurrency(row.commissionCobranca)}</td>
                        <td className="px-5 py-3 text-right text-sm text-[#555d68]">{formatCurrency(row.commissionAngariacao)}</td>
                        <td className="px-5 py-3 text-right text-sm font-semibold text-[#24272d]">{formatCurrency(row.commissionTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : null}
      </section>

      <div className="flex items-start gap-2 rounded-xl bg-[#f7f8f9] px-4 py-3 text-xs leading-5 text-[#7d848e]">
        A Zurich não envia um fecho oficial em PDF como a Prévoir — estes
        valores vêm diretamente dos campos de comissão de cada recibo
        (Comissão de Cobrança + Comissão de Angariação).
      </div>
    </div>
  );
}