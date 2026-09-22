import type { EstimatedQuote, ProductLine, QuoteRequest } from "../domain/types";

export type EligibilityResult = {
  ok: boolean;

  /** Explicação legível de cada impedimento. */
  reasons: string[];

  /**
   * Campos de QuoteRequest em falta (ex.: "customer.birthDate").
   * Opcional: modelos que só devolvem `reasons` continuam válidos.
   */
  missingData?: string[];
};

export interface InsurerPricingModel {
  readonly insurerCode: string;
  readonly insurerName: string;

  /**
   * Orçamento de tempo próprio deste modelo, em ms (canEstimate + estimate).
   * Opcional: um modelo lento (ex.: API externa) declara-o aqui; sem valor,
   * o orquestrador usa o seu default.
   */
  readonly timeoutMs?: number;

  supports(productLine: ProductLine): boolean;
  canEstimate(request: QuoteRequest): Promise<EligibilityResult>;
  estimate(request: QuoteRequest): Promise<EstimatedQuote>;
}
