import { createAdminClient } from "@/lib/supabase/admin";
import type {
  ConfidenceLevel,
  PremiumBasis,
  ProductLine,
  QuoteRequest,
} from "../../domain/types";
import { HistoricalPricingModel } from "../historical-pricing-model";
import {
  assessEstimate,
  buildCalibration,
  runLeaveOneOut,
  type Calibration,
} from "./zurich-auto-confidence";
import { createSupabaseObservationStore } from "../../observations/supabase-store";
import { getZurichCalibration } from "./calibration/service";
import { applyCalibrationToEstimate } from "./calibration/zurich-quote-calibration";
import { ZURICH_AUTO_MODEL_VERSION } from "./model-version";
import { DEFAULT_ESTIMATOR_CONFIG } from "./zurich-auto-estimator";
import {
  buildConsideredFactors,
  describeAssessment,
  describeIgnoredRequestData,
} from "./zurich-auto-explain";
import {
  extractRequestFeatures,
  extractZurichHistoricalFeatures,
  isEligibleHistorical,
  requestFeaturesFromHistorical,
  type HistoricalPolicyInput,
  type ZurichHistoricalFeatures,
} from "./zurich-auto-features";
import type { TargetReceipt } from "./zurich-auto-target";

/*
 * Estimador HISTÓRICO de prémio Zurich Auto (não é uma cotação da Zurich: a
 * MyWebServices não tem endpoint de simulação).
 *
 * Fluxo:
 *   loadHistoricalInputs   apólices + clientes + recibos (poucas queries)
 *   extractZurichHistoricalFeatures   features e target de cada apólice
 *   assessEstimate         comparáveis em camadas -> ajuste -> estimativa
 *                          -> intervalo e confiança do erro histórico
 *   describeAssessment     razões, avisos e diagnóstico
 *
 * Toda a lógica está em módulos puros e testados (zurich-auto-*.ts); este
 * ficheiro só faz I/O e monta o resultado.
 */

const MODEL_VERSION = ZURICH_AUTO_MODEL_VERSION;

const PAGE_SIZE = 1000;
const MAX_POLICIES = 5000;

/** Nº de ids por consulta (evita URLs enormes e respostas truncadas). */
const ID_CHUNK = 100;

type AdminClient = ReturnType<typeof createAdminClient>;

type PolicyRow = {
  id: string;
  client_id: string | null;
  product_code: string | null;
  product_name: string | null;
  status: string | null;
  start_date: string | null;
  annualized_premium: number | string | null;
  total_premium: number | string | null;
  payment_frequency: string | null;
  provider_metadata: unknown;
  last_synced_at: string | null;
};

type ClientRow = {
  id: string;
  birth_date: string | null;
  postal_code: string | null;
};

type ReceiptRow = {
  policy_id: string;
  receipt_type: string | null;
  status: string | null;
  period_start: string | null;
  period_end: string | null;
  total_premium: number | string | null;
};

