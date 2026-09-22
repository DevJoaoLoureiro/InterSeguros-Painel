import { compareQuotes } from "../engine/quote-comparator";
import type {
  FirmQuote,
  PremiumBasis,
  QuoteComparison,
  QuoteRequest,
} from "../domain/types";
import { tierFromRequestedCoverages } from "../models/zurich/zurich-auto-coverages";
import {
  normalizeDate,
  normalizePlate,
  normalizePostalCode,
  normalizeText,
  toFiniteNumber,
} from "./normalize";
import type {
  DuplicateCandidate,
  ObservationStore,
  RealQuoteBasis,
} from "./types";

/*
 * COTAÇÃO REAL ZURICH COMO VALOR PRINCIPAL.
 *
 * Se o agente já simulou este MESMO pedido no portal da Zurich e guardou o
 * preço (zurich_quote_observations), esse preço real é melhor que qualquer
 * estimativa: aparece como resultado principal (uma FirmQuote de origem
 * MANUAL, que a apresentação já coloca à frente das estimativas). A
 * estimativa interna continua ao lado, como comparação; nada se apaga nem se
 * altera (estimated_premium continua a ser a base).
 *
 * "Mesmo pedido" = TODOS os sinais coincidem: matrícula, data de nascimento,
 * data da carta, código postal, tipo de cobertura, franquia e fracionamento.
 * Desconhecido nunca é tratado como igual. Não se usa o NIF nem o cliente.
 * A cotação só vale durante REAL_QUOTE_VALIDITY_DAYS (as tarifas mudam).
 *
 * Só bases comparáveis com um prémio anual: ANNUAL, TOTAL e UNKNOWN (com
 * aviso). INSTALLMENT e COMMERCIAL são outra grandeza e não se mostram como
 * o valor principal.
 */

/** Durante quantos dias uma cotação real guardada continua a valer para o mesmo pedido. */
export const REAL_QUOTE_VALIDITY_DAYS = 30;

const DAY_MS = 86_400_000;

const USABLE_STATUSES = new Set(["VALID", "MANUAL_OVERRIDE"]);

/** Base do valor real -> base do prémio apresentada. */
const BASIS_MAP: Partial<Record<RealQuoteBasis, PremiumBasis>> = {
  ANNUAL: "ANNUAL_TOTAL",
  TOTAL: "ANNUAL_TOTAL",
  UNKNOWN: "UNKNOWN",
};

export type RequestIdentity = {
  plate: string | null;
  birthDate: string | null;
  drivingLicenceDate: string | null;
  postalCode: string | null;
  coverageTier: string | null;
  deductible: number | null;
  paymentFrequency: string | null;
};

/** O pedido reduzido ao que identifica o "mesmo risco" (mesma normalização das observações). */
export function requestIdentity(request: QuoteRequest): RequestIdentity {
  const coverages = request.requestedCoverages;

  return {
    plate: normalizePlate(request.vehicle?.registration),
    birthDate: normalizeDate(request.customer?.birthDate),
    drivingLicenceDate: normalizeDate(request.customer?.drivingLicenceDate),
    postalCode: normalizePostalCode(request.customer?.postalCode),
    coverageTier: coverages ? tierFromRequestedCoverages(coverages) : null,
    deductible: toFiniteNumber(coverages?.deductible),
    paymentFrequency: normalizeText(request.paymentFrequency),
  };
}

function sameNumber(a: number | null, b: number | null): boolean {
  return a === null || b === null ? a === b : Math.abs(a - b) < 0.005;
}

function matches(identity: RequestIdentity, candidate: DuplicateCandidate): boolean {
  return (
    identity.plate !== null &&
    identity.plate === candidate.vehicle_registration &&
    identity.birthDate !== null &&
    identity.birthDate === candidate.birth_date &&
    // Data da carta: igual, ou desconhecida nos dois lados (nunca um lado só).
    identity.drivingLicenceDate === candidate.driving_licence_date &&
    identity.postalCode !== null &&
    identity.postalCode === candidate.postal_code &&
    identity.coverageTier !== null &&
    identity.coverageTier === candidate.coverage_tier &&
    sameNumber(identity.deductible, candidate.deductible) &&
    identity.paymentFrequency !== null &&
    identity.paymentFrequency === candidate.payment_frequency
  );
}

export type RealQuoteMatch = {
  observationId: string;
  amount: number;
  basis: RealQuoteBasis;
  productCode: string | null;
  productName: string | null;
  reference: string | null;
  quotedAt: string;
  ageDays: number;
};

/**
 * A cotação real mais recente que corresponde ao pedido e ainda vale, ou
 * null. Pura: não toca na BD.
 */
