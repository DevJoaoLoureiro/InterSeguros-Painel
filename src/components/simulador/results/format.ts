import type {
  ConfidenceLevel,
  PremiumBasis,
  QuoteSource,
  UnavailableQuote,
} from "@/lib/quoting/domain/types";

import type { SimulatorPaymentFrequency } from "../types";

/*
 * Textos e formatação dos resultados. Tudo aqui é apresentação: nenhuma
 * regra de preço, nenhuma referência a uma seguradora concreta.
 */

const eurRounded = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const eurExact = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Estimativas mostram-se em euros inteiros: decimais dariam falsa precisão. */
export function formatEstimate(value: number): string {
  return eurRounded.format(value);
}

/** Valores firmes mostram-se ao cêntimo. */
export function formatFirm(value: number): string {
  return eurExact.format(value);
}

export function formatTime(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatDate(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return iso;

  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/* ------------------------------------------------------------------ *
 * Base do prémio
 * ------------------------------------------------------------------ */

export type BasisDescriptor = {
  /** Rótulo curto para o chip (ex.: "Anual · total a pagar"). */
  label: string;

  /** Sufixo junto ao valor (ex.: "/ano"); vazio quando a base é desconhecida. */
  unit: string;

  /** Frase completa para o mediador. */
  description: string;

  /** false => valor não comparável com nenhum outro. */
  known: boolean;
};

const FREQUENCY_LABEL: Record<SimulatorPaymentFrequency, string> = {
  ANNUAL: "Anual",
  SEMIANNUAL: "Semestral",
  QUARTERLY: "Trimestral",
  MONTHLY: "Mensal",
};

const FREQUENCY_UNIT: Record<SimulatorPaymentFrequency, string> = {
  ANNUAL: "/ano",
  SEMIANNUAL: "/semestre",
  QUARTERLY: "/trimestre",
  MONTHLY: "/mês",
};

export function frequencyLabel(frequency: SimulatorPaymentFrequency): string {
  return FREQUENCY_LABEL[frequency];
}

/*
 * `frequency` é a periodicidade pedida na simulação; só interessa quando o
 * prémio é por prestação (nesse caso o valor refere-se a essa prestação).
 */
export function describeBasis(
  basis: PremiumBasis,
  frequency: SimulatorPaymentFrequency,
): BasisDescriptor {
  switch (basis) {
    case "ANNUAL_TOTAL":
      return {
        label: "Anual · total a pagar",
        unit: "/ano",
        description:
          "Total anual a pagar, com encargos e impostos.",
        known: true,
      };

    case "ANNUAL_COMMERCIAL":
      return {
        label: "Anual · prémio comercial",
        unit: "/ano",
        description:
          "Prémio comercial anual, sem encargos nem impostos.",
        known: true,
      };

    case "INSTALLMENT_TOTAL":
      return {
        label: `${FREQUENCY_LABEL[frequency]} · total por prestação`,
        unit: FREQUENCY_UNIT[frequency],
        description: `Total a pagar em cada prestação (fracionamento ${FREQUENCY_LABEL[frequency].toLowerCase()}).`,
        known: true,
      };

    case "UNKNOWN":
      return {
        label: "Base não confirmada",
        unit: "",
        description:
          "Ainda não está confirmado se o valor é anual ou por prestação, comercial ou total. Não o compare com outros valores.",
        known: false,
      };
  }
}

/* ------------------------------------------------------------------ *
 * Confiança, tipo e origem
 * ------------------------------------------------------------------ */

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
};

export const CONFIDENCE_LEVEL_INDEX: Record<ConfidenceLevel, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

export const SOURCE_LABEL: Record<Exclude<QuoteSource, "INTERNAL_MODEL">, string> = {
  INSURER_API: "API da seguradora",
  INSURER_PORTAL: "Portal da seguradora",
  MANUAL: "Introduzida manualmente",
};

/* ------------------------------------------------------------------ *
 * Resultados sem preço
 * ------------------------------------------------------------------ */

export type UnavailableCopy = {
  title: string;
  summary: string;
};

export const UNAVAILABLE_COPY: Record<
  UnavailableQuote["status"],
  UnavailableCopy
> = {
  INSUFFICIENT_DATA: {
    title: "Dados insuficientes",
    summary: "Faltam dados para esta seguradora calcular.",
  },
  NOT_SUPPORTED: {
    title: "Indisponível para este ramo",
    summary: "Esta seguradora ainda não tem modelo de cálculo para este ramo.",
  },
  TIMEOUT: {
    title: "Sem resposta a tempo",
    summary: "O cálculo demorou demasiado. Pode tentar de novo.",
  },
  ERROR: {
    title: "Erro ao calcular",
    summary: "Não foi possível calcular esta seguradora. As restantes não foram afetadas.",
  },
};

/** Ordem de apresentação dos resultados sem preço (o que se pode corrigir primeiro). */
export const UNAVAILABLE_ORDER: UnavailableQuote["status"][] = [
  "INSUFFICIENT_DATA",
  "TIMEOUT",
  "ERROR",
  "NOT_SUPPORTED",
];

const MISSING_DATA_LABEL: Record<string, string> = {
  "customer.birthDate": "Data de nascimento",
  "customer.postalCode": "Código postal",
  "customer.drivingLicenceDate": "Data da carta",
  "customer.usage": "Uso da viatura",
  "vehicle.registration": "Matrícula",
  "vehicle.marketValue": "Valor da viatura",
  "claims": "Histórico de sinistros",
};

export function missingDataLabel(key: string): string {
  return MISSING_DATA_LABEL[key] ?? key;
}
