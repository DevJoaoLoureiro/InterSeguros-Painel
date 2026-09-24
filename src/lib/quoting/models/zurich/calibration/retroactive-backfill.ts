import type { QuoteRequest } from "../../../domain/types";
import {
  RETROACTIVE_SOURCE,
  buildObservationInsert,
} from "../../../observations/snapshots";
import type { ZurichQuoteObservationInsert } from "../../../observations/types";
import { calculateSafetyBuffer } from "../../../confidence/safety-buffer";
import {
  DEFAULT_ESTIMATOR_CONFIG,
  estimatePremium,
  type EstimatorConfig,
} from "../zurich-auto-estimator";
import {
  extractZurichHistoricalFeatures,
  isEligibleHistorical,
  requestFeaturesFromHistorical,
  type HistoricalPolicyInput,
  type ZurichHistoricalFeatures,
} from "../zurich-auto-features";

/*
 * BACKFILL RETROATIVO de ground truth, a partir de apólices Zurich Auto JÁ
 * EMITIDAS — sem tabela nova, sem simulação real de ninguém.
 *
 * Para cada apólice elegível, recalcula-se "o que o modelo atual estimaria
 * para este risco" com LEAVE-ONE-CLIENT-OUT: a própria apólice e as outras do
 * mesmo cliente são retiradas do histórico antes de estimar, exatamente como
 * no backtest (zurich-auto-confidence.ts). Sem isto, o modelo estaria a
 * comparar-se com dados que já usou para se calcular a si próprio — um
 * resultado bom sem significar nada.
 *
 * DIFERENÇA FACE A UMA COTAÇÃO REAL (MANUAL_ENTRY):
 *
 *   Estas linhas respondem a "o modelo acerta na carteira que já tem?" — é,
 *   em essência, o mesmo backtest, só que guardado observação a observação.
 *   Uma cotação real manual responde a "o modelo acerta contra o que a
 *   Zurich cobra HOJE, num pedido que nunca viu?" — pergunta diferente, e é
 *   essa que a calibração do valor principal existe para responder.
 *
 *   Por isso cada linha fica marcada com source = RETROACTIVE_PORTFOLIO
 *   (dentro de insurer_quote_snapshot) e:
 *     - NUNCA entra na calibração do valor principal (zurich-quote-
 *       calibration.ts exclui-as explicitamente em classify());
 *     - NUNCA se apresenta como "cotação real do portal" (real-quote-
 *       match.ts exclui-as de attachZurichRealQuote);
 *     - conta à parte nas métricas (metrics.ts agrupa por origem).
 *
 * SÓ apólices com o prémio anual CONFIRMADO por recibos (não "provável")
 * viram ground truth: para as restantes não há certeza suficiente do que a
 * Zurich realmente cobrou.
 */

export type RetroactiveBuildResult = {
  rows: ZurichQuoteObservationInsert[];

  /** Apólices Auto elegíveis (mesmo critério do modelo ao vivo). */
  eligiblePolicies: number;

  /** Das elegíveis, com prémio CONFIRMADO por recibos (candidatas a ground truth). */
  confirmedPolicies: number;

  /** Sem comparáveis suficientes depois de excluir o próprio cliente. */
  skippedInsufficientComparables: number;

  /** A validação/normalização (buildObservationInsert) rejeitou a linha. */
  skippedInvalid: number;
};

/*
 * Reconstrução APROXIMADA de requestedCoverages a partir do tier. O tier
 * (coverage_tier, guardado à parte e com origem fiável) é que decide a
 * calibração; isto só preenche o snapshot do pedido. RC_PLUS não distingue
 * furto de incêndio nos dados reais, por isso assume-se os dois — uma
 * sobre-especificação inofensiva, já que nada volta a ler estes booleans
 * para decidir a que tier a linha pertence.
 */
function requestedCoveragesFromTier(
  policy: ZurichHistoricalFeatures,
): QuoteRequest["requestedCoverages"] {
  const ownDamage = policy.coverageTier === "OWN_DAMAGE";
  const rcPlus = policy.coverageTier === "RC_PLUS";

  return {
    liability: true,
    ownDamage,
    collision: ownDamage,
    fire: rcPlus,
    theft: rcPlus,
    glass: policy.coverageProfile.hasGlass === true,
    assistance: false,
    legalProtection: false,
    deductible: ownDamage ? policy.coverageProfile.ownDamageDeductible : null,
  };
}

const KNOWN_FREQUENCIES = ["ANNUAL", "SEMIANNUAL", "QUARTERLY", "MONTHLY"] as const;

function paymentFrequencyOf(raw: string | null): QuoteRequest["paymentFrequency"] {
  return (KNOWN_FREQUENCIES as readonly string[]).includes(raw ?? "")
    ? (raw as QuoteRequest["paymentFrequency"])
    : "OTHER";
}

