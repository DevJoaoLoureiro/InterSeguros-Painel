import type {
  EstimatedQuote,
  FirmQuote,
  InsurerQuoteResult,
  PremiumBasis,
  UnavailableQuote,
} from "@/lib/quoting/domain/types";

import { UNAVAILABLE_ORDER } from "./format";

/*
 * Organiza os resultados de uma comparação para apresentação.
 *
 * Regra central: só há comparação de preços dentro de um grupo com o mesmo
 * tipo (firme/estimativa) E a mesma base de prémio conhecida. Qualquer
 * outra mistura fica em grupos separados, cada um com o seu cabeçalho, e
 * grupos de base desconhecida nunca são ordenados por preço (a ordem
 * sugeriria um ranking que não podemos garantir).
 *
 * Não escolhe "a melhor": a ordenação por preço é só apresentação.
 */

export type PricedQuote = EstimatedQuote | FirmQuote;

export type ResultGroup = {
  /** Identificador estável do grupo (para keys do React). */
  key: string;

  kind: "FIRM" | "ESTIMATED";
  basis: PremiumBasis;

  /** Preços do grupo comparáveis entre si (base conhecida). */
  comparable: boolean;

  /** Ordenado por preço crescente só se `comparable` e houver 2+ itens. */
  sortedByPrice: boolean;

  items: PricedQuote[];
};

export type GroupedResults = {
  groups: ResultGroup[];
  unavailable: UnavailableQuote[];
};

const BASIS_ORDER: PremiumBasis[] = [
  "ANNUAL_TOTAL",
  "ANNUAL_COMMERCIAL",
  "INSTALLMENT_TOTAL",
  "UNKNOWN",
];

const collator = new Intl.Collator("pt-PT", { sensitivity: "base" });

export function priceOf(quote: PricedQuote): number {
  return quote.status === "FIRM" ? quote.premium : quote.pointEstimate;
}

function isPriced(quote: InsurerQuoteResult): quote is PricedQuote {
  return quote.status === "ESTIMATED" || quote.status === "FIRM";
}

export function groupResults(results: InsurerQuoteResult[]): GroupedResults {
  const buckets = new Map<string, ResultGroup>();
  const unavailable: UnavailableQuote[] = [];

  for (const result of results) {
    if (!isPriced(result)) {
      unavailable.push(result);
      continue;
    }

    const key = `${result.status}:${result.premiumBasis}`;
    let group = buckets.get(key);

    if (!group) {
      const comparable = result.premiumBasis !== "UNKNOWN";

      group = {
        key,
        kind: result.status,
        basis: result.premiumBasis,
        comparable,
        sortedByPrice: false,
        items: [],
      };
      buckets.set(key, group);
    }

    group.items.push(result);
  }

  const groups = Array.from(buckets.values())
    .map((group): ResultGroup => {
      const sortedByPrice = group.comparable && group.items.length > 1;

      const items = [...group.items].sort((a, b) =>
        sortedByPrice
          ? priceOf(a) - priceOf(b) ||
            collator.compare(a.insurerName, b.insurerName)
          : collator.compare(a.insurerName, b.insurerName),
      );

      return { ...group, sortedByPrice, items };
    })
    .sort(
      (a, b) =>
        // Cotações firmes antes de estimativas; depois por base conhecida.
        (a.kind === b.kind ? 0 : a.kind === "FIRM" ? -1 : 1) ||
        BASIS_ORDER.indexOf(a.basis) - BASIS_ORDER.indexOf(b.basis),
    );

  unavailable.sort(
    (a, b) =>
      UNAVAILABLE_ORDER.indexOf(a.status) -
        UNAVAILABLE_ORDER.indexOf(b.status) ||
      collator.compare(a.insurerName, b.insurerName),
  );

  return { groups, unavailable };
}

/** Há valores de grupos diferentes, logo não comparáveis entre si. */
export function hasMixedGroups(groups: ResultGroup[]): boolean {
  return groups.length > 1;
}
