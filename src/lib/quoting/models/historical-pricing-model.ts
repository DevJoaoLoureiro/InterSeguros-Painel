import type {
  ConfidenceLevel,
  EstimateCalibration,
  EstimateDiagnostics,
  EstimatedQuote,
  PremiumBasis,
  ProductLine,
  QuoteRequest,
} from "../domain/types";
import type {
  EligibilityResult,
  InsurerPricingModel,
} from "./insurer-pricing-model";
import { calculateSafetyBuffer } from "../confidence/safety-buffer";

export abstract class HistoricalPricingModel implements InsurerPricingModel {
  abstract readonly insurerCode: string;
  abstract readonly insurerName: string;
  abstract supports(productLine: ProductLine): boolean;
  abstract canEstimate(request: QuoteRequest): Promise<EligibilityResult>;
  protected abstract calculateHistoricalEstimate(request: QuoteRequest): Promise<{
    pointEstimate: number; comparablePolicies: number;
    /** Tamanho efetivo da amostra ponderada; opcional (default: comparablePolicies). */
    effectiveSampleSize?: number | null;
    positiveErrorP95?: number | null;
    medianAbsoluteError?: number | null; modelAgeDays?: number | null; reasons?: string[]; warnings?: string[];
    consideredFactors?: string[];
    /**
     * Intervalo e confiança já calibrados pelo próprio modelo (erro
     * histórico). Se vierem, substituem o safety-buffer genérico.
     */
    priceRange?: { min: number; max: number };
    confidence?: ConfidenceLevel;
    confidenceScore?: number;
    diagnostics?: EstimateDiagnostics;
    calibration?: EstimateCalibration;
    modelVersion: string;
  }>;

  /*
   * Base do prémio usado como histórico. UNKNOWN até cada modelo confirmar
   * o que o seu histórico representa (comercial/total, anual/prestação);
   * um modelo confirmado sobrepõe este valor.
   */
  protected readonly premiumBasis: PremiumBasis = "UNKNOWN";

  async estimate(request: QuoteRequest): Promise<EstimatedQuote> {
    const estimate = await this.calculateHistoricalEstimate(request);
    const calibrated = estimate.priceRange !== undefined && estimate.confidence !== undefined;
    const safety = calculateSafetyBuffer({
      pointEstimate: estimate.pointEstimate, comparablePolicies: estimate.comparablePolicies,
      effectiveSampleSize: estimate.effectiveSampleSize,
      positiveErrorP95: estimate.positiveErrorP95, medianAbsoluteError: estimate.medianAbsoluteError,
      modelAgeDays: estimate.modelAgeDays,
    });

    const warnings = [...(estimate.warnings ?? [])];

    if (this.premiumBasis === "UNKNOWN") {
      warnings.push(
        "Base do prémio histórico não confirmada (comercial/total, anual/prestação); o valor não é comparável com cotações firmes.",
      );
    }

    return {
      insurerCode: this.insurerCode, insurerName: this.insurerName, productLine: request.productLine,
      status: "ESTIMATED", source: "INTERNAL_MODEL", premiumBasis: this.premiumBasis,
      pointEstimate: Number(estimate.pointEstimate.toFixed(2)),
      priceRange: estimate.priceRange ?? safety.range,
      confidence: estimate.confidence ?? safety.confidence,
      confidenceScore: estimate.confidenceScore,
      diagnostics: estimate.diagnostics,
      calibration: estimate.calibration,
      comparablePolicies: estimate.comparablePolicies, modelVersion: estimate.modelVersion,
      consideredFactors: estimate.consideredFactors,
      warnings,
      reasons: [
        ...(estimate.reasons ?? []),
        // Só há buffer genérico quando o modelo não calibrou o seu próprio intervalo.
        ...(calibrated ? [] : [`Safety buffer aplicado: ${(safety.appliedBufferPct * 100).toFixed(2)}%`]),
      ],
      generatedAt: new Date().toISOString(),
    };
  }
}
