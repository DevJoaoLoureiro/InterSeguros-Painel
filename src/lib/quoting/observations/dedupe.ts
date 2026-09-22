import {
  comparableText,
  normalizeReference,
} from "./normalize";
import type { DuplicateCandidate } from "./types";

/*
 * Deteção CONSERVADORA de duplicados. Nunca apaga nada: quem chama marca a
 * nova linha como DUPLICATE (duplicate_of = original) e a original fica.
 *
 * Só se declara duplicado com certeza:
 *
 *  SAME_REFERENCE      mesma referência de simulação Zurich (normalizada)
 *                      E matrícula compatível (igual, ou uma delas
 *                      desconhecida). Referência igual com matrículas
 *                      diferentes NÃO é duplicado.
 *
 *  SAME_RISK_AND_PRICE mesma matrícula, data de nascimento, data da carta,
 *                      código postal, tier, franquia, fracionamento e
 *                      produto compatível, com preço real a menos de 1% e
 *                      feita a menos de 30 dias da original. Um preço
 *                      diferente é uma nova cotação (a Zurich reprecificou):
 *                      fica como observação própria.
 *
 * "Compatível" nunca trata desconhecido como igual: se um lado sabe e o
 * outro não, não há certeza e não se marca.
 *
 * Só se comparam linhas VALID ou MANUAL_OVERRIDE (uma linha TEST, INVALID ou
 * já DUPLICATE não é "a original" de nada).
 */

export const DUPLICATE_WINDOW_DAYS = 30;
export const DUPLICATE_PRICE_TOLERANCE = 0.01;

const COMPARABLE_STATUSES = new Set(["VALID", "MANUAL_OVERRIDE"]);

export type DuplicateProbe = {
  plate: string | null;
  reference: string | null;
  birthDate: string | null;
  drivingLicenceDate: string | null;
  postalCode: string | null;
  coverageTier: string | null;
  deductible: number | null;
  paymentFrequency: string | null;
  productCode: string | null;
  productName: string | null;
  quotedAt: string;
  amount: number;
};

export type DuplicateMatch = {
  duplicateOf: string;
  reason: "SAME_REFERENCE" | "SAME_RISK_AND_PRICE";

  /** Sinais que coincidiram (para auditoria/notas). */
  signals: string[];
};

const DAY_MS = 86_400_000;

function equalOrBothNull<T>(a: T | null, b: T | null): boolean {
  return a === b;
}

function sameNumberOrBothNull(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;

  return Math.abs(a - b) < 0.005;
}

function productsCompatible(
  probe: Pick<DuplicateProbe, "productCode" | "productName">,
  candidate: Pick<DuplicateCandidate, "real_product_code" | "real_product_name">,
): boolean {
  const codeA = comparableText(probe.productCode);
  const codeB = comparableText(candidate.real_product_code);

  if (codeA !== null && codeB !== null) return codeA === codeB;

  const nameA = comparableText(probe.productName);
  const nameB = comparableText(candidate.real_product_name);

  if (nameA !== null && nameB !== null) return nameA === nameB;

  // Sem nada comparável de um dos lados: só é compatível se ambos estão vazios.
  return codeA === null && codeB === null && nameA === null && nameB === null;
}

function withinWindow(quotedA: string, quotedB: string): boolean {
  const a = Date.parse(quotedA);
  const b = Date.parse(quotedB);

  return (
    !Number.isNaN(a) &&
    !Number.isNaN(b) &&
    Math.abs(a - b) <= DUPLICATE_WINDOW_DAYS * DAY_MS
  );
}

function closeAmount(a: number, b: number): boolean {
  const max = Math.max(Math.abs(a), Math.abs(b));

  return max > 0 && Math.abs(a - b) / max <= DUPLICATE_PRICE_TOLERANCE;
}

function matchOf(
  probe: DuplicateProbe,
  candidate: DuplicateCandidate,
): DuplicateMatch | null {
  const probeReference = normalizeReference(probe.reference);
  const candidateReference = normalizeReference(candidate.real_quote_reference);

  const plateCompatible =
    probe.plate === null ||
    candidate.vehicle_registration === null ||
    probe.plate === candidate.vehicle_registration;

  if (
    probeReference !== null &&
    probeReference === candidateReference &&
    plateCompatible
  ) {
    return {
      duplicateOf: candidate.id,
      reason: "SAME_REFERENCE",
      signals: ["real_quote_reference"],
    };
  }

  const sameRisk =
    probe.plate !== null &&
    probe.plate === candidate.vehicle_registration &&
    probe.birthDate !== null &&
    probe.birthDate === candidate.birth_date &&
    equalOrBothNull(probe.drivingLicenceDate, candidate.driving_licence_date) &&
    probe.postalCode !== null &&
    probe.postalCode === candidate.postal_code &&
    probe.coverageTier !== null &&
    probe.coverageTier === candidate.coverage_tier &&
    sameNumberOrBothNull(probe.deductible, candidate.deductible) &&
    probe.paymentFrequency !== null &&
    probe.paymentFrequency === candidate.payment_frequency &&
    productsCompatible(probe, candidate);

  if (
    sameRisk &&
    withinWindow(probe.quotedAt, candidate.quoted_at) &&
    closeAmount(probe.amount, candidate.real_quote_amount)
  ) {
    return {
      duplicateOf: candidate.id,
      reason: "SAME_RISK_AND_PRICE",
      signals: [
        "vehicle_registration",
        "birth_date",
        "driving_licence_date",
        "postal_code",
        "coverage_tier",
        "deductible",
        "payment_frequency",
        "product",
        "real_quote_amount",
        "quoted_at",
      ],
    };
  }

  return null;
}

/**
 * A observação ORIGINAL mais antiga que coincide com a sonda, ou null se não
 * houver certeza. Pura: não toca na BD.
 */
export function findPossibleDuplicate(
  probe: DuplicateProbe,
  candidates: readonly DuplicateCandidate[],
): DuplicateMatch | null {
  const ordered = candidates
    .filter((candidate) => COMPARABLE_STATUSES.has(candidate.status))
    .sort(
      (a, b) =>
        Date.parse(a.created_at) - Date.parse(b.created_at) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

  for (const candidate of ordered) {
    const match = matchOf(probe, candidate);

    if (match) return match;
  }

  return null;
}
