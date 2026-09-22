// =====================================================
// ZURICH - PREPARAÇÃO DO ENRIQUECIMENTO DE UMA APÓLICE
// =====================================================
//
// Decide, para UMA apólice, que dados de risco (objetos, coberturas,
// fracionamento cru) devem ser aplicados e de onde vêm, incluindo o
// FALLBACK por consulta individual à Zurich. Não fala com a Zurich nem
// com a BD diretamente: recebe as funções de consulta por injeção
// (deps), o que o torna testável sem rede.
//
// REGRAS
//
// 1. Fonte principal: os ficheiros diários (TipoFicheiro 4 e 5) já
//    lidos pelo sync. O fallback é a exceção.
//
// 2. Fallback (ObterObjetosPorNrApolice / ObterCoberturasPorApolice):
//    - SÓ para apólices Auto;
//    - SÓ para o recurso que faltou nos ficheiros diários;
//    - NÃO se os dados já guardados são recentes (marcador
//      `enrichment.<recurso>.fetchedAt` com menos de
//      FALLBACK_REFRESH_DAYS dias);
//    - com um teto de apólices por corrida (budget), para nunca
//      degenerar num N+1 massivo;
//    - em série (concorrência 1), com pausa entre pedidos;
//    - um erro numa consulta NUNCA falha a apólice: fica registado e
//      a apólice segue sem esses dados (nada é apagado).
//
// 3. Só há enriquecimento quando há dados VÁLIDOS: listas sem nenhum
//    campo preenchido contam como "sem dados". O resultado é `null`
//    se não houver nada para aplicar.
//
// 4. Objetos e coberturas só se aplicam a apólices Auto (ou que tragam
//    uma viatura nos ficheiros). O fracionamento cru aplica-se a todas.
// =====================================================

import {
  hasZurichCoverageContent,
  hasZurichObjectContent,
  isZurichVehicleObjectInput,
  readZurichEnrichmentMarkers,
  type ZurichCoverageInput,
  type ZurichEnrichmentInput,
  type ZurichEnrichmentMarker,
  type ZurichEnrichmentSource,
  type ZurichObjectInput,
} from "./risk-enrichment";

/** Teto de apólices com consulta individual por corrida. Ajustável. */
export const DEFAULT_FALLBACK_POLICY_LIMIT = 50;

/** Dados guardados com menos de N dias não voltam a ser consultados. */
export const FALLBACK_REFRESH_DAYS = 30;

/** Pausa após cada consulta individual (ms): no máx. ~4 pedidos/s. */
export const DEFAULT_FALLBACK_DELAY_MS = 250;

export type FallbackBudget = {
  /** Apólices que ainda podem fazer consulta individual nesta corrida. */
  remainingPolicies: number;

  policiesWithLookup: number;
  objectLookups: number;
  coverageLookups: number;

  skippedByLimit: number;
  skippedFresh: number;
  lookupErrors: number;
};

export function createFallbackBudget(
  limit: number = DEFAULT_FALLBACK_POLICY_LIMIT,
): FallbackBudget {
  return {
    remainingPolicies: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0,
    policiesWithLookup: 0,
    objectLookups: 0,
    coverageLookups: 0,
    skippedByLimit: 0,
    skippedFresh: 0,
    lookupErrors: 0,
  };
}

export type PolicyEnrichmentDeps = {
  lookupObjects: () => Promise<readonly ZurichObjectInput[]>;
  lookupCoverages: () => Promise<readonly ZurichCoverageInput[]>;

  /** provider_metadata já guardado (null se não existir/não se conseguir ler). */
  loadExistingMetadata: () => Promise<Record<string, unknown> | null>;

  sleep: (ms: number) => Promise<void>;
  now: () => Date;

  /**
   * Recebe o erro ORIGINAL (para quem regista o resumir só pela forma;
   * ver summarizeZurichError). Nunca imprimir a mensagem tal como vem.
   */
  warn: (message: string, details: { error: unknown }) => void;
};

export type PrepareZurichPolicyEnrichmentParams = {
  isAuto: boolean;

  fileObjects: readonly ZurichObjectInput[];
  fileCoverages: readonly ZurichCoverageInput[];

  paymentFrequency: {
    code: string | null | undefined;
    description: string | null | undefined;
  };

  /** Momento a registar nos marcadores (ISO). */
  fetchedAt: string;

  budget: FallbackBudget;
  fallbackDelayMs: number;
  deps: PolicyEnrichmentDeps;
};

