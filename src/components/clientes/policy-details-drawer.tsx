"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  CalendarDays,
  Car,
  ChevronDown,
  ChevronRight,
  CreditCard,
  FileText,
  IdCard,
  Loader2,
  ReceiptText,
  ShieldCheck,
  TrendingUp,
  X,
} from "lucide-react";

import {
  getClientPanel,
  type ClientPanelData,
  type PolicyReceiptRow,
} from "@/app/(dashboard)/clientes/receipts-action";
import type { PolicyRolesData } from "@/app/(dashboard)/clientes/policy-roles-action";

import type { PolicyRow } from "@/components/clientes/types";
import { ReceiptDetailsPanel } from "@/components/clientes/receipt-details-panel";
import { ClientDataTab } from "@/components/clientes/client-data-tab";
import { PolicyRolesCard } from "@/components/clientes/policy-roles-card";
import {
  PolicyTransferBox,
  TransferBadge,
} from "@/components/clientes/policy-transfer-box";
import {
  ClientAdviceBulb,
  type AdviceNavigation,
} from "@/components/clientes/client-advice-bulb";


type Props = {
  clientId: string | null;
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


type Tab = "client" | "policies" | "receipts";

function isOverdueReceipt(receipt: PolicyReceiptRow) {
  if (receipt.isReversal || receipt.status !== "PENDING" || !receipt.due_date) {
    return false;
  }

  return receipt.due_date.slice(0, 10) < new Date().toISOString().slice(0, 10);
}

/* Renovação estimada pelo period_end do último recibo válido. */
function estimateRenewal(receipts: PolicyReceiptRow[]) {
  return (
    receipts
      .filter((r) => !r.isReversal && r.period_end)
      .map((r) => r.period_end as string)
      .sort()
      .at(-1) ?? null
  );
}

// ============================================================
// DRAWER
// ============================================================

export function PolicyDetailsDrawer({
  clientId,
  clientName,
  clientNif,
  policies: initialPolicies,
  open,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>("client");

  // Tudo o que o painel precisa vem num só pedido (getClientPanel).
  // O drawer é remontado por cliente (key no ClientsList).
  const [panel, setPanel] = useState<ClientPanelData | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);

  // Nenhuma apólice aberta por defeito: a lista aparece fechada e é o
  // utilizador que escolhe qual abrir.
  const [expandedPolicyId, setExpandedPolicyId] = useState<string | null>(
    null,
  );
  const [receiptFilter, setReceiptFilter] = useState<string>("ALL");
  const [openReceiptId, setOpenReceiptId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !clientId) return;

    let cancelled = false;

    getClientPanel(clientId)
      .then((result) => {
        if (!cancelled) setPanel(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPanelError(
            error instanceof Error
              ? error.message
              : "Erro ao carregar o cliente.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, clientId]);

  // Enquanto o painel carrega, mostram-se já as apólices da lista.
  const policies = panel?.policies ?? initialPolicies;

  const allReceipts = useMemo(() => {
    if (!panel) return [];

    return policies
      .flatMap((policy) =>
        (panel.receiptsByPolicy[policy.id] ?? []).map((receipt) => ({
          receipt,
          policy,
        })),
      )
      .sort((a, b) =>
        (b.receipt.due_date ?? b.receipt.period_start ?? "").localeCompare(
          a.receipt.due_date ?? a.receipt.period_start ?? "",
        ),
      );
  }, [panel, policies]);

  function updateRoles(policyId: string, roles: PolicyRolesData) {
    setPanel((prev) =>
      prev
        ? {
            ...prev,
            roles: { ...prev.roles, [policyId]: roles },
            // A loja pode ter sido preenchida ao escolher o comercial.
            policies: prev.policies.map((p) =>
              p.id === policyId && roles.store
                ? { ...p, issuing_store: roles.store }
                : p,
            ),
          }
        : prev,
    );
  }

  function showPolicyReceipts(policyId: string) {
    setReceiptFilter(policyId);
    setTab("receipts");
  }

  function openPolicy(policyId: string) {
    setTab("policies");
    setExpandedPolicyId(policyId);
    window.setTimeout(() => {
      document
        .getElementById(`policy-card-${policyId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  // Botões dos conselhos (lâmpada).
  function navigateFromAdvice(target: AdviceNavigation) {
    setOpenReceiptId(null);

    if (target.type === "policy") {
      openPolicy(target.policyId);
    } else if (target.type === "receipts") {
      setReceiptFilter(target.policyId ?? "ALL");
      setTab("receipts");
    } else {
      setTab("client");
    }
  }

  if (!open) {
    return null;
  }

  const activeCount = policies.filter((p) => p.status === "ACTIVE").length;

  const annualTotal = policies
    .filter((p) => p.status === "ACTIVE")
    .reduce((sum, p) => sum + (p.annualized_premium ?? 0), 0);

  const loading = !panel && !panelError;

  const tabs: { value: Tab; label: string; icon: typeof IdCard }[] = [
    { value: "client", label: "Dados do cliente", icon: IdCard },
    {
      value: "policies",
      label: `Apólices (${policies.length})`,
      icon: ShieldCheck,
    },
    {
      value: "receipts",
      label: panel ? `Recibos (${allReceipts.length})` : "Recibos",
      icon: ReceiptText,
    },
  ];

  return (
    <div className="fixed inset-0 z-[100]">
      {/* OVERLAY */}

      <button
        type="button"
        aria-label="Fechar detalhe do cliente"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/35 backdrop-blur-[1px]"
      />

      {/* DRAWER */}

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Detalhe do cliente"
        className="absolute right-0 top-0 flex h-dvh w-full max-w-[720px] flex-col bg-[#f7f8fc] shadow-2xl"
      >
        {/* HEADER */}

        <header className="shrink-0 border-b border-[#e5e8ec] bg-white px-5 pt-5 sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-semibold tracking-tight text-[#17191d]">
                {clientName}
              </h2>

              <p className="mt-1 text-sm text-[#6f7680]">
                NIF {clientNif ?? "—"}
                <span className="mx-1.5 text-[#c0c4c9]">·</span>
                {activeCount} apólice{activeCount === 1 ? "" : "s"} ativa
                {activeCount === 1 ? "" : "s"}
                {annualTotal > 0 && (
                  <>
                    <span className="mx-1.5 text-[#c0c4c9]">·</span>
                    <span className="font-semibold text-[#20242a]">
                      {formatCurrency(annualTotal)}
                    </span>
                    /ano
                  </>
                )}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <ClientAdviceBulb
                clientId={clientId}
                clientName={clientName}
                clientNif={clientNif}
                clientPhone={
                  (panel?.profile?.providers
                    .map((p) => p.metadata.Telemovel)
                    .find((v) => typeof v === "string" && v.trim()) as
                    | string
                    | undefined) ??
                  panel?.profile?.phone ??
                  null
                }
                advice={panel?.advice ?? null}
                loading={loading}
                onNavigate={navigateFromAdvice}
              />

              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#e1e4e8] text-[#59616d] transition hover:bg-[#f4f5f7]"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* SEPARADORES */}

          <nav className="mt-4 flex gap-1 overflow-x-auto">
            {tabs.map((option) => {
              const Icon = option.icon;
              const active = tab === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setOpenReceiptId(null);
                    setTab(option.value);
                  }}
                  className={[
                    "inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-3 text-sm font-medium transition",
                    active
                      ? "border-[#ff4b0a] text-[#ff4b0a]"
                      : "border-transparent text-[#7d848e] hover:text-[#20242a]",
                  ].join(" ")}
                >
                  <Icon className="h-4 w-4" />
                  {option.label}
                </button>
              );
            })}
          </nav>
        </header>

        {/* BODY */}

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {panelError && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {panelError}
            </div>
          )}

          {tab === "client" && clientId && (
            <ClientDataTab
              key={clientId}
              clientId={clientId}
              preloaded={panel?.profile ?? null}
              waiting={loading}
            />
          )}

          {tab === "policies" && (
            <PoliciesTab
              policies={policies}
              panel={panel}
              loading={loading}
              expandedPolicyId={expandedPolicyId}
              onToggle={(id) =>
                setExpandedPolicyId((current) => (current === id ? null : id))
              }
              onOpenPolicy={openPolicy}
              onShowReceipts={showPolicyReceipts}
              onRolesChange={updateRoles}
            />
          )}

          {tab === "receipts" && (
            <ReceiptsTab
              policies={policies}
              receipts={allReceipts}
              loading={loading}
              filter={receiptFilter}
              onFilterChange={setReceiptFilter}
              onOpenReceipt={setOpenReceiptId}
            />
          )}
        </div>

        {openReceiptId && (
          <ReceiptDetailsPanel
            key={openReceiptId}
            receiptId={openReceiptId}
            preloaded={panel?.details[openReceiptId] ?? null}
            onBack={() => setOpenReceiptId(null)}
            onClose={onClose}
          />
        )}
      </aside>
    </div>
  );
}

// ============================================================
// APÓLICES
// ============================================================

function PoliciesTab({
  policies,
  panel,
  loading,
  expandedPolicyId,
  onToggle,
  onOpenPolicy,
  onShowReceipts,
  onRolesChange,
}: {
  policies: PolicyRow[];
  panel: ClientPanelData | null;
  loading: boolean;
  expandedPolicyId: string | null;
  onToggle: (policyId: string) => void;
  onOpenPolicy: (policyId: string) => void;
  onShowReceipts: (policyId: string) => void;
  onRolesChange: (policyId: string, roles: PolicyRolesData) => void;
}) {
  const pillLabels = useMemo(
    () => new Map(buildPillLabels(policies).map((p) => [p.policyId, p.label])),
    [policies],
  );

  if (policies.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-[#8a9099]">
        Este cliente não tem apólices.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {policies.map((policy) => {
        const expanded = expandedPolicyId === policy.id;
        const pending = isPendingRisk(policy);
        const receipts = panel?.receiptsByPolicy[policy.id] ?? [];
        const renewal = estimateRenewal(receipts);
        const transfer = panel?.transfers[policy.id] ?? null;

        // Só se pode saltar para apólices deste cliente.
        const openPolicy = (id: string) => {
          if (policies.some((p) => p.id === id)) onOpenPolicy(id);
        };

        return (
          <section
            key={policy.id}
            id={`policy-card-${policy.id}`}
            className={[
              "overflow-hidden rounded-2xl border bg-white shadow-sm transition",
              expanded ? "border-[#ffcdb8]" : "border-[#e5e8ec]",
            ].join(" ")}
          >
            {/* CABEÇALHO DA APÓLICE */}

            <button
              type="button"
              onClick={() => onToggle(policy.id)}
              aria-expanded={expanded}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-[#fafbfc] sm:px-5"
            >
              <span className="flex h-10 min-w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 px-1.5 text-[11px] font-bold text-[#ff4b0a]">
                {pillLabels.get(policy.id) ?? "—"}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-[#20242a]">
                    {getLineLabel(policy)}
                  </span>
                  <span
                    className={
                      pending
                        ? "inline-flex rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700"
                        : `inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getStatusClasses(policy.status)}`
                    }
                  >
                    {pending ? "Aguarda início" : getStatusLabel(policy.status)}
                  </span>
                  {transfer && <TransferBadge transfer={transfer} />}
                </span>
                <span className="mt-0.5 block truncate text-xs text-[#8a9099]">
                  {policy.company?.name ?? "—"} · Nº {policy.policy_number}
                  {policy.vehicle_registration
                    ? ` · ${policy.vehicle_registration}`
                    : ""}
                </span>
              </span>

              <span className="shrink-0 text-right">
                <span className="block text-sm font-bold text-[#17191d]">
                  {formatCurrency(policy.annualized_premium)}
                </span>
                <span className="block text-[11px] text-[#8a9099]">
                  {getFrequencyLabel(policy.payment_frequency)}
                </span>
              </span>

              <ChevronDown
                className={`h-4 w-4 shrink-0 text-[#a0a5ac] transition ${expanded ? "rotate-180" : ""}`}
              />
            </button>

            {/* DETALHE */}

            {expanded && (
              <div className="space-y-4 border-t border-[#edf0f2] bg-[#fafbfc] p-4 sm:p-5">
                {transfer && (
                  <PolicyTransferBox
                    transfer={transfer}
                    onOpenPolicy={openPolicy}
                  />
                )}

                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <Detail label="Companhia" icon={Building2}>
                    {policy.company?.name ?? "—"}
                  </Detail>
                  <Detail label="Produto">{policy.product_name ?? "—"}</Detail>
                  {policy.vehicle_registration && (
                    <Detail label="Matrícula" icon={Car}>
                      <span className="tracking-wide">
                        {policy.vehicle_registration}
                      </span>
                    </Detail>
                  )}
                  <Detail label="Prémio anualizado" icon={CreditCard}>
                    {formatCurrency(policy.annualized_premium)}
                  </Detail>
                  <Detail label="Emissão" icon={CalendarDays}>
                    {formatDate(policy.issue_date)}
                  </Detail>
                  <Detail label="Início" icon={CalendarDays}>
                    {formatDate(policy.start_date)}
                  </Detail>
                  <Detail label="Renovação" icon={CalendarDays}>
                    {renewal
                      ? formatDate(renewal)
                      : loading
                        ? "…"
                        : "Sem recibos"}
                  </Detail>
                  <Detail label="Loja" icon={Building2}>
                    {policy.issuing_store?.name ?? "Por associar"}
                  </Detail>
                </dl>

                <button
                  type="button"
                  onClick={() => onShowReceipts(policy.id)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#ff4b0a] transition hover:text-[#df3f06]"
                >
                  <ReceiptText className="h-3.5 w-3.5" />
                  Ver recibos desta apólice
                  {panel ? ` (${receipts.length})` : ""}
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>

                <PolicyRolesCard
                  key={policy.id}
                  policyId={policy.id}
                  data={panel?.roles[policy.id] ?? null}
                  loadError={panel?.rolesError ?? null}
                  onChange={(roles) => onRolesChange(policy.id, roles)}
                />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Detail({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon?: typeof Building2;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-xs text-[#8a9099]">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-medium text-[#333842]">
        {children}
      </dd>
    </div>
  );
}

// ============================================================
// RECIBOS
// ============================================================

function ReceiptsTab({
  policies,
  receipts,
  loading,
  filter,
  onFilterChange,
  onOpenReceipt,
}: {
  policies: PolicyRow[];
  receipts: { receipt: PolicyReceiptRow; policy: PolicyRow }[];
  loading: boolean;
  filter: string;
  onFilterChange: (filter: string) => void;
  onOpenReceipt: (receiptId: string) => void;
}) {
  const pillLabels = useMemo(() => buildPillLabels(policies), [policies]);
  const labelByPolicy = useMemo(
    () => new Map(pillLabels.map((p) => [p.policyId, p.label])),
    [pillLabels],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-[#7d848e]">
        <Loader2 className="h-4 w-4 animate-spin" />A carregar recibos...
      </div>
    );
  }

  const visible =
    filter === "ALL"
      ? receipts
      : receipts.filter((item) => item.policy.id === filter);

  const valid = visible.filter((item) => !item.receipt.isReversal);

  const totalCollected = valid
    .filter((item) => item.receipt.status === "PAID")
    .reduce((sum, item) => sum + (item.receipt.total_premium ?? 0), 0);

  const pendingCount = valid.filter(
    (item) => item.receipt.status === "PENDING",
  ).length;

  const overdueCount = valid.filter((item) =>
    isOverdueReceipt(item.receipt),
  ).length;

  return (
    <div className="space-y-4">
      {/* FILTRO POR APÓLICE */}

      {policies.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {[{ policyId: "ALL", label: "Todas" }, ...pillLabels].map((pill) => {
            const active = filter === pill.policyId;

            return (
              <button
                key={pill.policyId}
                type="button"
                onClick={() => onFilterChange(pill.policyId)}
                className={[
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                  active
                    ? "bg-[#ff4b0a] text-white shadow-sm"
                    : "bg-white text-[#59616d] ring-1 ring-[#e5e8ec] hover:bg-[#f4f5f7]",
                ].join(" ")}
              >
                {pill.label}
              </button>
            );
          })}
        </div>
      )}

      {/* RESUMO */}

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-[#e5e8ec] bg-white px-3 py-2.5">
          <p className="text-[11px] text-[#8a9099]">Total cobrado</p>
          <p className="mt-0.5 text-sm font-bold text-green-700">
            {formatCurrency(totalCollected)}
          </p>
        </div>
        <div className="rounded-xl border border-[#e5e8ec] bg-white px-3 py-2.5">
          <p className="text-[11px] text-[#8a9099]">Por cobrar</p>
          <p className="mt-0.5 text-sm font-bold text-amber-700">
            {pendingCount}
          </p>
        </div>
        <div className="rounded-xl border border-[#e5e8ec] bg-white px-3 py-2.5">
          <p className="text-[11px] text-[#8a9099]">Em atraso</p>
          <p
            className={`mt-0.5 text-sm font-bold ${overdueCount > 0 ? "text-red-700" : "text-[#8a9099]"}`}
          >
            {overdueCount}
          </p>
        </div>
      </div>

      {/* LISTA */}

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-[#e5e8ec] bg-white py-12 text-center text-sm text-[#7d848e]">
          Ainda não existem recibos.
        </p>
      ) : (
        <div className="divide-y divide-[#edf0f2] rounded-2xl border border-[#e5e8ec] bg-white px-4 shadow-sm sm:px-5">
          {visible.map(({ receipt, policy }) => (
            <div
              key={receipt.id}
              className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {filter === "ALL" && policies.length > 1 && (
                    <span className="rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-bold text-[#ff4b0a]">
                      {labelByPolicy.get(policy.id)}
                    </span>
                  )}

                  <p className="text-sm font-medium text-[#20242a]">
                    {receipt.receipt_number ?? "Sem número"}
                  </p>

                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      isOverdueReceipt(receipt)
                        ? "border-red-200 bg-red-50 text-red-700"
                        : getReceiptStatusClasses(
                            receipt.status,
                            receipt.isReversal,
                          )
                    }`}
                  >
                    {isOverdueReceipt(receipt)
                      ? "Em atraso"
                      : getReceiptStatusLabel(
                          receipt.status,
                          receipt.isReversal,
                        )}
                  </span>
                </div>

                <p className="mt-1 text-xs text-[#8a9099]">
                  {receipt.period_start && receipt.period_end
                    ? `${formatDate(receipt.period_start)} — ${formatDate(receipt.period_end)}`
                    : `Vencimento: ${formatDate(receipt.due_date)}`}
                  {filter === "ALL" && ` · ${policy.company?.name ?? ""}`}
                </p>
              </div>

              <div className="flex items-center justify-between gap-4 sm:justify-end">
                <div className="text-left sm:text-right">
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <p className="text-base font-bold text-[#17191d]">
                      {formatCurrency(receipt.total_premium)}
                    </p>

                    {receipt.premium_change_pct !== null && (
                      <span
                        title={
                          receipt.previous_commercial_premium !== null
                            ? `Variação do prémio comercial. Recibo anterior: ${formatCurrency(receipt.previous_commercial_premium)}`
                            : "Variação do prémio comercial"
                        }
                        className={[
                          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                          receipt.premium_increase_alert
                            ? "border-red-200 bg-red-50 text-red-700"
                            : receipt.premium_change_pct > 0
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : receipt.premium_change_pct < 0
                                ? "border-green-200 bg-green-50 text-green-700"
                                : "border-slate-200 bg-slate-50 text-slate-600",
                        ].join(" ")}
                      >
                        {receipt.premium_change_pct > 0 && (
                          <TrendingUp className="h-3 w-3" />
                        )}
                        {receipt.premium_change_pct > 0 ? "+" : ""}
                        {receipt.premium_change_pct.toFixed(2)}%
                      </span>
                    )}
                  </div>

                  <p className="mt-0.5 text-xs text-[#8a9099]">
                    Comercial: {formatCurrency(receipt.commercial_premium)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => onOpenReceipt(receipt.id)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#ffd5c2] bg-[#fff6f1] px-2.5 py-1.5 text-xs font-semibold text-[#ff4b0a] transition hover:border-[#ff4b0a] hover:bg-[#ffece3]"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Abrir recibo
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
