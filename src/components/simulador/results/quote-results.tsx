"use client";

import { useState, type ReactNode } from "react";
import {
  Calculator,
  CircleAlert,
  FlaskConical,
  Loader2,
  RefreshCw,
  Scale,
  SearchX,
} from "lucide-react";

import { cn } from "@/lib/utils";

import type { EstimatedQuote } from "@/lib/quoting/domain/types";

import type { SimulatorPaymentFrequency } from "../types";
import {
  describeBasis,
  formatTime,
} from "./format";
import {
  groupResults,
  hasMixedGroups,
  type ResultGroup,
} from "./group-results";
import {
  PricedQuoteCard,
  QuoteCardSkeleton,
  UnavailableQuoteCard,
} from "./quote-card";
import { RealQuoteDialog } from "./real-quote-dialog";
import type { RunState } from "./run-state";

const panelClass =
  "rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]";

type QuoteResultsProps = {
  state: RunState;

  /** true quando o formulário mudou desde o último cálculo. */
  stale: boolean;

  onRetry: () => void;
  onFixData: () => void;
};

export function QuoteResults({
  state,
  stale,
  onRetry,
  onFixData,
}: QuoteResultsProps) {
  switch (state.phase) {
    case "idle":
      return <IdleState />;

    case "loading":
      return <LoadingState />;

    case "failed":
      return <FailedState message={state.message} onRetry={onRetry} />;

    case "done":
      return (
        <DoneState
          // Novo cálculo = novo estado do diálogo/"guardada" (o requestId muda sempre).
          key={state.comparison.requestId}
          state={state}
          stale={stale}
          onRetry={onRetry}
          onFixData={onFixData}
        />
      );
  }
}

/* ------------------------------------------------------------------ *
 * Estados
 * ------------------------------------------------------------------ */

function IdleState() {
  return (
    <section
      aria-label="Resultados da simulação"
      className={cn(
        panelClass,
        "flex min-h-[320px] flex-col items-center justify-center border-dashed px-6 py-12 text-center",
      )}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f0f2f5] text-[#7a818b]">
        <Calculator className="h-5 w-5" />
      </span>

      <h2 className="mt-4 font-semibold text-[#20242a]">
        Ainda sem simulação
      </h2>

      <p className="mt-1 max-w-sm text-sm text-[#7d848e]">
        Preencha os dados do risco e calcule para ver a proposta de cada
        seguradora.
      </p>
    </section>
  );
}

function LoadingState() {
  return (
    <section
      aria-label="Resultados da simulação"
      aria-busy="true"
      className="space-y-4"
    >
      <p
        role="status"
        className="flex items-center gap-2 text-sm font-medium text-[#525963]"
      >
        <Loader2 className="h-4 w-4 animate-spin text-[#ff4b0a]" />
        A calcular propostas…
      </p>

      <QuoteCardSkeleton />
      <QuoteCardSkeleton />
    </section>
  );
}

function FailedState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <section
      aria-label="Resultados da simulação"
      className={cn(
        panelClass,
        "flex flex-col items-center px-6 py-12 text-center",
      )}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600">
        <CircleAlert className="h-5 w-5" />
      </span>

      <h2 className="mt-4 font-semibold text-[#20242a]">
        Não foi possível calcular
      </h2>

      <p role="alert" className="mt-1 max-w-sm text-sm text-[#7d848e]">
        {message}
      </p>

      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl border border-[#d8dde4] bg-white px-4 text-sm font-medium text-[#353b44] transition hover:bg-[#f4f5f7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-200"
      >
        <RefreshCw className="h-4 w-4" />
        Tentar novamente
      </button>
    </section>
  );
}