export function findMatchingRealQuote(
  request: QuoteRequest,
  candidates: readonly DuplicateCandidate[],
  now: Date = new Date(),
): RealQuoteMatch | null {
  const identity = requestIdentity(request);

  const found = candidates
    .filter(
      (candidate) =>
        USABLE_STATUSES.has(candidate.status) &&
        BASIS_MAP[candidate.real_quote_basis] !== undefined &&
        Number.isFinite(candidate.real_quote_amount) &&
        candidate.real_quote_amount > 0 &&
        matches(identity, candidate),
    )
    .map((candidate) => ({
      candidate,
      quotedMs: Date.parse(candidate.quoted_at),
      createdMs: Date.parse(candidate.created_at),
    }))
    .filter(({ quotedMs }) => {
      const age = now.getTime() - quotedMs;

      // Só cotações recentes e não "do futuro".
      return !Number.isNaN(quotedMs) && age >= -DAY_MS && age <= REAL_QUOTE_VALIDITY_DAYS * DAY_MS;
    })
    .sort((a, b) => b.quotedMs - a.quotedMs || b.createdMs - a.createdMs)[0];

  if (!found) return null;

  const { candidate, quotedMs } = found;

  return {
    observationId: candidate.id,
    amount: candidate.real_quote_amount,
    basis: candidate.real_quote_basis,
    productCode: normalizeText(candidate.real_product_code),
    productName: normalizeText(candidate.real_product_name),
    reference: normalizeText(candidate.real_quote_reference),
    quotedAt: new Date(quotedMs).toISOString(),
    ageDays: Math.max(0, Math.floor((now.getTime() - quotedMs) / DAY_MS)),
  };
}

const dateFormat = new Intl.DateTimeFormat("pt-PT", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** A cotação real como resultado principal (FirmQuote de origem MANUAL). */
export function realQuoteToFirmQuote(match: RealQuoteMatch, now: Date = new Date()): FirmQuote {
  const premiumBasis = BASIS_MAP[match.basis] ?? "UNKNOWN";
  const quotedOn = dateFormat.format(new Date(match.quotedAt));

  const warnings = [
    "Não é uma proposta vinculativa: os valores da Zurich podem mudar. Confirme no portal antes de propor ao cliente.",
  ];

  if (match.basis === "UNKNOWN") {
    warnings.push(
      "Quando foi guardada, a base do valor (anual, total…) não foi confirmada.",
    );
  }

  if (match.ageDays >= 7) {
    warnings.push(`Cotação com ${match.ageDays} dias.`);
  }

  return {
    insurerCode: "ZURICH",
    insurerName: "Zurich",
    productLine: "AUTO",

    reasons: [
      `Cotação real simulada no portal da Zurich em ${quotedOn} e guardada no painel.`,
      "Corresponde a este pedido (mesma matrícula, datas, código postal, cobertura, franquia e fracionamento).",
      ...(match.productName ? [`Produto: ${match.productName}.`] : []),
    ],
    warnings,
    generatedAt: now.toISOString(),

    status: "FIRM",
    source: "MANUAL",

    premiumBasis,
    premium: match.amount,

    commercialPremium: null,
    totalPremium: match.basis === "TOTAL" ? match.amount : null,

    validUntil: new Date(
      Date.parse(match.quotedAt) + REAL_QUOTE_VALIDITY_DAYS * DAY_MS,
    ).toISOString(),
    externalReference: match.reference,
  };
}

/**
 * Acrescenta a cotação real (se existir) à comparação, que a apresenta à
 * frente das estimativas. NUNCA lança: se a leitura falhar, devolve a
 * comparação intacta (o cálculo não depende da tabela de observações).
 */
export async function attachZurichRealQuote(
  request: QuoteRequest,
  comparison: QuoteComparison,
  store: Pick<ObservationStore, "findDuplicateCandidates">,
  now: Date = new Date(),
): Promise<{ comparison: QuoteComparison; match: RealQuoteMatch | null }> {
  const plate = requestIdentity(request).plate;

  if (plate === null) return { comparison, match: null };

  try {
    const candidates = await store.findDuplicateCandidates({ plate, reference: null });
    const match = findMatchingRealQuote(request, candidates, now);

    if (!match) return { comparison, match: null };

    return {
      comparison: compareQuotes(request, [...comparison.results, realQuoteToFirmQuote(match, now)]),
      match,
    };
  } catch (error) {
    // Só o nome: a mensagem pode conter dados pessoais.
    console.error(
      "[simulador] Não foi possível procurar cotações reais Zurich:",
      error instanceof Error ? error.name : "erro",
    );

    return { comparison, match: null };
  }
}
