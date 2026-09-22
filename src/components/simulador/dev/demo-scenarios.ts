import type {
  EstimatedQuote,
  FirmQuote,
  InsurerQuoteResult,
  UnavailableQuote,
} from "@/lib/quoting/domain/types";

import type { RunState } from "../results/run-state";
import type { SimulatorPaymentFrequency } from "../types";

/*
 * DADOS FICTÍCIOS — SÓ PARA PRÉ-VISUALIZAR A UI.
 *
 * Nada aqui vem do motor de cotações nem de seguradoras reais: as
 * seguradoras chamam-se "Alfa", "Beta"... e os valores são inventados para
 * exercitar cada estado visual (várias seguradoras, bases diferentes,
 * falhas parciais). Está separado da lógica real de propósito e só é
 * carregado quando o simulador corre fora de produção.
 */

export type DemoScenario = {
  id: string;
  label: string;
  build: () => RunState;
};

const now = () => new Date().toISOString();

const SUMMARY = [
  "AB-12-CD",
  "Particular",
  "Todos os riscos",
  "Franquia 250 €",
];

function estimated(
  partial: Pick<
    EstimatedQuote,
    | "insurerCode"
    | "insurerName"
    | "premiumBasis"
    | "pointEstimate"
    | "priceRange"
    | "confidence"
    | "comparablePolicies"
  > &
    Partial<Pick<EstimatedQuote, "reasons" | "warnings" | "consideredFactors">>,
): EstimatedQuote {
  return {
    productLine: "AUTO",
    status: "ESTIMATED",
    source: "INTERNAL_MODEL",
    modelVersion: "demo-v0",
    reasons: [
      "Valor baseado em riscos históricos comparáveis.",
      "Intervalo com margem de segurança aplicada.",
    ],
    warnings: [],
    generatedAt: now(),
    ...partial,
  };
}

function firm(
  partial: Pick<
    FirmQuote,
    "insurerCode" | "insurerName" | "premiumBasis" | "premium"
  > &
    Partial<FirmQuote>,
): FirmQuote {
  return {
    productLine: "AUTO",
    status: "FIRM",
    source: "INSURER_API",
    commercialPremium: null,
    totalPremium: null,
    validUntil: null,
    externalReference: null,
    reasons: ["Valor devolvido pela seguradora para este risco."],
    warnings: [],
    generatedAt: now(),
    ...partial,
  };
}

function unavailable(
  status: UnavailableQuote["status"],
  insurerCode: string,
  insurerName: string,
  reasons: string[],
  missingData: string[] = [],
): UnavailableQuote {
  return {
    productLine: "AUTO",
    status,
    insurerCode,
    insurerName,
    reasons,
    warnings: [],
    missingData,
    generatedAt: now(),
  };
}

function done(
  results: InsurerQuoteResult[],
  label: string,
  frequency: SimulatorPaymentFrequency = "ANNUAL",
): RunState {
  return {
    phase: "done",
    comparison: {
      requestId: "demo",
      productLine: "AUTO",
      results,
      cheapestEstimated: null,
      cheapestFirm: null,
      warnings: [],
      generatedAt: now(),
    },
    summary: SUMMARY,
    frequency,
    snapshotKey: "demo",
    demoLabel: label,
  };
}

