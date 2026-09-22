import type {
  EstimatedQuote,
  FirmQuote,
  InsurerQuoteResult,
  QuoteComparison,
  QuoteRequest,
  QuoteStatus,
} from "../domain/types";

export function isEstimatedQuote(quote: InsurerQuoteResult): quote is EstimatedQuote {
  return quote.status === "ESTIMATED";
}

export function isFirmQuote(quote: InsurerQuoteResult): quote is FirmQuote {
  return quote.status === "FIRM";
}

export function isPricedQuote(quote: InsurerQuoteResult): quote is EstimatedQuote | FirmQuote {
  return isEstimatedQuote(quote) || isFirmQuote(quote);
}

/*
 * Ordem de apresentação: cotações firmes, estimativas, e só depois as
 * companhias sem preço.
 */
const STATUS_RANK: Record<QuoteStatus, number> = {
  FIRM: 0,
  ESTIMATED: 1,
  INSUFFICIENT_DATA: 2,
  NOT_SUPPORTED: 3,
  TIMEOUT: 4,
  ERROR: 5,
};

function priceOf(quote: InsurerQuoteResult): number | null {
  const price =
    quote.status === "ESTIMATED" ? quote.pointEstimate
    : quote.status === "FIRM" ? quote.premium
    : null;

  return price !== null && Number.isFinite(price) && price > 0 ? price : null;
}

function comparePrices(a: InsurerQuoteResult, b: InsurerQuoteResult): number {
  const priceA = priceOf(a);
  const priceB = priceOf(b);

  if (priceA === priceB) return 0;
  if (priceA === null) return 1;
  if (priceB === null) return -1;

  return priceA - priceB;
}

/*
 * Só indica a mais barata quando os valores são comparáveis: uma única
 * cotação, ou várias com a mesma premiumBasis e conhecida. Sem isso, "a mais
 * barata" podia comparar prémios comerciais com totais, ou anuais com
 * prestações, e ficaria errada sem ninguém dar por isso.
 */
function pickCheapest<T extends EstimatedQuote | FirmQuote>(
  quotes: T[],
  label: string,
  warnings: string[],
): T | null {
  const priced = quotes
    .filter((quote) => priceOf(quote) !== null)
    .sort(comparePrices);

  if (priced.length === 0) return null;
  if (priced.length === 1) return priced[0];

  const bases = new Set(priced.map((quote) => quote.premiumBasis));

  if (bases.size > 1 || bases.has("UNKNOWN")) {
    warnings.push(
      `Não foi indicada a ${label} mais barata: os prémios têm bases diferentes ou não confirmadas (${Array.from(bases).join(", ")}).`,
    );
    return null;
  }

  return priced[0];
}

export function compareQuotes(request: QuoteRequest, results: InsurerQuoteResult[]): QuoteComparison {
  const warnings: string[] = [];

  const ordered = [...results].sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || comparePrices(a, b),
  );

  return {
    requestId: request.requestId,
    productLine: request.productLine,
    results: ordered,
    cheapestEstimated: pickCheapest(results.filter(isEstimatedQuote), "estimativa", warnings),
    cheapestFirm: pickCheapest(results.filter(isFirmQuote), "cotação firme", warnings),
    warnings,
    generatedAt: new Date().toISOString(),
  };
}
