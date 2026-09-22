"use client";

import { useState, type ElementType, type ReactNode } from "react";
import {
  Ban,
  CircleAlert,
  ChevronDown,
  ClipboardList,
  Clock,
  Info,
  TriangleAlert,
} from "lucide-react";

import type {
  ConfidenceLevel,
  EstimateCalibration,
  EstimatedQuote,
  FirmQuote,
  InsurerQuoteBase,
  UnavailableQuote,
} from "@/lib/quoting/domain/types";
import { cn } from "@/lib/utils";

import type { SimulatorPaymentFrequency } from "../types";
import {
  CONFIDENCE_LABEL,
  CONFIDENCE_LEVEL_INDEX,
  SOURCE_LABEL,
  UNAVAILABLE_COPY,
  describeBasis,
  formatDate,
  formatEstimate,
  formatFirm,
  formatTime,
  missingDataLabel,
} from "./format";

const cardClass =
  "rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]";

/** Nº máximo de razões visíveis sem abrir os detalhes. */
const VISIBLE_REASONS = 3;

function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

function InsurerHeader({
  quote,
  badge,
}: {
  quote: Pick<InsurerQuoteBase, "insurerName">;
  badge: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f0f2f5] text-sm font-semibold text-[#353b44]"
        >
          {initialsOf(quote.insurerName)}
        </span>

        <h3 className="truncate text-base font-semibold text-[#20242a]">
          {quote.insurerName}
        </h3>
      </div>

      {badge}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Cartão com preço (estimativa ou cotação firme)
 * ------------------------------------------------------------------ */

type PricedQuoteCardProps = {
  quote: EstimatedQuote | FirmQuote;

  /** Periodicidade pedida; só relevante para prémios por prestação. */
  frequency: SimulatorPaymentFrequency;

  /**
   * Presente só na estimativa Zurich com snapshot assinado: mostra a ação
   * "Guardar cotação real Zurich" (ground truth para medir o simulador).
   */
  onSaveRealQuote?: () => void;
  realQuoteSaved?: boolean;
};

export function PricedQuoteCard({
  quote,
  frequency,
  onSaveRealQuote,
  realQuoteSaved,
}: PricedQuoteCardProps) {
  const [open, setOpen] = useState(false);

  const basis = describeBasis(quote.premiumBasis, frequency);
  const isEstimate = quote.status === "ESTIMATED";

  const visibleReasons = quote.reasons.slice(0, VISIBLE_REASONS);
  const extraReasons = quote.reasons.slice(VISIBLE_REASONS);

  const detailsId = `quote-details-${quote.insurerCode}-${quote.status}`;

  return (
    <article className={cn(cardClass, "p-5")}>
      <InsurerHeader
        quote={quote}
        badge={
          <span
            className={cn(
              "shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold",
              isEstimate
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-green-200 bg-green-50 text-green-800",
            )}
          >
            {isEstimate
              ? "Estimativa"
              : quote.source === "MANUAL"
                ? "Cotação real Zurich"
                : "Cotação firme"}
          </span>
        }
      />

      {/* PREÇO */}

      <div className="mt-5">
        {isEstimate ? (
          <EstimatePrice quote={quote} unit={basis.unit} />
        ) : (
          <FirmPrice quote={quote} unit={basis.unit} />
        )}
      </div>

      {/* BASE + CONFIANÇA */}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold",
            basis.known
              ? "bg-[#f0f2f5] text-[#353b44]"
              : "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200",
          )}
        >
          {!basis.known && <TriangleAlert className="h-3.5 w-3.5" />}
          {basis.label}
        </span>

        {isEstimate && (
          <ConfidenceMeter level={displayedConfidence(quote)} />
        )}
      </div>

      {!basis.known && (
        <p className="mt-2 text-xs leading-relaxed text-amber-800">
          {basis.description}
        </p>
      )}

      {isEstimate && <FactorsNote quote={quote} />}

      {isEstimate && quote.calibration && (
        <CalibrationSection
          calibration={quote.calibration}
          headlineShown={headlineOf(quote) !== null}
        />
      )}

      {/* RAZÕES */}

      {visibleReasons.length > 0 && (
        <div className="mt-4 border-t border-[#edf0f2] pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#8a9099]">
            Razões principais
          </p>

          <ul className="mt-2 space-y-1.5">
            {visibleReasons.map((reason, index) => (
              <li
                key={`${index}-${reason}`}
                className="flex gap-2 text-sm text-[#353b44]"
              >
                <span
                  aria-hidden
                  className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#b4bac2]"
                />

                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* COTAÇÃO REAL (só Zurich estimada) */}

      {isEstimate && onSaveRealQuote && (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[#edf0f2] pt-4">
          <button
            type="button"
            onClick={onSaveRealQuote}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-[#d8dde4] bg-white px-3.5 text-sm font-medium text-[#353b44] transition hover:bg-[#f4f5f7] focus-visible:ring-2 focus-visible:ring-orange-200 focus-visible:outline-none"
          >
            {realQuoteSaved
              ? "Guardar outra cotação real"
              : "Guardar cotação real Zurich"}
          </button>

          <span className="text-xs text-[#8a9099]">
            {realQuoteSaved
              ? "Cotação real guardada."
              : "Depois de simular no portal da Zurich, guarde o preço real para medir o erro do simulador."}
          </span>
        </div>
      )}

      {/* DETALHES */}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={detailsId}
        className="mt-4 flex w-full items-center gap-2 rounded-lg text-left text-sm font-medium text-[#525963] outline-none transition hover:text-[#20242a] focus-visible:ring-2 focus-visible:ring-orange-200"
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />

        {open ? "Ocultar detalhes" : "Ver detalhes"}

        {quote.warnings.length > 0 && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
            <TriangleAlert className="h-3.5 w-3.5" />

            {quote.warnings.length}{" "}
            {quote.warnings.length === 1 ? "aviso" : "avisos"}
          </span>
        )}
      </button>

      {open && (
        <div id={detailsId} className="mt-3 space-y-4 text-sm">
          {extraReasons.length > 0 && (
            <ul className="space-y-1.5 text-[#353b44]">
              {extraReasons.map((reason, index) => (
                <li key={`${index}-${reason}`} className="flex gap-2">
                  <span
                    aria-hidden
                    className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#b4bac2]"
                  />

                  {reason}
                </li>
              ))}
            </ul>
          )}

          {quote.warnings.length > 0 && (
            <ul className="space-y-2 rounded-xl bg-amber-50 p-3 text-amber-900">
              {quote.warnings.map((warning, index) => (
                <li key={`${index}-${warning}`} className="flex gap-2">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />

                  {warning}
                </li>
              ))}
            </ul>
          )}

          <QuoteMeta
            quote={quote}
            basisDescription={basis.known ? basis.description : null}
          />
        </div>
      )}
    </article>
  );
}

/*
 * O valor GRANDE do cartão. Com cotações reais Zurich do mesmo tipo de cobertura
 * é a «Calibração com cotações reais»; senão, a estimativa histórica. A
 * estimativa histórica base aparece sempre por baixo e não muda.
 */
type Headline = {
  value: number;
  min: number;
  max: number;

  /** A estimativa histórica base, para mostrar por baixo. */
  base: number;
};

function headlineOf(quote: EstimatedQuote): Headline | null {
  const calibration = quote.calibration;

  if (!calibration) return null;

  // PRODUCTION já alterou o pointEstimate: o valor principal é o próprio.
  if (calibration.applied) {
    return {
      value: quote.pointEstimate,
      min: quote.priceRange.min,
      max: quote.priceRange.max,
      base: calibration.baseEstimate,
    };
  }

  const value = calibration.headlineEstimate;

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    quote.pointEstimate <= 0
  ) {
    return null;
  }

  // O intervalo acompanha a correção (o erro relativo do modelo é o mesmo).
  const factor = value / quote.pointEstimate;

  return {
    value,
    min: quote.priceRange.min * factor,
    max: quote.priceRange.max * factor,
    base: quote.pointEstimate,
  };
}

/** Com o valor calibrado em grande, a confiança nunca é superior à da calibração. */
function displayedConfidence(quote: EstimatedQuote): ConfidenceLevel {
  const calibration = quote.calibration;

  if (!calibration || headlineOf(quote) === null) return quote.confidence;

  return CONFIDENCE_LEVEL_INDEX[calibration.confidence] <
    CONFIDENCE_LEVEL_INDEX[quote.confidence]
    ? calibration.confidence
    : quote.confidence;
}

function EstimatePrice({
  quote,
  unit,
}: {
  quote: EstimatedQuote;
  unit: string;
}) {
  const headline = headlineOf(quote);

  const value = headline?.value ?? quote.pointEstimate;
  const min = headline?.min ?? quote.priceRange.min;
  const max = headline?.max ?? quote.priceRange.max;
  const span = max - min;
  const position =
    span > 0 ? Math.min(100, Math.max(0, ((value - min) / span) * 100)) : 50;

  return (
    <>
      {headline && (
        <p className="mb-1 text-xs font-semibold tracking-wide text-violet-800 uppercase">
          Calibração com cotações reais
        </p>
      )}

      <p className="flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tracking-tight text-[#17191d]">
          {formatEstimate(value)}
        </span>

        {unit && <span className="text-sm text-[#7d848e]">{unit}</span>}

        <span className="ml-1 text-xs text-[#8a9099]">
          {headline ? "valor calibrado" : "valor estimado"}
        </span>
      </p>

      {headline && quote.calibration && (
        <p className="mt-1 text-sm text-[#525963]">
          Estimativa histórica:{" "}
          <strong className="font-semibold text-[#20242a]">
            {formatEstimate(headline.base)}
          </strong>
          {unit && <span className="text-[#7d848e]"> {unit}</span>}
          <span className="text-[#8a9099]">
            {" "}
            · {quote.calibration.sampleSize}{" "}
            {quote.calibration.sampleSize === 1
              ? "cotação real Zurich"
              : "cotações reais Zurich"}
          </span>
        </p>
      )}

      <p className="mt-1 text-sm text-[#525963]">
        Intervalo estimado{" "}
        <strong className="font-semibold text-[#20242a]">
          {formatEstimate(min)} – {formatEstimate(max)}
        </strong>
        {unit && <span className="text-[#7d848e]"> {unit}</span>}
      </p>

      <div
        aria-hidden
        className="relative mt-3 h-1.5 rounded-full bg-orange-100"
      >
        <span
          className="absolute top-1/2 h-3.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ff4b0a]"
          style={{ left: `${position}%` }}
        />
      </div>
    </>
  );
}

function FirmPrice({ quote, unit }: { quote: FirmQuote; unit: string }) {
  return (
    <>
      <p className="flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tracking-tight text-[#17191d]">
          {formatFirm(quote.premium)}
        </span>

        {unit && <span className="text-sm text-[#7d848e]">{unit}</span>}
      </p>

      <p className="mt-1 text-sm text-[#525963]">
        {quote.source === "MANUAL"
          ? "Cotação real simulada no portal da Zurich"
          : "Valor cotado pela seguradora"}
        {quote.validUntil && (
          <> · válido até {formatDate(quote.validUntil)}</>
        )}
      </p>
    </>
  );
}

/** "idade do condutor, código postal" -> "idade do condutor e código postal" */
function joinFactors(factors: string[]): string {
  const items = factors.map(
    (factor) => factor.charAt(0).toLowerCase() + factor.slice(1),
  );

  return items.length > 1
    ? `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`
    : items[0];
}

/*
 * Que dados do pedido influenciaram mesmo o valor, segundo o modelo
 * (EstimatedQuote.consideredFactors). Sem inventar nada: se o modelo não
 * declara fatores, diz-se isso mesmo.
 */
function FactorsNote({ quote }: { quote: EstimatedQuote }) {
  const factors = quote.consideredFactors;

  let text: string;

  if (factors === undefined) {
    text = "O modelo não indica que dados do pedido usou.";
  } else if (factors.length === 0) {
    text =
      quote.comparablePolicies !== null
        ? `Nenhum dado do pedido alterou este valor: baseia-se em ${quote.comparablePolicies} riscos históricos.`
        : "Nenhum dado do pedido alterou este valor.";
  } else {
    text = `Dados considerados: ${joinFactors(factors)}. Os restantes dados do pedido não alteraram este valor.`;
  }

  return (
    <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-[#7d848e]">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {text}
    </p>
  );
}

/*
 * Calibração com cotações reais Zurich, ao lado da estimativa histórica.
 * Quando aplicada, o preço principal JÁ é o calibrado e aqui mostra-se de onde
 * veio; nunca se apresenta como cotação oficial nem esconde a estimativa
 * histórica base.
 */
function CalibrationSection({
  calibration,
  headlineShown,
}: {
  calibration: EstimateCalibration;

  /** true = o valor calibrado já está em grande no topo do cartão. */
  headlineShown: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Sem cotações reais utilizáveis: só uma nota discreta.
  if (calibration.mode === "NONE") {
    return calibration.diagnostics.totalValidObservations === 0 ? (
      <p className="mt-3 text-xs leading-relaxed text-[#8a9099]">
        Ainda não existem cotações reais suficientes.
      </p>
    ) : (
      <p className="mt-3 text-xs leading-relaxed text-[#8a9099]">
        Calibração indisponível: {calibration.reason}
      </p>
    );
  }

  const { adjustment, diagnostics } = calibration;
  const difference = adjustment.amount;
  const sign = difference > 0 ? "+" : difference < 0 ? "−" : "";
  const percent =
    adjustment.percent === null
      ? null
      : `${adjustment.percent > 0 ? "+" : adjustment.percent < 0 ? "−" : ""}${Math.abs(adjustment.percent * 100).toFixed(0)}%`;

  return (
    <div className="mt-4 rounded-xl border border-dashed border-violet-300 bg-violet-50/60 p-3.5">
      <p className="text-xs font-semibold tracking-wide text-violet-800 uppercase">
        {headlineShown
          ? "Detalhe da calibração com cotações reais"
          : calibration.applied
            ? "Calibrada com cotações reais Zurich"
            : "Estimativa calibrada experimental"}
      </p>

      <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-[#7d848e]">Estimativa histórica</dt>
        <dd className="font-medium text-[#353b44]">
          {formatEstimate(calibration.baseEstimate)}
          <span className="text-[#8a9099]"> /ano</span>
        </dd>

        <dt className="text-[#7d848e]">
          {headlineShown
            ? "Valor calibrado (em destaque)"
            : calibration.applied
              ? "Estimativa principal (calibrada)"
              : "Calibração com cotações reais"}
        </dt>
        <dd className="font-semibold text-[#20242a]">
          {formatEstimate(
            calibration.applied
              ? calibration.productionSafeEstimate
              : calibration.calibratedEstimate,
          )}
          <span className="font-normal text-[#8a9099]"> /ano</span>
        </dd>

        <dt className="text-[#7d848e]">Diferença</dt>
        <dd className="font-medium text-[#353b44]">
          {sign}
          {formatEstimate(Math.abs(difference))}
          {percent && <span className="text-[#8a9099]"> ({percent})</span>}
        </dd>

        <dt className="text-[#7d848e]">Observações reais</dt>
        <dd className="font-medium text-[#353b44]">
          {calibration.sampleSize}
          {calibration.effectiveSampleSize !== null && (
            <span className="text-[#8a9099]">
              {" "}
              (amostra efetiva {calibration.effectiveSampleSize.toFixed(1)})
            </span>
          )}
        </dd>

        <dt className="text-[#7d848e]">Confiança da calibração</dt>
        <dd className="font-medium text-[#353b44]">
          {CONFIDENCE_LABEL[calibration.confidence]}
        </dd>
      </dl>

      {calibration.experimental && (
        <p className="mt-2.5 flex items-start gap-1.5 text-xs leading-relaxed text-violet-900">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {headlineShown && !calibration.applied
            ? "Amostra pequena de cotações reais: o valor em destaque já reflete a calibração, mas com confiança baixa e pode mudar com mais cotações. Não é uma cotação oficial da Zurich."
            : calibration.applied
              ? "A estimativa principal já inclui a correção com cotações reais. Não é uma cotação oficial da Zurich."
              : "Experimental — amostra insuficiente para produção: não altera a estimativa principal. Não é uma cotação oficial da Zurich."}
        </p>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="mt-2 flex items-center gap-1.5 rounded-lg text-xs font-medium text-violet-800 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-violet-200"
      >
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
        />
        {open ? "Ocultar diagnóstico" : "Diagnóstico da calibração"}
      </button>

      {open && (
        <div className="mt-2 space-y-2 text-xs text-[#525963]">
          <p>{calibration.reason}</p>

          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
            <dt className="text-[#8a9099]">Valor bruto dos dados</dt>
            <dd>
              {formatEstimate(calibration.calibratedEstimate)} /ano
              {calibration.clamped && " (o principal foi limitado)"}
            </dd>

            <dt className="text-[#8a9099]">Valor conservador (encolhido)</dt>
            <dd>{formatEstimate(calibration.productionSafeEstimate)} /ano</dd>

            <dt className="text-[#8a9099]">Observações válidas / usadas</dt>
            <dd>
              {diagnostics.totalValidObservations} / {diagnostics.consideredObservations}
            </dd>

            <dt className="text-[#8a9099]">Rejeitadas</dt>
            <dd>
              versão do modelo {diagnostics.rejected.modelVersion} · base do
              preço {diagnostics.rejected.basis} · cobertura{" "}
              {diagnostics.rejected.tier} · inválidas {diagnostics.rejected.invalid}
            </dd>

            {diagnostics.meanSimilarity !== null && (
              <>
                <dt className="text-[#8a9099]">Semelhança média</dt>
                <dd>{diagnostics.meanSimilarity.toFixed(2)}</dd>
              </>
            )}

            {diagnostics.globalBias !== null && (
              <>
                <dt className="text-[#8a9099]">Viés global / mediana</dt>
                <dd>
                  {formatEstimate(diagnostics.globalBias)} /{" "}
                  {diagnostics.medianResidual === null
                    ? "—"
                    : formatEstimate(diagnostics.medianResidual)}{" "}
                  (real − estimativa)
                </dd>
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}

function ConfidenceMeter({ level }: { level: ConfidenceLevel }) {
  const filled = CONFIDENCE_LEVEL_INDEX[level];

  return (
    <span className="inline-flex items-center gap-2 text-xs text-[#525963]">
      <span aria-hidden className="flex items-end gap-0.5">
        {[1, 2, 3].map((step) => (
          <span
            key={step}
            className={cn(
              "w-1.5 rounded-sm",
              step === 1 && "h-2",
              step === 2 && "h-3",
              step === 3 && "h-4",
              step <= filled ? "bg-[#353b44]" : "bg-[#dfe3e8]",
            )}
          />
        ))}
      </span>

      <span>
        Confiança{" "}
        <strong className="font-semibold text-[#20242a]">
          {CONFIDENCE_LABEL[level]}
        </strong>
      </span>
    </span>
  );
}

function QuoteMeta({
  quote,
  basisDescription,
}: {
  quote: EstimatedQuote | FirmQuote;

  /** Null quando a base é desconhecida (o cartão já a explica). */
  basisDescription: string | null;
}) {
  const rows: [string, string][] = [];

  if (basisDescription) rows.push(["Base do valor", basisDescription]);

  if (quote.status === "ESTIMATED") {
    rows.push(["Origem", "Modelo interno"]);
    rows.push(["Versão do modelo", quote.modelVersion]);

    if (quote.comparablePolicies !== null) {
      rows.push(["Riscos comparáveis", String(quote.comparablePolicies)]);
    }
  } else {
    rows.push(["Origem", SOURCE_LABEL[quote.source]]);

    if (quote.commercialPremium !== null) {
      rows.push(["Prémio comercial", formatFirm(quote.commercialPremium)]);
    }

    if (quote.totalPremium !== null) {
      rows.push(["Total a pagar", formatFirm(quote.totalPremium)]);
    }

    if (quote.externalReference) {
      rows.push(["Referência", quote.externalReference]);
    }
  }

  const time = formatTime(quote.generatedAt);

  if (time) rows.push(["Calculado às", time]);

  return (
    <dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[auto_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-[#8a9099]">{label}</dt>
          <dd className="font-medium text-[#353b44]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ *
 * Cartão sem preço (dados insuficientes, indisponível, timeout, erro)
 * ------------------------------------------------------------------ */

const UNAVAILABLE_ICON: Record<
  UnavailableQuote["status"],
  { icon: ElementType; tint: string }
> = {
  INSUFFICIENT_DATA: { icon: ClipboardList, tint: "bg-amber-50 text-amber-700" },
  NOT_SUPPORTED: { icon: Ban, tint: "bg-[#f0f2f5] text-[#7a818b]" },
  TIMEOUT: { icon: Clock, tint: "bg-amber-50 text-amber-700" },
  ERROR: { icon: CircleAlert, tint: "bg-red-50 text-red-600" },
};

type UnavailableQuoteCardProps = {
  quote: UnavailableQuote;
  onFixData: () => void;
  onRetry: () => void;
};

export function UnavailableQuoteCard({
  quote,
  onFixData,
  onRetry,
}: UnavailableQuoteCardProps) {
  const [open, setOpen] = useState(false);

  const copy = UNAVAILABLE_COPY[quote.status];
  const { icon: Icon, tint } = UNAVAILABLE_ICON[quote.status];

  const needsData = quote.status === "INSUFFICIENT_DATA";
  const canRetry = quote.status === "TIMEOUT" || quote.status === "ERROR";

  // Só os motivos de dados em falta são úteis ao mediador; os técnicos
  // (erro, timeout, sem modelo) ficam recolhidos.
  const detailsId = `unavailable-details-${quote.insurerCode}`;

  return (
    <article className={cn(cardClass, "border-dashed bg-[#fcfcfd] p-5")}>
      <InsurerHeader
        quote={quote}
        badge={
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
              tint,
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {copy.title}
          </span>
        }
      />

      <p className="mt-3 text-sm text-[#525963]">{copy.summary}</p>

      {needsData && quote.missingData.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Dados em falta">
          {quote.missingData.map((key) => (
            <li
              key={key}
              className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800"
            >
              {missingDataLabel(key)}
            </li>
          ))}
        </ul>
      )}

      {needsData && quote.reasons.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-[#353b44]">
          {quote.reasons.map((reason, index) => (
            <li key={`${index}-${reason}`} className="flex gap-2">
              <span
                aria-hidden
                className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#b4bac2]"
              />

              {reason}
            </li>
          ))}
        </ul>
      )}

      {(needsData || canRetry) && (
        <div className="mt-4">
          <button
            type="button"
            onClick={needsData ? onFixData : onRetry}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-[#d8dde4] bg-white px-3.5 text-sm font-medium text-[#353b44] transition hover:bg-[#f4f5f7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-200"
          >
            {needsData ? "Completar dados" : "Tentar novamente"}
          </button>
        </div>
      )}

      {!needsData && quote.reasons.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={detailsId}
            className="mt-3 flex items-center gap-1.5 rounded-lg text-xs font-medium text-[#7d848e] outline-none transition hover:text-[#20242a] focus-visible:ring-2 focus-visible:ring-orange-200"
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                open && "rotate-180",
              )}
            />

            Detalhes técnicos
          </button>

          {open && (
            <ul
              id={detailsId}
              className="mt-2 space-y-1 rounded-xl bg-[#f4f6f9] p-3 text-xs text-[#525963]"
            >
              {quote.reasons.map((reason, index) => (
                <li key={`${index}-${reason}`}>{reason}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ *
 * Skeletons
 * ------------------------------------------------------------------ */

export function QuoteCardSkeleton() {
  return (
    <div
      aria-hidden
      className={cn(cardClass, "animate-pulse p-5")}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-[#eceff3]" />
          <div className="h-4 w-28 rounded bg-[#eceff3]" />
        </div>

        <div className="h-6 w-24 rounded-full bg-[#eceff3]" />
      </div>

      <div className="mt-5 h-8 w-40 rounded bg-[#eceff3]" />
      <div className="mt-2 h-4 w-56 rounded bg-[#eceff3]" />
      <div className="mt-3 h-1.5 w-full rounded-full bg-[#eceff3]" />

      <div className="mt-4 flex gap-3">
        <div className="h-6 w-36 rounded-lg bg-[#eceff3]" />
        <div className="h-6 w-28 rounded-lg bg-[#eceff3]" />
      </div>

      <div className="mt-5 space-y-2 border-t border-[#edf0f2] pt-4">
        <div className="h-3.5 w-11/12 rounded bg-[#eceff3]" />
        <div className="h-3.5 w-3/4 rounded bg-[#eceff3]" />
      </div>
    </div>
  );
}