/** O pedido "como se fosse simulado" na data de início da apólice. */
function buildRetroactiveRequest(
  input: HistoricalPolicyInput,
  features: ZurichHistoricalFeatures,
): QuoteRequest {
  return {
    requestId: `retroactive-${input.id}`,
    clientId: input.groupKey,
    productLine: "AUTO",
    requestedAt: input.startDate ?? new Date().toISOString(),
    customer: {
      birthDate: input.holderBirthDate,
      postalCode: input.holderPostalCode,
      // Nunca existiu nos dados históricos: nunca se inventa.
      drivingLicenceDate: null,
      // Desconhecido para apólices antigas; "OTHER" não afirma "particular".
      usage: "OTHER",
    },
    vehicle: {
      // Não se volta a fazer parsing da matrícula aqui: estas linhas nunca
      // são candidatas a "cotação real do mesmo pedido" (ver real-quote-
      // match.ts), por isso a matrícula não tem utilidade que compense o
      // risco de duplicar essa lógica.
      registration: null,
      make: null,
      model: null,
      version: null,
      firstRegistrationDate: null,
      fuelType: null,
      engineCc: null,
      powerKw: null,
      marketValue:
        features.coverageTier === "OWN_DAMAGE" ? features.vehicleCapital : null,
      annualKm: null,
    },
    claims: null,
    requestedCoverages: requestedCoveragesFromTier(features),
    paymentFrequency: paymentFrequencyOf(input.paymentFrequency),
    metadata: { origin: "retroactive-backfill", policyId: input.id },
  };
}

/**
 * Constrói as linhas de observação retroativas. PURA: não toca na BD. O
 * chamador decide quais já existem (por `policy_id`) e quais escrever.
 */
export function buildRetroactiveObservations(
  inputs: readonly HistoricalPolicyInput[],
  modelVersion: string,
  now: Date = new Date(),
  config: EstimatorConfig = DEFAULT_ESTIMATOR_CONFIG,
): RetroactiveBuildResult {
  const allFeatures = inputs.map((input) => ({
    input,
    features: extractZurichHistoricalFeatures(input, now),
  }));

  // O pool de comparáveis é o MESMO que o modelo ao vivo usa (não restrito a
  // "confirmado"); só os ALVOS do backfill exigem prémio confirmado.
  const pool = allFeatures
    .map((item) => item.features)
    .filter(isEligibleHistorical);

  const targets = allFeatures.filter(
    (item) =>
      isEligibleHistorical(item.features) &&
      item.features.target.confidence === "CONFIRMED",
  );

  const rows: ZurichQuoteObservationInsert[] = [];
  let skippedInsufficientComparables = 0;
  let skippedInvalid = 0;

  for (const { input, features } of targets) {
    const group = features.groupKey;
    const others = pool.filter(
      (candidate) =>
        candidate !== features &&
        (group === null || candidate.groupKey !== group),
    );

    const result = estimatePremium(
      requestFeaturesFromHistorical(features),
      others,
      config,
    );

    if (!result) {
      skippedInsufficientComparables += 1;
      continue;
    }

    const safety = calculateSafetyBuffer({
      pointEstimate: result.estimate.pointEstimate,
      comparablePolicies: result.selection.comparables.length,
      effectiveSampleSize: result.estimate.effectiveSampleSize,
      medianAbsoluteError: result.estimate.dispersion,
    });

    const request = buildRetroactiveRequest(input, features);

    const built = buildObservationInsert({
      clientId: input.groupKey,
      policyId: input.id,
      request,
      prediction: {
        insurerCode: "ZURICH",
        insurerName: "Zurich",
        productLine: "AUTO",
        reasons: [
          "Estimativa retroativa (leave-one-out): recalculada com o modelo atual, excluindo esta apólice e as restantes do mesmo cliente.",
        ],
        warnings: [
          "Não é uma simulação real: valor recalculado para preencher histórico. Nunca é apresentado como cotação real do portal Zurich.",
        ],
        generatedAt: now.toISOString(),
        status: "ESTIMATED",
        source: "INTERNAL_MODEL",
        premiumBasis: "ANNUAL_TOTAL",
        pointEstimate: result.estimate.pointEstimate,
        priceRange: safety.range,
        confidence: safety.confidence,
        comparablePolicies: result.selection.comparables.length,
        modelVersion,
      },
      realQuote: {
        amount: features.targetPremium as number,
        basis: "ANNUAL",
        productCode: input.productCode,
        productName: input.productName,
        reference: null,
      },
      status: "VALID",
      notes:
        "Recalculado retroativamente (leave-one-out) a partir da apólice emitida; não é uma cotação vista por um agente.",
      quotedAt: input.startDate ?? now.toISOString(),
      source: RETROACTIVE_SOURCE,
    });

    if (built.ok) {
      rows.push(built.row);
    } else {
      skippedInvalid += 1;
    }
  }

  return {
    rows,
    eligiblePolicies: pool.length,
    confirmedPolicies: targets.length,
    skippedInsufficientComparables,
    skippedInvalid,
  };
}