async function loadAutoPolicies(
  admin: AdminClient,
  companyId: string,
): Promise<{ rows: PolicyRow[]; truncated: boolean }> {
  const rows: PolicyRow[] = [];

  for (let from = 0; from < MAX_POLICIES; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("policies")
      .select(`
        id,
        client_id,
        product_code,
        product_name,
        status,
        start_date,
        annualized_premium,
        total_premium,
        payment_frequency,
        provider_metadata,
        last_synced_at
      `)
      .eq("company_id", companyId)
      .or("product_name.ilike.%auto%,product_code.in.(5324,5907,5910)")
      .not("annualized_premium", "is", null)
      .gt("annualized_premium", 0)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Erro ao carregar histórico Zurich Auto: ${error.message}`);
    }

    const page = (data ?? []) as PolicyRow[];

    rows.push(...page);

    if (page.length < PAGE_SIZE) {
      return { rows, truncated: false };
    }
  }

  return { rows, truncated: true };
}

async function loadClients(
  admin: AdminClient,
  clientIds: string[],
): Promise<Map<string, ClientRow>> {
  const clients = new Map<string, ClientRow>();

  for (let index = 0; index < clientIds.length; index += ID_CHUNK) {
    const { data, error } = await admin
      .from("clients")
      .select("id, birth_date, postal_code")
      .in("id", clientIds.slice(index, index + ID_CHUNK));

    if (error) {
      throw new Error(
        `Erro ao carregar clientes para o modelo Zurich Auto: ${error.message}`,
      );
    }

    for (const client of (data ?? []) as ClientRow[]) {
      clients.set(client.id, client);
    }
  }

  return clients;
}

/** Recibos das apólices, por blocos de ids (uma query por bloco e página). */
async function loadReceipts(
  admin: AdminClient,
  policyIds: string[],
): Promise<Map<string, TargetReceipt[]>> {
  const byPolicy = new Map<string, TargetReceipt[]>();

  for (let index = 0; index < policyIds.length; index += ID_CHUNK) {
    const chunk = policyIds.slice(index, index + ID_CHUNK);

    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await admin
        .from("receipts")
        .select("policy_id, receipt_type, status, period_start, period_end, total_premium")
        .in("policy_id", chunk)
        .order("id")
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        throw new Error(
          `Erro ao carregar recibos para o modelo Zurich Auto: ${error.message}`,
        );
      }

      const page = (data ?? []) as ReceiptRow[];

      for (const row of page) {
        const total =
          typeof row.total_premium === "number"
            ? row.total_premium
            : row.total_premium === null
              ? null
              : Number(row.total_premium);

        const list = byPolicy.get(row.policy_id) ?? [];

        list.push({
          type: row.receipt_type,
          status: row.status,
          periodStart: row.period_start,
          periodEnd: row.period_end,
          totalPremium: total !== null && Number.isFinite(total) ? total : null,
        });
        byPolicy.set(row.policy_id, list);
      }

      if (page.length < PAGE_SIZE) break;
    }
  }

  return byPolicy;
}

async function loadHistoricalInputs(
  admin: AdminClient,
  companyId: string,
): Promise<{ inputs: HistoricalPolicyInput[]; truncated: boolean }> {
  const { rows, truncated } = await loadAutoPolicies(admin, companyId);

  const clientIds = Array.from(
    new Set(
      rows
        .map((row) => row.client_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );

  const [clients, receipts] = await Promise.all([
    loadClients(admin, clientIds),
    loadReceipts(admin, rows.map((row) => row.id)),
  ]);

  const inputs = rows.map((row): HistoricalPolicyInput => {
    const client = row.client_id ? clients.get(row.client_id) : undefined;

    return {
      id: row.id,
      groupKey: row.client_id,
      productCode: row.product_code,
      productName: row.product_name,
      status: row.status,
      startDate: row.start_date,
      annualizedPremium: row.annualized_premium,
      totalPremium: row.total_premium,
      paymentFrequency: row.payment_frequency,
      lastSyncedAt: row.last_synced_at,
      providerMetadata: row.provider_metadata,
      holderBirthDate: client?.birth_date ?? null,
      holderPostalCode: client?.postal_code ?? null,
      receipts: receipts.get(row.id) ?? [],
    };
  });

  return { inputs, truncated };
}

// ---------- erro histórico em cache ----------

/*
 * O erro histórico (leave-one-client-out sobre toda a carteira) só muda
 * quando a carteira muda; calcula-se uma vez por "impressão digital" dos
 * dados e reutiliza-se durante alguns minutos.
 */
const CALIBRATION_TTL_MS = 10 * 60 * 1000;

let calibrationCache: { key: string; at: number; calibration: Calibration } | null =
  null;

function calibrationKey(pool: readonly ZurichHistoricalFeatures[]): string {
  const premiums = pool.reduce((sum, p) => sum + (p.targetPremium ?? 0), 0);
  const newest = pool.reduce((max, p) => {
    const time = p.lastSyncedAt ? Date.parse(p.lastSyncedAt) : 0;

    return Number.isNaN(time) ? max : Math.max(max, time);
  }, 0);

  return `${MODEL_VERSION}|${pool.length}|${premiums.toFixed(2)}|${newest}`;
}

function getCalibration(pool: readonly ZurichHistoricalFeatures[]): Calibration {
  const key = calibrationKey(pool);

  if (
    calibrationCache &&
    calibrationCache.key === key &&
    Date.now() - calibrationCache.at < CALIBRATION_TTL_MS
  ) {
    return calibrationCache.calibration;
  }

  const calibration = buildCalibration(
    runLeaveOneOut(pool, DEFAULT_ESTIMATOR_CONFIG, requestFeaturesFromHistorical),
  );

  calibrationCache = { key, at: Date.now(), calibration };

  return calibration;
}

const CONFIDENCE_ORDER: ConfidenceLevel[] = ["LOW", "MEDIUM", "HIGH"];

function lowestConfidence(a: ConfidenceLevel, b: ConfidenceLevel): ConfidenceLevel {
  return CONFIDENCE_ORDER[Math.min(CONFIDENCE_ORDER.indexOf(a), CONFIDENCE_ORDER.indexOf(b))];
}

export class ZurichAutoPricingModel extends HistoricalPricingModel {
  readonly insurerCode = "ZURICH";
  readonly insurerName = "Zurich";

  /*
   * O histórico é o prémio anual TOTAL (PremioApolice): confirmado com os
   * recibos (ver zurich-auto-target.ts), independente do fracionamento.
   */
  protected readonly premiumBasis: PremiumBasis = "ANNUAL_TOTAL";

  supports(productLine: ProductLine): boolean {
    return productLine === "AUTO";
  }

  async canEstimate(
    request: QuoteRequest,
  ): Promise<{
    ok: boolean;
    reasons: string[];
  }> {
    const reasons: string[] = [];

    if (request.productLine !== "AUTO") {
      reasons.push("O modelo Zurich Auto apenas suporta AUTO.");
    }

    if (!request.customer.birthDate) {
      reasons.push("Data de nascimento em falta.");
    }

    if (!request.customer.postalCode) {
      reasons.push("Código postal em falta.");
    }

    if (!request.customer.drivingLicenceDate) {
      reasons.push("Data da carta de condução em falta.");
    }

    if (!request.vehicle?.registration) {
      reasons.push("Matrícula em falta.");
    }

    return {
      ok: reasons.length === 0,
      reasons,
    };
  }

  protected async calculateHistoricalEstimate(request: QuoteRequest) {
    const admin = createAdminClient();

    const { data: zurichCompany, error: companyError } = await admin
      .from("companies")
      .select("id")
      .eq("code", "ZURICH")
      .maybeSingle();

    if (companyError) {
      throw new Error(`Erro ao procurar companhia Zurich: ${companyError.message}`);
    }

    if (!zurichCompany) {
      throw new Error("Companhia Zurich não encontrada na tabela companies.");
    }

    const { inputs, truncated } = await loadHistoricalInputs(
      admin,
      zurichCompany.id,
    );

    const now = new Date();
    const features = inputs.map((input) => extractZurichHistoricalFeatures(input, now));
    const pool = features.filter(isEligibleHistorical);

    if (pool.length === 0) {
      throw new Error(
        "Não existem apólices Zurich Auto suficientes para calcular uma estimativa.",
      );
    }

    const config = DEFAULT_ESTIMATOR_CONFIG;
    const target = extractRequestFeatures(request, now);

    const assessment = assessEstimate(
      target,
      pool,
      config,
      getCalibration(pool),
      now,
    );

    if (!assessment) {
      throw new Error(
        "Não foi possível calcular uma estimativa com o histórico Zurich Auto disponível.",
      );
    }

    const explanation = describeAssessment(target, assessment);

    const inconsistent = features.filter(
      (f) => f.target.confidence === "INCONSISTENT",
    ).length;
    const multiVehicle = features.filter((f) => f.vehicleCount >= 2).length;

    if (inconsistent + multiVehicle > 0) {
      explanation.reasons.push(
        `Excluídas do histórico: ${inconsistent} apólices com prémio não confirmado pelos recibos e ${multiVehicle} com várias viaturas.`,
      );
    }

    const warnings = [
      ...explanation.warnings,
      ...describeIgnoredRequestData(request),
    ];

    // Calibração com cotações reais Zurich, SEPARADA da estimativa base. Em
    // modo EXPERIMENTAL (o atual) só se mostra ao lado: o pointEstimate abaixo
    // é a estimativa histórica, sem alterações. `model_version` é sempre a do
    // modelo base; a versão da calibração vai em calibration.version. Nunca lança.
    const calibration = await getZurichCalibration({
      request,
      baseEstimate: assessment.pointEstimate,
      baseRange: {
        min: Number(assessment.interval.min.toFixed(2)),
        max: Number(assessment.interval.max.toFixed(2)),
      },
      modelVersion: MODEL_VERSION,
      store: createSupabaseObservationStore(admin),
      now,
    });

    const finalEstimate = applyCalibrationToEstimate(
      {
        pointEstimate: assessment.pointEstimate,
        priceRange: {
          min: Number(assessment.interval.min.toFixed(2)),
          max: Number(assessment.interval.max.toFixed(2)),
        },
      },
      calibration,
    );

    // Com a calibração aplicada, o valor principal depende de cotações reais:
    // a confiança nunca é superior à da própria calibração.
    let confidence = assessment.confidence.level;
    const consideredFactors = buildConsideredFactors(target, assessment, config);

    if (finalEstimate.applied) {
      confidence = lowestConfidence(confidence, calibration.confidence);
      consideredFactors.push("Cotações reais Zurich");

      explanation.reasons.unshift(
        `Estimativa calibrada com ${calibration.sampleSize} ${calibration.sampleSize === 1 ? "cotação real" : "cotações reais"} da Zurich: ${finalEstimate.pointEstimate.toFixed(2)} € (a estimativa histórica base era ${assessment.pointEstimate.toFixed(2)} €).`,
      );

      if (calibration.productionSampleSize < (calibration.diagnostics.requiredForProduction ?? 0)) {
        warnings.push(
          `Calibração com amostra pequena (${calibration.sampleSize} cotações reais): o valor pode mudar com mais cotações.`,
        );
      }
    }

    if (truncated) {
      warnings.push(
        `O histórico foi limitado às primeiras ${MAX_POLICIES} apólices Zurich Auto.`,
      );
    }

    return {
      pointEstimate: finalEstimate.pointEstimate,
      comparablePolicies: assessment.selection.comparables.length,
      effectiveSampleSize: assessment.estimate.effectiveSampleSize,

      // O intervalo e a confiança vêm do erro histórico do modelo; o
      // safety-buffer genérico não é usado.
      priceRange: finalEstimate.priceRange,
      confidence,
      confidenceScore: assessment.confidence.score,

      modelAgeDays: assessment.dataAgeDays,

      reasons: explanation.reasons,
      warnings,
      consideredFactors,
      diagnostics: explanation.diagnostics,
      calibration,

      modelVersion: MODEL_VERSION,
    };
  }
}

export const zurichAutoPricingModel = new ZurichAutoPricingModel();
