"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  CalendarClock,
  CheckCircle2,
  ListPlus,
  Phone,
  RefreshCw,
  UserX,
} from "lucide-react";

import { clientHref } from "@/lib/clients/client-link";
import { createRenewalTask } from "@/app/(dashboard)/vencimentos/action";
import { Toaster, useToasts } from "@/components/tarefas/toasts";

type RenewalRow = {
  policyId: string;
  policyNumber: string;
  clientId: string | null;
  clientName: string;
  companyName: string;
  lineName: string | null;
  renewalDate: string;
  annualizedPremium: number | null;
  storeId: string | null;
  storeName: string | null;
  overdue: boolean;
};

type UpcomingReceiptRow = {
  receiptId: string;
  receiptNumber: string | null;
  policyNumber: string;
  clientId: string | null;
  clientName: string;
  companyName: string;
  dueDate: string;
  commercialPremium: number | null;
  totalPremium: number | null;
  storeId: string | null;
  storeName: string | null;
  overdue: boolean;
};

type LikelySwitchRow = {
  policyId: string;
  policyNumber: string;
  clientId: string | null;
  clientName: string;
  clientPhone: string | null;
  companyName: string;
  lineName: string | null;
  annualizedPremium: number | null;
  storeId: string | null;
  storeName: string | null;
  exitDate: string;
  exitReason: "CANCELLED" | "EXPIRED" | "NO_NEW_RECEIPTS";
  hasOpenTask: boolean;
};

type Tab = "renewals" | "receipts" | "switches";

type Props = {
  renewals: RenewalRow[];
  upcomingReceipts: UpcomingReceiptRow[];
  likelySwitches: LikelySwitchRow[];
};

const EXIT_LABEL: Record<LikelySwitchRow["exitReason"], string> = {
  NO_NEW_RECEIPTS: "Não renovou",
  EXPIRED: "Apólice terminada",
  CANCELLED: "Apólice anulada",
};

const PAGE_SIZE = 10;

function formatCurrency(value: number | null) {
  if (value === null) {
    return "—";
  }

  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

function relativeDayLabel(value: string) {
  const target = new Date(`${value.slice(0, 10)}T12:00:00`);
  const today = new Date();

  const targetDay = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate(),
  );

  const todayDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  const diffDays = Math.round(
    (targetDay.getTime() - todayDay.getTime()) / 86400000,
  );

  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Amanhã";
  if (diffDays === -1) return "Ontem";
  if (diffDays > 1) return `Em ${diffDays} dias`;
  return `Há ${Math.abs(diffDays)} dias`;
}

