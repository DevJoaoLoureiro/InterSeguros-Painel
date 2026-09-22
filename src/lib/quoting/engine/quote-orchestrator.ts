import type {
  EstimatedQuote,
  InsurerQuoteBase,
  InsurerQuoteResult,
  QuoteComparison,
  QuoteRequest,
  UnavailableQuote,
} from "../domain/types";
import { registerInsurers } from "../bootstrap";
import type { InsurerPricingModel } from "../models/insurer-pricing-model";
import {
  getInsurersForProductLine,
  type InsurerLineEntry,
} from "../registry/insurer-registry";
import { compareQuotes } from "./quote-comparator";

/*
 * Orçamento de tempo por companhia (canEstimate + estimate). Valor
 * conservador enquanto só existem modelos que leem da BD; a afinar quando
 * houver companhias com API externa (essas declaram `timeoutMs` no modelo).
 */
export const DEFAULT_INSURER_TIMEOUT_MS = 15_000;

export type QuoteRunOptions = {
  /** Sobrepõe o timeout de todas as companhias neste pedido. */
  timeoutMs?: number;

  /**
   * Por omissão o motor regista as companhias padrão antes de correr
   * (idempotente). Passar false para usar só o que já está no registry.
   */
  registerDefaultInsurers?: boolean;
};

class InsurerTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`A companhia não respondeu em ${timeoutMs} ms.`);
    this.name = "InsurerTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/*
 * Rejeita com InsurerTimeoutError se `work` não terminar a tempo.
 *
 * Limitação assumida: o trabalho em curso NÃO é cancelado (a interface dos
 * modelos não recebe AbortSignal); o resultado tardio é simplesmente
 * ignorado. A rejeição tardia fica tratada aqui, por isso não gera
 * unhandled rejection.
 */
function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new InsurerTimeoutError(timeoutMs)),
      timeoutMs,
    );

    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function resolveTimeoutMs(
  model: InsurerPricingModel,
  options: QuoteRunOptions,
): number {
  const candidate = options.timeoutMs ?? model.timeoutMs;

  return typeof candidate === "number" &&
    Number.isFinite(candidate) &&
    candidate > 0
    ? candidate
    : DEFAULT_INSURER_TIMEOUT_MS;
}

type QuoteIdentity = Pick<
  InsurerQuoteBase,
  "insurerCode" | "insurerName" | "productLine"
>;

function unavailable(
  identity: QuoteIdentity,
  status: UnavailableQuote["status"],
  reasons: string[],
  missingData: string[] = [],
): UnavailableQuote {
  return {
    ...identity,
    status,
    reasons,
    warnings: [],
    missingData,
    generatedAt: new Date().toISOString(),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/*
 * Defesa contra modelos que violem o contrato em runtime: uma estimativa
 * sem valor utilizável não pode chegar ao comparador como se fosse preço.
 */
function isUsableEstimate(quote: EstimatedQuote): boolean {
  const range = quote.priceRange;

  return (
    quote.status === "ESTIMATED" &&
    Number.isFinite(quote.pointEstimate) &&
    quote.pointEstimate > 0 &&
    !!range &&
    Number.isFinite(range.min) &&
    Number.isFinite(range.max)
  );
}

async function runModel(
  model: InsurerPricingModel,
  request: QuoteRequest,
  identity: QuoteIdentity,
): Promise<InsurerQuoteResult> {
  if (!model.supports(request.productLine)) {
    return unavailable(identity, "NOT_SUPPORTED", [
      `O modelo da companhia não suporta o ramo ${request.productLine}.`,
    ]);
  }

  const eligibility = await model.canEstimate(request);

  if (!eligibility.ok) {
    const reasons = eligibility.reasons ?? [];

    return unavailable(
      identity,
      "INSUFFICIENT_DATA",
      reasons.length > 0 ? reasons : ["Dados insuficientes para estimar."],
      eligibility.missingData ?? [],
    );
  }

  const quote = await model.estimate(request);

  if (!isUsableEstimate(quote)) {
    return unavailable(identity, "ERROR", [
      "O modelo devolveu uma estimativa inválida.",
    ]);
  }

  return quote;
}

/*
 * Nunca rejeita: qualquer falha (exceção síncrona ou assíncrona, timeout,
 * resposta inválida) vira um resultado da própria companhia.
 */
async function quoteWithInsurer(
  entry: InsurerLineEntry,
  request: QuoteRequest,
  options: QuoteRunOptions,
): Promise<InsurerQuoteResult> {
  const identity: QuoteIdentity = {
    insurerCode: entry.insurerCode,
    insurerName: entry.insurerName,
    productLine: request.productLine,
  };

  const { model } = entry;

  if (!model) {
    return unavailable(identity, "NOT_SUPPORTED", [
      `A companhia suporta o ramo ${request.productLine} mas ainda não tem modelo de pricing registado.`,
    ]);
  }

  const timeoutMs = resolveTimeoutMs(model, options);

  try {
    return await withTimeout(runModel(model, request, identity), timeoutMs);
  } catch (error) {
    if (error instanceof InsurerTimeoutError) {
      console.warn(`[quoting] ${entry.insurerCode}: ${error.message}`);

      return unavailable(identity, "TIMEOUT", [error.message]);
    }

    console.error(`[quoting] ${entry.insurerCode} falhou:`, error);

    return unavailable(identity, "ERROR", [
      `Erro ao estimar: ${errorMessage(error)}`,
    ]);
  }
}

export async function runMultiInsurerQuote(
  request: QuoteRequest,
  options: QuoteRunOptions = {},
): Promise<QuoteComparison> {
  if (options.registerDefaultInsurers !== false) {
    registerInsurers();
  }

  const entries = getInsurersForProductLine(request.productLine);

  const settled = await Promise.allSettled(
    entries.map((entry) => quoteWithInsurer(entry, request, options)),
  );

  const results = settled.map((outcome, index): InsurerQuoteResult => {
    if (outcome.status === "fulfilled") return outcome.value;

    /*
     * Não deve acontecer (quoteWithInsurer trata tudo), mas garante que
     * uma companhia nunca derruba a comparação das restantes.
     */
    const entry = entries[index];

    console.error(`[quoting] ${entry.insurerCode} falhou:`, outcome.reason);

    return unavailable(
      {
        insurerCode: entry.insurerCode,
        insurerName: entry.insurerName,
        productLine: request.productLine,
      },
      "ERROR",
      [`Erro ao estimar: ${errorMessage(outcome.reason)}`],
    );
  });

  return compareQuotes(request, results);
}