function DoneState({
  state,
  stale,
  onRetry,
  onFixData,
}: {
  state: Extract<RunState, { phase: "done" }>;
  stale: boolean;
  onRetry: () => void;
  onFixData: () => void;
}) {
  const { comparison, frequency, summary, demoLabel } = state;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [realQuoteSaved, setRealQuoteSaved] = useState(false);

  // Estimativa Zurich Auto desta simulação; só com snapshot assinado (nunca em demos).
  const zurichEstimate =
    comparison.results.find(
      (result): result is EstimatedQuote =>
        result.insurerCode === "ZURICH" && result.status === "ESTIMATED",
    ) ?? null;
  const snapshotToken = demoLabel ? undefined : state.zurichSnapshotToken;

  const { groups, unavailable } = groupResults(comparison.results);
  const pricedCount = groups.reduce((total, group) => total + group.items.length, 0);
  const time = formatTime(comparison.generatedAt);

  return (
    <section aria-label="Resultados da simulação" className="space-y-4">
      {demoLabel && (
        <p className="flex items-start gap-2 rounded-xl border border-dashed border-violet-300 bg-violet-50 px-3.5 py-2.5 text-sm text-violet-900">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />

          <span>
            <strong className="font-semibold">Dados fictícios</strong> —{" "}
            {demoLabel}. Pré-visualização visual, sem cálculo real.
          </span>
        </p>
      )}

      {/* CABEÇALHO */}

      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="text-lg font-semibold text-[#20242a]">Propostas</h2>

          <p className="mt-0.5 text-sm text-[#7d848e]">
            {describeCounts(pricedCount, unavailable.length)}
            {time && ` · calculado às ${time}`}
          </p>
        </div>
      </header>

      {summary.length > 0 && (
        <ul
          aria-label="Dados usados no cálculo"
          className="flex flex-wrap gap-2"
        >
          {summary.map((item) => (
            <li
              key={item}
              className="rounded-lg bg-[#eef0f4] px-2.5 py-1 text-xs font-medium text-[#525963]"
            >
              {item}
            </li>
          ))}
        </ul>
      )}

      {stale && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          Os dados foram alterados depois deste cálculo. Volte a calcular para
          atualizar as propostas.
        </p>
      )}

      {hasMixedGroups(groups) && (
        <p className="flex items-start gap-2 rounded-xl border border-[#e1e4e8] bg-[#f4f6f9] px-3.5 py-2.5 text-sm text-[#353b44]">
          <Scale className="mt-0.5 h-4 w-4 shrink-0 text-[#7a818b]" />

          <span>
            <strong className="font-semibold">Grupos diferentes.</strong>{" "}
            Estimativas e cotações firmes, ou valores com bases distintas,
            não são comparáveis entre si.
          </span>
        </p>
      )}

      {/* VAZIOS */}

      {comparison.results.length === 0 && (
        <EmptyResults
          title="Sem seguradoras para este ramo"
          description="Nenhuma seguradora está configurada para calcular este ramo."
        />
      )}

      {comparison.results.length > 0 && pricedCount === 0 && (
        <EmptyResults
          title="Nenhuma seguradora devolveu valor"
          description="Veja abaixo o motivo de cada uma. Pode completar os dados em falta ou tentar de novo."
        />
      )}

      {/* COM PREÇO, POR GRUPO DE BASE */}

      <div className={cn("space-y-6", stale && "opacity-60 transition-opacity")}>
        {groups.map((group) => (
          <GroupSection
            key={group.key}
            group={group}
            frequency={frequency}
            onSaveRealQuote={
              snapshotToken && zurichEstimate
                ? () => setDialogOpen(true)
                : undefined
            }
            realQuoteSaved={realQuoteSaved}
          />
        ))}
      </div>

      {/* SEM PREÇO */}

      {unavailable.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#8a9099]">
            Sem valor
          </h3>

          {unavailable.map((quote) => (
            <UnavailableQuoteCard
              key={`${quote.insurerCode}-${quote.status}`}
              quote={quote}
              onFixData={onFixData}
              onRetry={onRetry}
            />
          ))}
        </div>
      )}

      <p className="text-xs leading-relaxed text-[#8a9099]">
        Estimativas internas não são preços firmes nem constituem proposta.
      </p>

      {dialogOpen && snapshotToken && zurichEstimate && (
        <RealQuoteDialog
          snapshotToken={snapshotToken}
          estimate={zurichEstimate}
          onClose={() => setDialogOpen(false)}
          onSaved={() => setRealQuoteSaved(true)}
        />
      )}
    </section>
  );
}

function describeCounts(priced: number, unavailable: number): string {
  const parts = [
    `${priced} ${priced === 1 ? "seguradora com valor" : "seguradoras com valor"}`,
  ];

  if (unavailable > 0) {
    parts.push(
      `${unavailable} ${unavailable === 1 ? "indisponível" : "indisponíveis"}`,
    );
  }

  return parts.join(" · ");
}

function EmptyResults({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div
      className={cn(
        panelClass,
        "flex flex-col items-center border-dashed px-6 py-10 text-center",
      )}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#f0f2f5] text-[#7a818b]">
        <SearchX className="h-5 w-5" />
      </span>

      <h3 className="mt-3 font-semibold text-[#20242a]">{title}</h3>

      <p className="mt-1 max-w-sm text-sm text-[#7d848e]">{description}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Grupo de resultados com a mesma base
 * ------------------------------------------------------------------ */

function GroupSection({
  group,
  frequency,
  onSaveRealQuote,
  realQuoteSaved,
}: {
  group: ResultGroup;
  frequency: SimulatorPaymentFrequency;
  onSaveRealQuote?: () => void;
  realQuoteSaved: boolean;
}) {
  const basis = describeBasis(group.basis, frequency);

  return (
    <div className="space-y-3">
      <GroupHeader
        title={
          group.kind === "FIRM"
            ? group.items.every((item) => item.status === "FIRM" && item.source === "MANUAL")
              ? "Cotação real (portal Zurich)"
              : "Cotações firmes"
            : "Estimativas internas"
        }
      >
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-xs font-semibold",
            basis.known
              ? "bg-[#eef0f4] text-[#353b44]"
              : "bg-amber-50 text-amber-800",
          )}
        >
          {basis.label}
        </span>

        <span className="text-xs text-[#8a9099]">{groupCaption(group)}</span>
      </GroupHeader>

      {group.items.map((quote) => (
        <PricedQuoteCard
          key={`${quote.insurerCode}-${quote.status}`}
          quote={quote}
          frequency={frequency}
          onSaveRealQuote={
            quote.insurerCode === "ZURICH" && quote.status === "ESTIMATED"
              ? onSaveRealQuote
              : undefined
          }
          realQuoteSaved={realQuoteSaved}
        />
      ))}
    </div>
  );
}

function GroupHeader({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[#8a9099]">
        {title}
      </h3>

      {children}
    </div>
  );
}

function groupCaption(group: ResultGroup): string {
  if (!group.comparable) {
    return group.items.length > 1
      ? "Valores não comparáveis · ordem alfabética"
      : "Valor não comparável com outros";
  }

  return group.sortedByPrice
    ? "Mesma base · ordenadas por valor, do mais baixo para o mais alto"
    : "";
}