export type PreparedPolicyEnrichment = {
  /** null = nada a aplicar. */
  input: ZurichEnrichmentInput | null;

  objectsSource: ZurichEnrichmentSource | null;
  coveragesSource: ZurichEnrichmentSource | null;
};

/** True se o marcador existe e é mais recente que FALLBACK_REFRESH_DAYS. */
export function isEnrichmentMarkerFresh(
  marker: ZurichEnrichmentMarker | undefined,
  now: Date,
): boolean {
  if (!marker) {
    return false;
  }

  const fetched = Date.parse(marker.fetchedAt);

  if (Number.isNaN(fetched)) {
    return false;
  }

  return now.getTime() - fetched < FALLBACK_REFRESH_DAYS * 86_400_000;
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

export async function prepareZurichPolicyEnrichment(
  params: PrepareZurichPolicyEnrichmentParams,
): Promise<PreparedPolicyEnrichment> {
  const { isAuto, budget, deps } = params;

  // Objetos/coberturas: só Auto, ou apólices que tragam uma viatura
  // nos próprios ficheiros (já lidos, sem custo extra).
  const validFileObjects = params.fileObjects.filter(hasZurichObjectContent);
  const validFileCoverages = params.fileCoverages.filter(hasZurichCoverageContent);

  const applyRisk = isAuto || validFileObjects.some(isZurichVehicleObjectInput);

  let objects: readonly ZurichObjectInput[] = applyRisk ? validFileObjects : [];
  let coverages: readonly ZurichCoverageInput[] = applyRisk ? validFileCoverages : [];

  let objectsSource: ZurichEnrichmentSource | null =
    objects.length > 0 ? "DAILY_FILE" : null;
  let coveragesSource: ZurichEnrichmentSource | null =
    coverages.length > 0 ? "DAILY_FILE" : null;

  // ---------- fallback (só Auto, só o que faltou) ----------

  if (isAuto && (objects.length === 0 || coverages.length === 0)) {
    if (budget.remainingPolicies <= 0) {
      budget.skippedByLimit += 1;
    } else {
      let existing: Record<string, unknown> | null = null;

      try {
        existing = await deps.loadExistingMetadata();
      } catch {
        existing = null;
      }

      const markers = readZurichEnrichmentMarkers(existing?.enrichment);
      const now = deps.now();

      const needObjects =
        objects.length === 0 && !isEnrichmentMarkerFresh(markers.objects, now);
      const needCoverages =
        coverages.length === 0 &&
        !isEnrichmentMarkerFresh(markers.coverages, now);

      if (!needObjects && !needCoverages) {
        budget.skippedFresh += 1;
      } else {
        budget.remainingPolicies -= 1;
        budget.policiesWithLookup += 1;

        if (needObjects) {
          try {
            const found = await deps.lookupObjects();
            budget.objectLookups += 1;

            const valid = found.filter(hasZurichObjectContent);

            if (valid.length > 0) {
              objects = valid;
              objectsSource = "POLICY_LOOKUP";
            }
          } catch (error) {
            budget.lookupErrors += 1;
            deps.warn("Falha na consulta individual de objetos", { error });
          }

          await deps.sleep(params.fallbackDelayMs);
        }

        if (needCoverages) {
          try {
            const found = await deps.lookupCoverages();
            budget.coverageLookups += 1;

            const valid = found.filter(hasZurichCoverageContent);

            if (valid.length > 0) {
              coverages = valid;
              coveragesSource = "POLICY_LOOKUP";
            }
          } catch (error) {
            budget.lookupErrors += 1;
            deps.warn("Falha na consulta individual de coberturas", { error });
          }

          await deps.sleep(params.fallbackDelayMs);
        }
      }
    }
  }

  // ---------- montar o input (só com dados válidos) ----------

  const hasFrequency =
    hasText(params.paymentFrequency.code) ||
    hasText(params.paymentFrequency.description);

  const input: ZurichEnrichmentInput = {
    objects:
      objects.length > 0 && objectsSource
        ? { source: objectsSource, fetchedAt: params.fetchedAt, items: objects }
        : null,
    coverages:
      coverages.length > 0 && coveragesSource
        ? {
            source: coveragesSource,
            fetchedAt: params.fetchedAt,
            items: coverages,
          }
        : null,
    paymentFrequency: hasFrequency ? params.paymentFrequency : null,
  };

  if (!input.objects && !input.coverages && !input.paymentFrequency) {
    return { input: null, objectsSource, coveragesSource };
  }

  return { input, objectsSource, coveragesSource };
}
