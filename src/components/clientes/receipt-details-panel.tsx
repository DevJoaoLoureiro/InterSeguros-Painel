"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  Loader2,
  RefreshCw,
  StickyNote,
  Undo2,
  X,
  XCircle,
} from "lucide-react";

import {
  getReceiptDetail,
  type ReceiptDetail,
} from "@/app/(dashboard)/clientes/receipts-action";

// ============================================================
// FORMATAÇÃO
// ============================================================

function formatDate(value: string | null | undefined) {
  if (!value) return "—";

  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";

  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function daysFromToday(value: string) {
  const target = new Date(`${value.slice(0, 10)}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

const paymentMethodLabels: Record<string, string> = {
  DIRECT_DEBIT: "Débito direto",
  BANK_TRANSFER: "Transferência bancária",
  CASH: "Numerário",
  CARD: "Cartão",
  MBWAY: "MB WAY",
  CHEQUE: "Cheque",
  OTHER: "Outro",
};

function paymentMethodLabel(detail: ReceiptDetail) {
  if (detail.payment_method && paymentMethodLabels[detail.payment_method]) {
    return paymentMethodLabels[detail.payment_method];
  }

  // Prévoir: "T" = tesouraria da companhia.
  if (detail.external_payment_method?.toUpperCase() === "T") {
    return "Tesouraria da companhia";
  }

  return "Não indicada pela companhia";
}

// ============================================================
// SITUAÇÃO
// ============================================================

type Situation = {
  label: string;
  description: string;
  icon: typeof CheckCircle2;
  tone: string;
};

function getSituation(detail: ReceiptDetail): Situation {
  if (detail.isReversal) {
    return {
      label: "Estorno",
      description: "Devolução de prémio ao cliente.",
      icon: Undo2,
      tone: "border-slate-200 bg-slate-50 text-slate-700",
    };
  }

  switch (detail.status) {
    case "PAID":
      return {
        label: "Cobrado",
        description: detail.payment_date
          ? `Pago a ${formatDate(detail.payment_date)}.`
          : "Pagamento confirmado pela companhia.",
        icon: CheckCircle2,
        tone: "border-green-200 bg-green-50 text-green-700",
      };

    case "PENDING":
    case "OVERDUE": {
      const days = detail.due_date ? daysFromToday(detail.due_date) : null;

      if (days !== null && days < 0) {
        return {
          label: "Em atraso",
          description: `Venceu há ${Math.abs(days)} dia${Math.abs(days) === 1 ? "" : "s"} (${formatDate(detail.due_date)}).`,
          icon: AlertTriangle,
          tone: "border-red-200 bg-red-50 text-red-700",
        };
      }

      return {
        label: "Por cobrar",
        description:
          days === null
            ? "Aguarda pagamento."
            : days === 0
              ? "Vence hoje."
              : `Vence em ${days} dia${days === 1 ? "" : "s"} (${formatDate(detail.due_date)}).`,
        icon: Clock,
        tone: "border-amber-200 bg-amber-50 text-amber-700",
      };
    }

    case "RETURNED":
      return {
        label: "Devolvido",
        description: "O pagamento foi devolvido (ex.: débito rejeitado).",
        icon: Undo2,
        tone: "border-red-200 bg-red-50 text-red-700",
      };

    case "CANCELLED":
      return {
        label: "Anulado",
        description: detail.cancellation_date
          ? `Anulado a ${formatDate(detail.cancellation_date)}.`
          : "Recibo anulado pela companhia.",
        icon: XCircle,
        tone: "border-slate-200 bg-slate-50 text-slate-600",
      };

    default:
      return {
        label: "Por classificar",
        description: "Estado não reconhecido.",
        icon: FileText,
        tone: "border-slate-200 bg-slate-50 text-slate-600",
      };
  }
}

// ============================================================
// PEÇAS
// ============================================================

function Card({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof FileText;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-sm">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-[#20242a]">
        <Icon className="h-4 w-4 text-[#ff4b0a]" />
        {title}
      </h4>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-xs text-[#8a9099]">{label}</dt>
      <dd className="text-right text-sm font-medium text-[#333842]">
        {value}
      </dd>
    </div>
  );
}

// ============================================================
// PAINEL
// ============================================================

export function ReceiptDetailsPanel({
  receiptId,
  preloaded,
  onBack,
  onClose,
}: {
  receiptId: string;
  // Detalhe que já veio com o painel da apólice: abre sem pedido.
  preloaded?: ReceiptDetail | null;
  onBack: () => void;
  onClose: () => void;
}) {
  const [fetched, setFetched] = useState<ReceiptDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const detail = preloaded ?? fetched;

  useEffect(() => {
    if (preloaded) return;

    let cancelled = false;

    getReceiptDetail(receiptId)
      .then((result) => {
        if (!cancelled) setFetched(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Erro ao carregar recibo.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [receiptId, preloaded]);

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-[#f7f8fc]">
      {/* HEADER */}

      <header className="shrink-0 border-b border-[#e5e8ec] bg-white px-5 py-4 sm:px-7">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-[#59616d] transition hover:bg-[#f4f5f7] hover:text-[#20242a]"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar aos recibos
          </button>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#e1e4e8] text-[#59616d] transition hover:bg-[#f4f5f7]"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {detail && (
          <div className="mt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-[#ff4b0a]">
              {detail.receipt_type ?? "Recibo"}
            </p>
            <h2 className="mt-0.5 text-2xl font-semibold tracking-tight text-[#17191d]">
              Recibo nº {detail.receipt_number ?? "—"}
            </h2>
            <p className="mt-1 text-sm text-[#6f7680]">
              Apólice {detail.policy_number ?? "—"}
              {detail.line_name || detail.product_name
                ? ` · ${detail.line_name ?? detail.product_name}`
                : ""}
              {detail.company_name ? ` · ${detail.company_name}` : ""}
            </p>
          </div>
        )}
      </header>

      {/* BODY */}

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {!detail && !error && (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-[#7d848e]">
            <Loader2 className="h-4 w-4 animate-spin" />A carregar recibo...
          </div>
        )}

        {detail && <ReceiptBody detail={detail} />}
      </div>
    </div>
  );
}

function ReceiptBody({ detail }: { detail: ReceiptDetail }) {
  const situation = getSituation(detail);
  const SituationIcon = situation.icon;

  const charges =
    detail.total_premium !== null && detail.commercial_premium !== null
      ? detail.total_premium - detail.commercial_premium
      : null;

  const commissions = detail.commissions;

  // Percentagem da comissão sobre o prémio comercial.
  const commissionPct =
    commissions && detail.commercial_premium
      ? (commissions.total / detail.commercial_premium) * 100
      : null;

  return (
    <div className="space-y-5">
      {/* RESUMO: situação + prémio total */}

      <section className="overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-sm">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${situation.tone}`}
            >
              <SituationIcon className="h-3.5 w-3.5" />
              {situation.label}
            </span>
            <p className="mt-2 text-sm text-[#59616d]">
              {situation.description}
            </p>

            {detail.client_name && (
              <p className="mt-3 text-xs text-[#8a9099]">
                Tomador:{" "}
                <span className="font-medium text-[#40464f]">
                  {detail.client_name}
                </span>
                {detail.client_nif ? ` · NIF ${detail.client_nif}` : ""}
              </p>
            )}
          </div>

          <div className="shrink-0 sm:text-right">
            <p className="text-xs font-medium text-[#8a9099]">Prémio total</p>
            <p className="mt-0.5 text-3xl font-bold tracking-tight text-[#17191d]">
              {formatCurrency(detail.total_premium)}
            </p>
          </div>
        </div>

        {/* DECOMPOSIÇÃO */}

        <dl className="border-t border-[#edf0f2] bg-[#fafbfc] px-5 py-3">
          <Field
            label="Prémio comercial"
            value={
              <span className="font-normal text-[#59616d]">
                {formatCurrency(detail.commercial_premium)}
              </span>
            }
          />
          {charges !== null && (
            <Field
              label="Impostos e encargos"
              value={
                <span className="font-normal text-[#59616d]">
                  {formatCurrency(charges)}
                </span>
              }
            />
          )}

          {commissions && (
            <>
              <Field
                label={`Comissão${commissions.externalType ? ` (${commissions.externalType})` : ""}`}
                value={
                  <span className="font-semibold text-emerald-700">
                    {formatCurrency(commissions.total)}
                    {commissionPct !== null && (
                      <span className="ml-1.5 text-xs font-normal text-[#8a9099]">
                        {commissionPct.toFixed(2)}% do comercial
                      </span>
                    )}
                  </span>
                }
              />
              {commissions.parts.map((part) => (
                <div
                  key={part.type}
                  className="flex justify-between py-0.5 pl-4 text-xs italic text-[#8a9099]"
                >
                  <span>{part.label}</span>
                  <span>{formatCurrency(part.amount)}</span>
                </div>
              ))}
            </>
          )}

          <div className="mt-2 flex items-baseline justify-between border-t border-[#e5e8ec] pt-2.5">
            <span className="text-sm font-semibold text-[#20242a]">
              Prémio total
            </span>
            <span className="text-lg font-bold text-[#17191d]">
              {formatCurrency(detail.total_premium)}
            </span>
          </div>
        </dl>
      </section>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {/* DATAS */}

        <Card title="Período e datas" icon={CalendarDays}>
          <dl>
            <Field
              label="Período"
              value={
                detail.period_start || detail.period_end
                  ? `${formatDate(detail.period_start)} → ${formatDate(detail.period_end)}`
                  : "—"
              }
            />
            <Field label="Emissão" value={formatDate(detail.issue_date)} />
            <Field label="Vencimento" value={formatDate(detail.due_date)} />
            <Field label="Pagamento" value={formatDate(detail.payment_date)} />
            {detail.situation_date && (
              <Field
                label="Data da situação"
                value={formatDate(detail.situation_date)}
              />
            )}
            {detail.cancellation_date && (
              <Field
                label="Anulação"
                value={formatDate(detail.cancellation_date)}
              />
            )}
          </dl>
        </Card>

        {/* PAGAMENTO */}

        <Card title="Pagamento" icon={CreditCard}>
          <div className="flex items-center gap-3 rounded-xl bg-[#fafbfc] px-3 py-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#ff4b0a] shadow-sm">
              <Banknote className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs text-[#8a9099]">Forma de pagamento</p>
              <p className="text-sm font-semibold text-[#20242a]">
                {paymentMethodLabel(detail)}
              </p>
            </div>
          </div>

          <dl className="mt-2">
            {detail.collected_by && (
              <Field label="Cobrado por" value={detail.collected_by} />
            )}
            {detail.collection_store && (
              <Field label="Loja de cobrança" value={detail.collection_store} />
            )}
            {detail.cancellation_reason && (
              <Field
                label="Motivo devolução/anulação"
                value={detail.cancellation_reason}
              />
            )}
          </dl>
        </Card>
      </div>

      {/* DADOS DA COMPANHIA */}

      {detail.provider_details.length > 0 && (
        <Card
          title={`Dados da ${detail.company_name ?? "companhia"}`}
          icon={Building2}
        >
          <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            {detail.provider_details.map((item) => (
              <Field key={item.label} label={item.label} value={item.value} />
            ))}
          </dl>
        </Card>
      )}

      {detail.notes && (
        <Card title="Notas" icon={StickyNote}>
          <p className="whitespace-pre-wrap text-sm text-[#40464f]">
            {detail.notes}
          </p>
        </Card>
      )}

      {detail.last_synced_at && (
        <p className="flex items-center justify-center gap-1.5 text-xs text-[#a0a5ac]">
          <RefreshCw className="h-3 w-3" />
          Sincronizado com a companhia a {formatDateTime(detail.last_synced_at)}
        </p>
      )}
    </div>
  );
}
