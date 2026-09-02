"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Building2,
  CalendarDays,
  CreditCard,
  ReceiptText,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";

import { assignCurrentUserToPolicy } from "@/app/(dashboard)/clientes/action";
import {
  getPolicyReceipts,
  type PolicyReceiptRow,
} from "@/app/(dashboard)/clientes/receipts-action";

import type { PolicyRow } from "@/components/clientes/types";

type Props = {
  clientName: string;
  clientNif: string | null;
  policies: PolicyRow[];
  open: boolean;
  onClose: () => void;
};

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "—";
  }

  const clean = value.slice(0, 10);
  const date = new Date(`${clean}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "—";
  }

  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function getFrequencyLabel(value: PolicyRow["payment_frequency"]) {
  switch (value) {
    case "ANNUAL":
      return "Anual";
    case "SEMIANNUAL":
      return "Semestral";
    case "QUARTERLY":
      return "Trimestral";
    case "MONTHLY":
      return "Mensal";
    case "SINGLE":
      return "Único";
    case "OTHER":
      return "Outro";
    default:
      return "—";
  }
}


function isPendingRisk(policy: PolicyRow) {
  if (policy.status !== "ACTIVE" || !policy.start_date) {
    return false;
  }

  const today = new Date().toISOString().slice(0, 10);
  return policy.start_date > today;
}

function getStatusLabel(status: PolicyRow["status"]) {
  switch (status) {
    case "ACTIVE":
      return "Ativa";
    case "PENDING":
      return "Pendente";
    case "CANCELLED":
      return "Anulada";
    case "EXPIRED":
      return "Expirada";
    case "SUSPENDED":
      return "Suspensa";
    case "REDUCED":
      return "Reduzida";
    case "UNKNOWN":
      return "Por classificar";
    default:
      return status;
  }
}

function getStatusClasses(status: PolicyRow["status"]) {
  switch (status) {
    case "ACTIVE":
      return "border-green-200 bg-green-50 text-green-700";
    case "PENDING":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "CANCELLED":
      return "border-red-200 bg-red-50 text-red-700";
    case "EXPIRED":
      return "border-slate-200 bg-slate-50 text-slate-600";
    case "SUSPENDED":
      return "border-orange-200 bg-orange-50 text-orange-700";
    case "REDUCED":
      return "border-violet-200 bg-violet-50 text-violet-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function getLineLabel(policy: PolicyRow) {
  if (policy.insurance_line) {
    return policy.insurance_line.name;
  }

  return policy.product_name ?? "Produto";
}

/*
 * Label da pill: código do ramo se existir.
 * Se dois policies partilharem o mesmo código
 * (ex: dois seguros de Vida), desambigua com
 * os últimos dígitos do número da apólice.
 */
function buildPillLabels(policies: PolicyRow[]) {
  const codeCounts = new Map<string, number>();

  for (const policy of policies) {
    const code = policy.insurance_line?.code ?? "—";
    codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
  }

  return policies.map((policy) => {
    const code = policy.insurance_line?.code ?? "—";
    const isDuplicate = (codeCounts.get(code) ?? 0) > 1;

    return {
      policyId: policy.id,
      label: isDuplicate
        ? `${code} #${policy.policy_number.slice(-4)}`
        : code,
    };
  });
}

function getReceiptStatusLabel(status: string, isReversal: boolean) {
  if (isReversal) {
    return "Estorno";
  }

  switch (status) {
    case "PAID":
      return "Cobrado";
    case "PENDING":
      return "Pendente";
    case "RETURNED":
      return "Devolvido";
    case "CANCELLED":
      return "Anulado";
    case "OVERDUE":
      return "Em atraso";
    default:
      return "—";
  }
}

