"use client";

import {
  ArrowLeftRight,
  ArrowRight,
  CircleHelp,
  RefreshCcw,
  UserRoundX,
} from "lucide-react";

import type { PolicyTransferInfo } from "@/lib/policies/policy-transfers";

function formatDate(value: string | null) {
  if (!value) return null;

  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/*
 * Etiqueta curta para o cabeçalho do cartão da apólice.
 */
export function TransferBadge({ transfer }: { transfer: PolicyTransferInfo }) {
  const { kind, direction, counterpart } = transfer;

  if (direction === "incoming") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
        <ArrowLeftRight className="h-3 w-3" />
        {kind === "TRANSFER"
          ? `Veio da ${counterpart?.companyName ?? "outra companhia"}`
          : "Substitui apólice anterior"}
      </span>
    );
  }

  const config = {
    TRANSFER: {
      label: `→ ${counterpart?.companyName ?? "outra companhia"}`,
      className: "border-violet-200 bg-violet-50 text-violet-700",
    },
    REPLACEMENT: {
      label: "Substituída",
      className: "border-sky-200 bg-sky-50 text-sky-700",
    },
    OTHER_HOLDER: {
      label: "Outro tomador",
      className: "border-amber-200 bg-amber-50 text-amber-700",
    },
    NOT_FOUND: {
      label: "Sem seguimento",
      className: "border-slate-200 bg-slate-50 text-slate-600",
    },
  }[kind];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${config.className}`}
    >
      {config.label}
    </span>
  );
}

/*
 * Explicação completa, dentro do cartão aberto.
 */
export function PolicyTransferBox({
  transfer,
  onOpenPolicy,
}: {
  transfer: PolicyTransferInfo;
  onOpenPolicy: (policyId: string) => void;
}) {
  const { kind, direction, counterpart, insuredObject, matchedBy } = transfer;

  const reason =
    transfer.trigger === "CANCELLED"
      ? `Apólice anulada${transfer.referenceDate ? ` a ${formatDate(transfer.referenceDate)}` : ""}.`
      : `Último recibo devolvido${transfer.referenceDate ? ` (${formatDate(transfer.referenceDate)})` : ""}.`;

  const objectLabel = insuredObject
    ? `matrícula ${insuredObject}`
    : matchedBy === "SAME_CLIENT_LINE"
      ? "mesmo cliente e mesmo tipo de seguro"
      : "mesmo objeto seguro";

  // ---------- incoming ----------
  if (direction === "incoming" && counterpart) {
    return (
      <Box tone="violet" icon={ArrowLeftRight} title="De onde veio este seguro">
        <p>
          {kind === "TRANSFER" ? (
            <>
              Transferido da{" "}
              <strong>{counterpart.companyName ?? "outra companhia"}</strong>
            </>
          ) : (
            "Substitui"
          )}{" "}
          — apólice nº {counterpart.policyNumber} ({objectLabel}).
        </p>
        <OpenButton onClick={() => onOpenPolicy(counterpart.policyId)}>
          Ver apólice anterior
        </OpenButton>
        {!transfer.confident && <LowConfidenceNote />}
      </Box>
    );
  }

  // ---------- não encontrado ----------
  if (kind === "NOT_FOUND" || !counterpart) {
    return (
      <Box tone="slate" icon={CircleHelp} title="Para onde foi este seguro?">
        <p>
          {reason} Não encontrámos outra apólice com a {objectLabel} na nossa
          carteira — se o cliente mudou de companhia, terá sido com outro
          mediador.
        </p>
      </Box>
    );
  }

  const when = counterpart.startDate
    ? ` desde ${formatDate(counterpart.startDate)}`
    : "";

  // ---------- outro tomador ----------
  if (kind === "OTHER_HOLDER") {
    return (
      <Box tone="amber" icon={UserRoundX} title="Para onde foi este seguro?">
        <p>
          {reason} A {objectLabel} está agora segura por{" "}
          <strong>{counterpart.clientName ?? "outro tomador"}</strong> na{" "}
          {counterpart.companyName ?? "companhia"} (apólice nº{" "}
          {counterpart.policyNumber}
          {when}). Possível venda do veículo.
        </p>
      </Box>
    );
  }

  // ---------- transferência / substituição ----------
  return (
    <Box
      tone={kind === "TRANSFER" ? "violet" : "sky"}
      icon={kind === "TRANSFER" ? ArrowLeftRight : RefreshCcw}
      title={
        kind === "TRANSFER"
          ? "Transferido de companhia"
          : "Apólice substituída"
      }
    >
      <p>
        {reason}{" "}
        {kind === "TRANSFER" ? (
          <>
            O seguro passou para a{" "}
            <strong>{counterpart.companyName ?? "outra companhia"}</strong>
          </>
        ) : (
          <>Foi substituída por outra apólice na mesma companhia</>
        )}{" "}
        — nº {counterpart.policyNumber}
        {when} ({objectLabel}).
      </p>
      <OpenButton onClick={() => onOpenPolicy(counterpart.policyId)}>
        Ver apólice nova
      </OpenButton>
      {!transfer.confident && <LowConfidenceNote />}
    </Box>
  );
}

// ============================================================
// PEÇAS
// ============================================================

const tones = {
  violet: "border-violet-200 bg-violet-50/60 text-violet-900",
  sky: "border-sky-200 bg-sky-50/60 text-sky-900",
  amber: "border-amber-200 bg-amber-50/60 text-amber-900",
  slate: "border-slate-200 bg-white text-slate-700",
};

function Box({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: keyof typeof tones;
  icon: typeof ArrowLeftRight;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border p-3.5 text-sm ${tones[tone]}`}>
      <p className="flex items-center gap-1.5 font-semibold">
        <Icon className="h-4 w-4" />
        {title}
      </p>
      <div className="mt-1.5 space-y-2 leading-relaxed">{children}</div>
    </div>
  );
}

function OpenButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs font-semibold underline-offset-2 hover:underline"
    >
      {children}
      <ArrowRight className="h-3.5 w-3.5" />
    </button>
  );
}

function LowConfidenceNote() {
  return (
    <p className="text-xs opacity-75">
      A companhia não envia a morada do risco: a ligação foi feita pelo
      mesmo cliente e tipo de seguro, por isso confirma.
    </p>
  );
}