const UNCONFIRMED_WARNING =
  "Base do prémio histórico não confirmada (comercial/total, anual/prestação); o valor não é comparável com cotações firmes.";

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "single",
    label: "Uma seguradora (base não confirmada)",
    build: () =>
      done(
        [
          estimated({
            insurerCode: "ALFA",
            insurerName: "Seguradora Alfa",
            premiumBasis: "UNKNOWN",
            pointEstimate: 345.12,
            priceRange: { min: 327.86, max: 379.63 },
            confidence: "LOW",
            comparablePolicies: 214,
            consideredFactors: [],
            reasons: [
              "Mediana histórica: 345,12 €",
              "Safety buffer aplicado: 10,00%",
            ],
            warnings: [
              UNCONFIRMED_WARNING,
              "Histórico de sinistros ainda não disponível; a estimativa não inclui ajuste específico de sinistralidade.",
              "Valor de mercado do veículo não disponível.",
            ],
          }),
        ],
        "uma seguradora com base do prémio por confirmar",
      ),
  },
  {
    id: "comparable",
    label: "Várias, mesma base",
    build: () =>
      done(
        [
          estimated({
            insurerCode: "BETA",
            insurerName: "Seguradora Beta",
            premiumBasis: "ANNUAL_TOTAL",
            pointEstimate: 389,
            priceRange: { min: 369.55, max: 430 },
            confidence: "LOW",
            comparablePolicies: 18,
            consideredFactors: ["Idade do condutor", "Região do código postal"],
            warnings: ["Poucos riscos comparáveis; intervalo aumentado."],
          }),
          estimated({
            insurerCode: "ALFA",
            insurerName: "Seguradora Alfa",
            premiumBasis: "ANNUAL_TOTAL",
            pointEstimate: 345,
            priceRange: { min: 328, max: 372 },
            confidence: "MEDIUM",
            comparablePolicies: 214,
            consideredFactors: ["Idade do condutor", "Código postal"],
          }),
          estimated({
            insurerCode: "GAMA",
            insurerName: "Seguradora Gama",
            premiumBasis: "ANNUAL_TOTAL",
            pointEstimate: 312,
            priceRange: { min: 300, max: 330 },
            confidence: "HIGH",
            comparablePolicies: 412,
          }),
        ],
        "três estimativas com a mesma base, ordenadas por valor",
      ),
  },
  {
    id: "firm-and-estimated",
    label: "Firme + estimativas",
    build: () =>
      done(
        [
          firm({
            insurerCode: "DELTA",
            insurerName: "Seguradora Delta",
            premiumBasis: "ANNUAL_TOTAL",
            premium: 402.5,
            commercialPremium: 371.4,
            totalPremium: 402.5,
            validUntil: "2026-10-31",
            externalReference: "SIM-000123",
          }),
          estimated({
            insurerCode: "ALFA",
            insurerName: "Seguradora Alfa",
            premiumBasis: "ANNUAL_TOTAL",
            pointEstimate: 345,
            priceRange: { min: 328, max: 372 },
            confidence: "MEDIUM",
            comparablePolicies: 214,
          }),
        ],
        "uma cotação firme e uma estimativa",
      ),
  },
  {
    id: "mixed-basis",
    label: "Bases diferentes",
    build: () =>
      done(
        [
          estimated({
            insurerCode: "ALFA",
            insurerName: "Seguradora Alfa",
            premiumBasis: "ANNUAL_TOTAL",
            pointEstimate: 345,
            priceRange: { min: 328, max: 372 },
            confidence: "MEDIUM",
            comparablePolicies: 214,
          }),
          estimated({
            insurerCode: "BETA",
            insurerName: "Seguradora Beta",
            premiumBasis: "ANNUAL_COMMERCIAL",
            pointEstimate: 301,
            priceRange: { min: 285, max: 330 },
            confidence: "MEDIUM",
            comparablePolicies: 160,
          }),
          estimated({
            insurerCode: "GAMA",
            insurerName: "Seguradora Gama",
            premiumBasis: "INSTALLMENT_TOTAL",
            pointEstimate: 31,
            priceRange: { min: 29, max: 34 },
            confidence: "LOW",
            comparablePolicies: 55,
          }),
          estimated({
            insurerCode: "OMEGA",
            insurerName: "Seguradora Ómega",
            premiumBasis: "UNKNOWN",
            pointEstimate: 330,
            priceRange: { min: 300, max: 380 },
            confidence: "LOW",
            comparablePolicies: 40,
            warnings: [UNCONFIRMED_WARNING],
          }),
        ],
        "quatro bases diferentes (anual total, anual comercial, mensal, desconhecida)",
        "MONTHLY",
      ),
  },
  {
    id: "partial",
    label: "Falhas parciais",
    build: () =>
      done(
        [
          estimated({
            insurerCode: "ALFA",
            insurerName: "Seguradora Alfa",
            premiumBasis: "ANNUAL_TOTAL",
            pointEstimate: 345,
            priceRange: { min: 328, max: 372 },
            confidence: "MEDIUM",
            comparablePolicies: 214,
          }),
          unavailable(
            "INSUFFICIENT_DATA",
            "BETA",
            "Seguradora Beta",
            ["Marca e modelo da viatura em falta."],
            ["vehicle.make", "vehicle.model"],
          ),
          unavailable("TIMEOUT", "GAMA", "Seguradora Gama", [
            "A companhia não respondeu em 15000 ms.",
          ]),
          unavailable("ERROR", "DELTA", "Seguradora Delta", [
            "Erro ao estimar: falha de ligação ao serviço de preços.",
          ]),
          unavailable("NOT_SUPPORTED", "OMEGA", "Seguradora Ómega", [
            "A companhia suporta o ramo AUTO mas ainda não tem modelo de pricing registado.",
          ]),
        ],
        "uma estimativa e quatro seguradoras sem valor",
      ),
  },
  {
    id: "no-data",
    label: "Sem dados suficientes",
    build: () =>
      done(
        [
          unavailable(
            "INSUFFICIENT_DATA",
            "ALFA",
            "Seguradora Alfa",
            ["Data da carta de condução em falta."],
            ["customer.drivingLicenceDate"],
          ),
          unavailable(
            "INSUFFICIENT_DATA",
            "BETA",
            "Seguradora Beta",
            ["Código postal em falta."],
            ["customer.postalCode"],
          ),
        ],
        "nenhuma seguradora conseguiu calcular",
      ),
  },
  {
    id: "none",
    label: "Sem seguradoras",
    build: () => done([], "ramo sem seguradoras configuradas"),
  },
  {
    id: "loading",
    label: "A calcular",
    build: () => ({ phase: "loading" }),
  },
  {
    id: "failed",
    label: "Erro geral",
    build: () => ({
      phase: "failed",
      message: "Não foi possível calcular a simulação. Tente novamente.",
    }),
  },
];