export function VencimentosBoard({
  renewals,
  upcomingReceipts,
  likelySwitches,
}: Props) {
  const [tab, setTab] = useState<Tab>("renewals");
  const [page, setPage] = useState(1);

  function changeTab(next: Tab) {
    setTab(next);
    setPage(1);
  }

  const activeItems =
    tab === "renewals"
      ? renewals
      : tab === "receipts"
        ? upcomingReceipts
        : likelySwitches;

  const totalPages = Math.max(
    1,
    Math.ceil(activeItems.length / PAGE_SIZE),
  );

  const currentPage = Math.min(page, totalPages);

  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return activeItems.slice(start, start + PAGE_SIZE);
  }, [activeItems, currentPage]);

  return (
    <section className="overflow-hidden rounded-2xl border border-[#e8eaed] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
      {/* TABS */}

      <div className="flex flex-col gap-3 border-b border-[#edf0f2] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex w-fit rounded-xl border border-[#e5e8ec] bg-[#f7f8f9] p-1">
          <button
            type="button"
            onClick={() => changeTab("renewals")}
            className={[
              "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition",
              tab === "renewals"
                ? "bg-white text-[#20242a] shadow-sm"
                : "text-[#7d848e] hover:text-[#59616d]",
            ].join(" ")}
          >
            <RefreshCw className="h-4 w-4" />
            Renovações
            <span
              className={[
                "rounded-full px-1.5 py-0.5 text-[11px]",
                tab === "renewals"
                  ? "bg-orange-50 text-[#ff4b0a]"
                  : "bg-[#eceef0] text-[#7d848e]",
              ].join(" ")}
            >
              {renewals.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => changeTab("receipts")}
            className={[
              "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition",
              tab === "receipts"
                ? "bg-white text-[#20242a] shadow-sm"
                : "text-[#7d848e] hover:text-[#59616d]",
            ].join(" ")}
          >
            <CalendarClock className="h-4 w-4" />
            Recibos a vencer
            <span
              className={[
                "rounded-full px-1.5 py-0.5 text-[11px]",
                tab === "receipts"
                  ? "bg-orange-50 text-[#ff4b0a]"
                  : "bg-[#eceef0] text-[#7d848e]",
              ].join(" ")}
            >
              {upcomingReceipts.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => changeTab("switches")}
            className={[
              "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition",
              tab === "switches"
                ? "bg-white text-[#20242a] shadow-sm"
                : "text-[#7d848e] hover:text-[#59616d]",
            ].join(" ")}
          >
            <UserX className="h-4 w-4" />
            Anuladas
            <span
              className={[
                "rounded-full px-1.5 py-0.5 text-[11px]",
                tab === "switches"
                  ? "bg-orange-50 text-[#ff4b0a]"
                  : "bg-[#eceef0] text-[#7d848e]",
              ].join(" ")}
            >
              {likelySwitches.length}
            </span>
          </button>
        </div>

        <p className="text-sm text-[#7d848e]">
          {activeItems.length} resultado{activeItems.length === 1 ? "" : "s"}
        </p>
      </div>

      {/* CONTEÚDO */}

      {activeItems.length === 0 ? (
        <EmptyState tab={tab} />
      ) : tab === "renewals" ? (
        <RenewalsTable items={pageItems as RenewalRow[]} />
      ) : tab === "receipts" ? (
        <ReceiptsTable items={pageItems as UpcomingReceiptRow[]} />
      ) : (
        <SwitchesTable items={pageItems as LikelySwitchRow[]} />
      )}

      {/* PAGINAÇÃO */}

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-[#edf0f2] px-5 py-3">
          <p className="text-xs text-[#8a9099]">
            Página {currentPage} de {totalPages}
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e1e4e8] px-3 py-1.5 text-xs font-medium text-[#59616d] transition hover:bg-[#f5f6f7] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Anterior
            </button>

            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e1e4e8] px-3 py-1.5 text-xs font-medium text-[#59616d] transition hover:bg-[#f5f6f7] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Seguinte
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ============================================================
// TABELA — RENOVAÇÕES
// ============================================================

/*
 * Linha clicável: abre Clientes com o painel deste cliente aberto.
 * O nome é também um <Link> (abrir em novo separador, teclado).
 */
function useClientRow() {
  const router = useRouter();

  return (clientId: string | null) =>
    clientId
      ? {
          onClick: (event: React.MouseEvent) => {
            // Cliques no próprio link já navegam; botões têm ação própria.
            if ((event.target as HTMLElement).closest("a, button")) return;
            router.push(clientHref(clientId));
          },
          className: "cursor-pointer transition-colors hover:bg-[#fff7f3]",
          title: "Abrir cliente",
        }
      : { className: "transition-colors hover:bg-[#fafafa]" };
}

function ClientCell({
  clientId,
  clientName,
}: {
  clientId: string | null;
  clientName: string;
}) {
  return (
    <td className="px-5 py-4 text-sm font-semibold text-[#24272d]">
      {clientId ? (
        <Link
          href={clientHref(clientId)}
          className="hover:text-[#ff4b0a] hover:underline"
        >
          {clientName}
        </Link>
      ) : (
        clientName
      )}
    </td>
  );
}

function RenewalsTable({ items }: { items: RenewalRow[] }) {
  const rowProps = useClientRow();

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-left">
        <thead>
          <tr className="border-b border-[#e8eaed] bg-[#fafafa]">
            <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
              Cliente
            </th>
            <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
              Apólice
            </th>
            <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
              Companhia
            </th>
            <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
              Ramo
            </th>
            <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
              Loja
            </th>
            <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
              Prémio anualizado
            </th>
            <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
              Renovação
            </th>
          </tr>
        </thead>

        <tbody className="divide-y divide-[#eef0f2]">
          {items.map((row) => (
            <tr key={row.policyId} {...rowProps(row.clientId)}>
              <ClientCell clientId={row.clientId} clientName={row.clientName} />

              <td className="px-5 py-4 text-sm text-[#555d68]">
                {row.policyNumber}
              </td>

              <td className="px-5 py-4 text-sm text-[#555d68]">
                {row.companyName}
              </td>

              <td className="px-5 py-4 text-sm text-[#555d68]">
                {row.lineName ?? "—"}
              </td>

              <td className="px-5 py-4 text-sm text-[#555d68]">
                {row.storeName ?? "—"}
              </td>

              <td className="px-5 py-4 text-right text-sm font-semibold text-[#24272d]">
                {formatCurrency(row.annualizedPremium)}
              </td>

              <td className="px-5 py-4">
                <DateBadge date={row.renewalDate} overdue={row.overdue} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// TABELA — RECIBOS
// ============================================================

function ReceiptsTable({ items }: { items: UpcomingReceiptRow[] }) {
  const rowProps = useClientRow();

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-left">
        <thead>
          <tr className="border-b border-[#e8eaed] bg-[#fafafa]">
            <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
              Cliente
            </th>
            <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
              Apólice
            </th>
            <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
              Recibo
            </th>
            <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
              Companhia
            </th>
            <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
              Loja
            </th>
            <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
              Prémio comercial
            </th>
            <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
              Prémio total
            </th>
            <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
              Vencimento
            </th>
          </tr>
        </thead>

        <tbody className="divide-y divide-[#eef0f2]">
          {items.map((row) => (
            <tr key={row.receiptId} {...rowProps(row.clientId)}>
              <ClientCell clientId={row.clientId} clientName={row.clientName} />

              <td className="px-5 py-4 text-sm text-[#555d68]">
                {row.policyNumber}
              </td>

              <td className="px-5 py-4 text-sm text-[#555d68]">
                {row.receiptNumber ?? "—"}
              </td>

              <td className="px-5 py-4 text-sm text-[#555d68]">
                {row.companyName}
              </td>

              <td className="px-5 py-4 text-sm text-[#555d68]">
                {row.storeName ?? "—"}
              </td>

              <td className="px-5 py-4 text-right text-sm font-semibold text-[#24272d]">
                {formatCurrency(row.commercialPremium)}
              </td>

              <td className="px-5 py-4 text-right text-sm text-[#555d68]">
                {formatCurrency(row.totalPremium)}
              </td>

              <td className="px-5 py-4">
                <DateBadge date={row.dueDate} overdue={row.overdue} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// TABELA — ANULADAS
// ============================================================

function SwitchesTable({ items }: { items: LikelySwitchRow[] }) {
  const rowProps = useClientRow();
  const router = useRouter();
  const { toasts, push, dismiss } = useToasts();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [created, setCreated] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  function createTask(row: LikelySwitchRow) {
    setPendingId(row.policyId);

    startTransition(async () => {
      try {
        await createRenewalTask({
          policyId: row.policyId,
          exitDate: row.exitDate,
          exitReason: row.exitReason,
        });

        setCreated((prev) => new Set(prev).add(row.policyId));
        push("success", `Tarefa criada para ${row.clientName}.`);
        router.refresh();
      } catch (error) {
        push(
          "error",
          error instanceof Error ? error.message : "Erro ao criar tarefa.",
        );
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1100px] text-left">
        <thead>
          <tr className="border-b border-[#e8eaed] bg-[#fafafa]">
            <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
              Cliente
            </th>
            <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
              Contacto
            </th>
            <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
              Apólice
            </th>
            <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
              Companhia
            </th>
            <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
              Ramo
            </th>
            <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
              Loja
            </th>
            <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
              Prémio anualizado
            </th>
            <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
              Saiu
            </th>
            <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
              Ação
            </th>
          </tr>
        </thead>

        <tbody className="divide-y divide-[#eef0f2]">
          {items.map((row) => (
            <tr key={row.policyId} {...rowProps(row.clientId)}>
              <ClientCell clientId={row.clientId} clientName={row.clientName} />

              <td className="px-5 py-4 text-sm text-[#555d68]">
                {row.clientPhone ? (
                  <a
                    href={`tel:${row.clientPhone.replace(/\s+/g, "")}`}
                    className="inline-flex items-center gap-1.5 font-medium hover:text-[#ff4b0a] hover:underline"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    {row.clientPhone}
                  </a>
                ) : (
                  "—"
                )}
              </td>

              <td className="px-5 py-4 text-sm text-[#555d68]">
                {row.policyNumber}
              </td>

              <td className="px-5 py-4 text-sm text-[#555d68]">
                {row.companyName}
              </td>

              <td className="px-5 py-4 text-sm text-[#555d68]">
                {row.lineName ?? "—"}
              </td>

              <td className="px-5 py-4 text-sm text-[#555d68]">
                {row.storeName ?? "—"}
              </td>

              <td className="px-5 py-4 text-right text-sm font-semibold text-[#24272d]">
                {formatCurrency(row.annualizedPremium)}
              </td>

              <td className="px-5 py-4">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                  <UserX className="h-3 w-3" />
                  {EXIT_LABEL[row.exitReason]}
                </span>

                <p className="mt-1 text-[11px] font-medium text-[#9aa0a8]">
                  {formatDate(row.exitDate)} · {relativeDayLabel(row.exitDate)}
                </p>
              </td>

              <td className="px-5 py-4 text-right">
                {row.hasOpenTask || created.has(row.policyId) ? (
                  <Link
                    href="/tarefas"
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 hover:underline"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Tarefa criada
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled={pendingId !== null}
                    onClick={() => createTask(row)}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#ff4b0a] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#e64309] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ListPlus className="h-3.5 w-3.5" />
                    {pendingId === row.policyId ? "A criar…" : "Criar tarefa"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

// ============================================================
// DATE BADGE
// ============================================================

function DateBadge({ date, overdue }: { date: string; overdue: boolean }) {
  return (
    <div>
      <span
        className={[
          "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold",
          overdue
            ? "bg-red-50 text-red-700"
            : "bg-[#f4f5f7] text-[#59616d]",
        ].join(" ")}
      >
        {overdue ? (
          <AlertTriangle className="h-3 w-3" />
        ) : (
          <Calendar className="h-3 w-3" />
        )}
        {formatDate(date)}
      </span>

      <p
        className={[
          "mt-1 text-[11px] font-medium",
          overdue ? "text-red-600" : "text-[#9aa0a8]",
        ].join(" ")}
      >
        {relativeDayLabel(date)}
      </p>
    </div>
  );
}

// ============================================================
// EMPTY STATE
// ============================================================

function EmptyState({ tab }: { tab: Tab }) {
  const Icon =
    tab === "renewals" ? RefreshCw : tab === "receipts" ? CalendarClock : UserX;

  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#f4f5f7]">
        <Icon className="h-5 w-5 text-[#69717d]" />
      </div>

      <h3 className="text-base font-semibold text-[#24272d]">
        {tab === "renewals"
          ? "Sem renovações"
          : tab === "receipts"
            ? "Sem recibos a vencer"
            : "Sem apólices anuladas"}
      </h3>

      <p className="mt-1 max-w-sm text-sm text-[#7a818c]">
        {tab === "switches"
          ? "Nenhuma apólice anulada ou por renovar nos últimos 6 meses."
          : "Nada nesta janela de 30 dias."}
      </p>
    </div>
  );
}