function getReceiptStatusClasses(status: string, isReversal: boolean) {
  if (isReversal) {
    return "border-slate-300 bg-slate-100 text-slate-700";
  }

  switch (status) {
    case "PAID":
      return "border-green-200 bg-green-50 text-green-700";
    case "PENDING":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "RETURNED":
      return "border-red-200 bg-red-50 text-red-700";
    case "CANCELLED":
      return "border-slate-200 bg-slate-50 text-slate-600";
    case "OVERDUE":
      return "border-red-200 bg-red-50 text-red-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

export function PolicyDetailsDrawer({
  clientName,
  clientNif,
  policies,
  open,
  onClose,
}: Props) {
  const [activePolicyId, setActivePolicyId] = useState<string | null>(
    null,
  );

  const [receipts, setReceipts] = useState<PolicyReceiptRow[]>([]);
  const [loadingReceipts, setLoadingReceipts] = useState(false);
  const [receiptsError, setReceiptsError] = useState<string | null>(
    null,
  );

  const [isAssigning, startAssignTransition] = useTransition();
  const [assignedUser, setAssignedUser] = useState<{
    id: string;
    full_name: string;
  } | null>(null);

  const pillLabels = useMemo(
    () => buildPillLabels(policies),
    [policies],
  );

  // Sempre que o drawer abre com um novo cliente,
  // seleciona a primeira apólice por defeito.
  useEffect(() => {
    if (open && policies.length > 0) {
      setActivePolicyId(policies[0].id);
    }
  }, [open, policies]);

  const activePolicy = useMemo(
    () => policies.find((p) => p.id === activePolicyId) ?? null,
    [policies, activePolicyId],
  );

  useEffect(() => {
    setAssignedUser(activePolicy?.commercial_user ?? null);
  }, [activePolicy?.id, activePolicy?.commercial_user]);

  useEffect(() => {
    if (!open || !activePolicy) {
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        setLoadingReceipts(true);
        setReceiptsError(null);

        const result = await getPolicyReceipts(activePolicy!.id);

        if (!cancelled) {
          setReceipts(result);
        }
      } catch (error) {
        if (!cancelled) {
          setReceiptsError(
            error instanceof Error
              ? error.message
              : "Erro ao carregar recibos.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingReceipts(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [open, activePolicy]);

  function handleAssignMe() {
    if (!activePolicy) {
      return;
    }

    startAssignTransition(async () => {
      try {
        const result = await assignCurrentUserToPolicy(
          activePolicy.id,
        );

        setAssignedUser({
          id: result.commercialUser.id,
          full_name: result.commercialUser.full_name,
        });
      } catch (error) {
        window.alert(
          error instanceof Error
            ? error.message
            : "Não foi possível associar a apólice.",
        );
      }
    });
  }

  if (!open || !activePolicy) {
    return null;
  }

  const nonReversalReceipts = receipts.filter((r) => !r.isReversal);

  const totalCollected = nonReversalReceipts
    .filter((r) => r.status === "PAID")
    .reduce((sum, r) => sum + (r.commercial_premium ?? 0), 0);

  const pendingCount = nonReversalReceipts.filter(
    (r) => r.status === "PENDING",
  ).length;

  const latestPeriodEndReceipt = [...nonReversalReceipts]
  .filter((r) => r.period_end)
  .sort((a, b) => (b.period_end! > a.period_end! ? 1 : -1))[0];

const estimatedRenewalDate = latestPeriodEndReceipt?.period_end ?? null;

  return (
    <div className="fixed inset-0 z-[100]">
      {/* OVERLAY */}

      <button
        type="button"
        aria-label="Fechar detalhe da apólice"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/35 backdrop-blur-[1px]"
      />

      {/* DRAWER */}

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Detalhe do cliente"
        className="absolute right-0 top-0 flex h-dvh w-full max-w-[680px] flex-col bg-[#f7f8fc] shadow-2xl"
      >
        {/* HEADER */}

        <header className="shrink-0 border-b border-[#e5e8ec] bg-white px-5 py-5 sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-semibold tracking-tight text-[#17191d]">
                {clientName}
              </h2>

              <p className="mt-1 text-sm text-[#6f7680]">
                NIF {clientNif ?? "—"}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#e1e4e8] text-[#59616d] transition hover:bg-[#f4f5f7]"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* PILLS — TROCAR DE APÓLICE */}

          {pillLabels.length > 1 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {pillLabels.map((pill) => {
                const isActive = pill.policyId === activePolicyId;

                return (
                  <button
                    key={pill.policyId}
                    type="button"
                    onClick={() => setActivePolicyId(pill.policyId)}
                    className={[
                      "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                      isActive
                        ? "bg-[#ff4b0a] text-white shadow-sm"
                        : "bg-[#f4f5f7] text-[#59616d] hover:bg-[#eceef0]",
                    ].join(" ")}
                  >
                    {pill.label}
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span
              className={
                isPendingRisk(activePolicy)
                  ? "inline-flex rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700"
                  : `inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getStatusClasses(activePolicy.status)}`
              }
            >
              {isPendingRisk(activePolicy)
                ? "Aguarda início de risco"
                : getStatusLabel(activePolicy.status)}
            </span>

            <span className="text-xs text-[#8a9099]">
              {getLineLabel(activePolicy)} · Apólice{" "}
              {activePolicy.policy_number}
            </span>
          </div>
        </header>

        {/* BODY */}

        <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          {/* DADOS DA APÓLICE */}

          <section className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-sm">
            <h3 className="flex items-center gap-2 font-semibold text-[#20242a]">
              <ShieldCheck className="h-4 w-4 text-[#ff4b0a]" />
              Dados da apólice
            </h3>

            <dl className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-[#8a9099]">Companhia</dt>
                <dd className="mt-1 text-sm font-medium text-[#333842]">
                  {activePolicy.company?.name ?? "—"}
                </dd>
              </div>

              <div>
                <dt className="text-xs text-[#8a9099]">Produto</dt>
                <dd className="mt-1 text-sm font-medium text-[#333842]">
                  {activePolicy.product_name ?? "—"}
                </dd>
              </div>

              <div>
                <dt className="flex items-center gap-1 text-xs text-[#8a9099]">
                  <CreditCard className="h-3.5 w-3.5" />
                  Prémio anualizado
                </dt>
                <dd className="mt-1 text-sm font-medium text-[#333842]">
                  {formatCurrency(activePolicy.annualized_premium)}
                  <span className="ml-1 text-xs text-[#8a9099]">
                    ({getFrequencyLabel(activePolicy.payment_frequency)})
                  </span>
                </dd>
              </div>

              <div>
                <dt className="flex items-center gap-1 text-xs text-[#8a9099]">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Emissão
                </dt>
                <dd className="mt-1 text-sm font-medium text-[#333842]">
                  {formatDate(activePolicy.issue_date)}
                </dd>
              </div>

              <div>
                <dt className="flex items-center gap-1 text-xs text-[#8a9099]">
                    <CalendarDays className="h-3.5 w-3.5" />
                    Renovação
                </dt>
                <dd className="mt-1 text-sm font-medium text-[#333842]">
                    {estimatedRenewalDate
                    ? formatDate(estimatedRenewalDate)
                    : "Sem recibos suficientes"}
                </dd>
                {estimatedRenewalDate && (
                    <p className="mt-0.5 text-xs text-[#8a9099]">
                    Baseado no último recibo
                    </p>
                )}
                </div>

              <div>
                <dt className="flex items-center gap-1 text-xs text-[#8a9099]">
                  <Building2 className="h-3.5 w-3.5" />
                  Loja
                </dt>
                <dd className="mt-1 text-sm font-medium text-[#333842]">
                  {activePolicy.issuing_store?.name ?? "Por associar"}
                </dd>
                
              </div>

              <div className="sm:col-span-2">
                <dt className="flex items-center gap-1 text-xs text-[#8a9099]">
                  <UserRound className="h-3.5 w-3.5" />
                  Comercial
                </dt>

                {assignedUser ? (
                  <dd className="mt-1 text-sm font-medium text-[#333842]">
                    {assignedUser.full_name}
                  </dd>
                ) : (
                  <>
                    <dd className="mt-1 text-sm font-medium text-[#333842]">
                      Por associar
                    </dd>

                    <button
                      type="button"
                      disabled={isAssigning}
                      onClick={handleAssignMe}
                      className="mt-1 text-xs font-semibold text-[#ff4b0a] transition hover:text-[#df3f06] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isAssigning ? "A associar..." : "Associar-me"}
                    </button>
                  </>
                )}
              </div>
            </dl>
          </section>

          {/* RECIBOS */}

          <section className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-semibold text-[#20242a]">
                <ReceiptText className="h-4 w-4 text-[#ff4b0a]" />
                Recibos
              </h3>

              {receipts.length > 0 && (
                <span className="text-xs text-[#8a9099]">
                  {receipts.length} recibo(s)
                </span>
              )}
            </div>

            {receipts.length > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-[#fafbfc] px-3 py-2.5">
                  <p className="text-[11px] text-[#8a9099]">
                    Total cobrado
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-green-700">
                    {formatCurrency(totalCollected)}
                  </p>
                </div>

                <div className="rounded-xl bg-[#fafbfc] px-3 py-2.5">
                  <p className="text-[11px] text-[#8a9099]">Pendentes</p>
                  <p className="mt-0.5 text-sm font-semibold text-amber-700">
                    {pendingCount}
                  </p>
                </div>
              </div>
            )}

            {loadingReceipts && (
              <p className="mt-5 text-sm text-[#7d848e]">
                A carregar recibos...
              </p>
            )}

            {receiptsError && (
              <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {receiptsError}
              </div>
            )}

            {!loadingReceipts &&
              !receiptsError &&
              receipts.length === 0 && (
                <p className="mt-5 text-sm text-[#7d848e]">
                  Ainda não existem recibos para esta apólice.
                </p>
              )}

            {!loadingReceipts && receipts.length > 0 && (
              <div className="mt-5 divide-y divide-[#edf0f2]">
                {receipts.map((receipt) => (
                  <div
                    key={receipt.id}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-[#20242a]">
                          {receipt.receipt_number ?? "Sem número"}
                        </p>

                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getReceiptStatusClasses(receipt.status, receipt.isReversal)}`}
                        >
                          {getReceiptStatusLabel(
                            receipt.status,
                            receipt.isReversal,
                          )}
                        </span>
                      </div>

                      <p className="mt-1 text-xs text-[#8a9099]">
                        {receipt.period_start && receipt.period_end
                          ? `${formatDate(receipt.period_start)} — ${formatDate(receipt.period_end)}`
                          : `Vencimento: ${formatDate(receipt.due_date)}`}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-sm font-semibold text-[#20242a]">
                        {formatCurrency(receipt.commercial_premium)}
                      </p>
                      <p className="text-xs text-[#8a9099]">
                        Total: {formatCurrency(receipt.total_premium)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}