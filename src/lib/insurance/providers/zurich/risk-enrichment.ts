// =====================================================
// ZURICH - ENRIQUECIMENTO DE RISCO (objetos + coberturas)
// =====================================================
//
// Módulo PURO: transforma objetos de risco e coberturas da Zurich
// em chaves normalizadas para `policies.provider_metadata`.
//
// - Sem I/O: não fala com a Zurich, com a BD nem com o relógio
//   (`fetchedAt` entra de fora). Mesmo input -> mesmo output.
// - Só importa utilitários puros do mesmo diretório (nunca client.ts,
//   para não arrastar o service role do Supabase para quem só quer
//   normalizar dados).
// - É consumido por policy-enrichment.ts / sync.ts (que decidem QUANDO
//   enriquecer) e pelas rotas dev; aqui só se define O QUÊ e COMO.
//
// PRINCÍPIOS
//
// 1. null != 0. Vazio/ilegível -> null; "0" -> 0. Nunca se
//    converte "não sabemos" em zero.
//
// 2. Sem significado inventado. `Franquia` é guardada tal como veio
//    (string ou número), sem interpretar; não sabemos se é
//    percentagem, indicador ou tipo.
//
// 3. O resultado é um PATCH para juntar (spread) ao metadata
//    existente, e só contém chaves para as quais o input trouxe
//    informação. O upsertPolicy faz merge superficial: uma chave
//    presente substitui a antiga por inteiro, uma chave ausente
//    preserva-a. Por isso:
//      - objetos/coberturas NÃO pedidos -> chaves ausentes (nada
//        é apagado);
//      - objetos/coberturas pedidos e vazios -> `[]` mais marcador
//        (afirmação definitiva de "não há"), diferente de ausente
//        ("nunca pedimos");
//      - escalares em branco (matrícula, fracionamento) -> ausentes,
//        nunca `null`, para não apagar um valor bom com um vazio.
//
// COMPATIBILIDADE COM O QUE JÁ EXISTE
//
// `vehicleRegistration` e `insuredObject.{number,type,description,
// status}` mantêm nome, posição e formato (matrícula XX-XX-XX em
// maiúsculas, extraída de DescricaoObjeto, como em sync.ts). Só se
// ACRESCENTAM chaves. Diferença única: campos em branco passam a
// `null` (antes ficava "") e os textos são aparados (trim).
// =====================================================

import { normalizeCoverageDescription } from "./coverage-description";

export const ZURICH_ENRICHMENT_SCHEMA_VERSION = 1 as const;

// -----------------------------------------------------
// INPUT (formas cruas, como a Zurich as devolve)
// -----------------------------------------------------

/**
 * Valor cru: os ficheiros diários trazem strings; a API individual
 * (ObterObjetosPorNrApolice / ObterCoberturasPorApolice) traz números.
 * Aceitar ambos evita converter para string só para voltar a parsear.
 */
export type ZurichRawValue = string | number | null | undefined;

/** Compatível com ZurichObjetoFicheiro (ficheiro) e ZurichObjeto (API). */
export type ZurichObjectInput = {
  NumeroObjeto?: ZurichRawValue;
  DescricaoObjeto?: ZurichRawValue;
  TipoObjeto?: ZurichRawValue;
  Capital?: ZurichRawValue;
  EstadoCod?: ZurichRawValue;
  Estado?: ZurichRawValue;
  Premio?: ZurichRawValue;
};

/** Compatível com ZurichCoberturaFicheiro (ficheiro) e ZurichCobertura (API). */
export type ZurichCoverageInput = {
  NumeroObjeto?: ZurichRawValue;
  DescricaoCobertura?: ZurichRawValue;
  Capital?: ZurichRawValue;
  Franquia?: ZurichRawValue;
  ValorFranquia?: ZurichRawValue;
  ValorMaxFranquia?: ZurichRawValue;
  NumDiasFranquia?: ZurichRawValue;
};

/** FraccionamentoCod / Fraccionamento da apólice. */
export type ZurichPaymentFrequencyInput = {
  code?: ZurichRawValue;
  description?: ZurichRawValue;
};

// -----------------------------------------------------
// OUTPUT (metadata novo)
// -----------------------------------------------------

export type ZurichEnrichmentSource = "DAILY_FILE" | "POLICY_LOOKUP";

/**
 * Objeto segurado normalizado. As 4 primeiras chaves são as que o
 * sync já grava hoje em `insuredObject`; as 3 últimas são novas.
 */
export type ZurichInsuredObjectMetadata = {
  number: string | null;
  type: string | null;
  description: string | null;
  status: string | null;

  statusCode: string | null;
  capital: number | null;
  premium: number | null;
};

/** Valor de `Franquia` tal como recebido, sem interpretação. */
export type ZurichDeductibleRaw = string | number | null;

export type ZurichCoverageMetadata = {
  /** Liga a cobertura ao objeto (NumeroObjeto). */
  objectNumber: string | null;
  description: string | null;
  capital: number | null;

  /** `Franquia` bruta: significado desconhecido, não normalizar. */
  deductible: ZurichDeductibleRaw;
  deductibleValue: number | null;
  maxDeductibleValue: number | null;
  deductibleDays: number | null;
};

export type ZurichPaymentFrequencyRaw = {
  code: string | null;
  description: string | null;
};

/** Quando e de onde vieram os objetos/coberturas guardados. */
export type ZurichEnrichmentMarker = {
  source: ZurichEnrichmentSource;
  fetchedAt: string;
};

export type ZurichEnrichmentMarkers = {
  schemaVersion: typeof ZURICH_ENRICHMENT_SCHEMA_VERSION;
  objects?: ZurichEnrichmentMarker;
  coverages?: ZurichEnrichmentMarker;
};

/**
 * Forma das chaves de risco em `provider_metadata` (todas opcionais:
 * apólices ainda não enriquecidas não têm nenhuma).
 *
 * O builder nunca emite `vehicleRegistration` nem `paymentFrequencyRaw`
 * a `null` (ver princípio 3): `null` só existe no tipo para quem LÊ.
 */
export type ZurichEnrichmentMetadata = {
  vehicleRegistration?: string | null;

  /** Viatura principal/selecionada (compatibilidade com o código atual). */
  insuredObject?: ZurichInsuredObjectMetadata;

  /** TODOS os objetos, pela ordem recebida (inclui não-viaturas). */
  insuredObjects?: ZurichInsuredObjectMetadata[];

  coverages?: ZurichCoverageMetadata[];

  paymentFrequencyRaw?: ZurichPaymentFrequencyRaw | null;

  enrichment?: ZurichEnrichmentMarkers;
};

// -----------------------------------------------------
// PRIMITIVAS DE NORMALIZAÇÃO
// -----------------------------------------------------

function isBlank(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  );
}

/** Texto aparado; vazio, indefinido ou tipo inesperado -> null. */
function toNullableString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

/** Escalar neutro: string aparada ou número, sem converter entre eles. */
function toRawScalar(value: unknown): string | number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  return toNullableString(value);
}

/**
 * Número ou null. NUNCA devolve 0 para vazio/ilegível.
 *
 * Aceita: número finito; "410,92" (vírgula decimal, como nos
 * ficheiros Zurich); "1.234,56" (ponto de milhar + vírgula decimal);
 * "410.92" e "18000" (ponto decimal, como o JSON da API).
 * Um texto só com pontos ("1.234") lê-se como decimal, tal como o
 * parseZurichFileDecimal existente; qualquer outra coisa -> null.
 */
function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed === "") {
    return null;
  }

  let normalized: string;

  if (/^[+-]?\d{1,3}(\.\d{3})+,\d+$/.test(trimmed)) {
    normalized = trimmed.replace(/\./g, "").replace(",", ".");
  } else if (/^[+-]?\d+,\d+$/.test(trimmed)) {
    normalized = trimmed.replace(",", ".");
  } else if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    normalized = trimmed;
  } else {
    return null;
  }

  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

/** 1 se o cru tinha conteúdo mas não deu número (para diagnóstico). */
function unparsed(raw: unknown, parsed: number | null): number {
  return !isBlank(raw) && parsed === null ? 1 : 0;
}

// -----------------------------------------------------
// OBJETOS E COBERTURAS
// -----------------------------------------------------

export function normalizeZurichObject(
  raw: ZurichObjectInput,
): ZurichInsuredObjectMetadata {
  return {
    number: toNullableString(raw.NumeroObjeto),
    type: toNullableString(raw.TipoObjeto),
    description: toNullableString(raw.DescricaoObjeto),
    status: toNullableString(raw.Estado),

    statusCode: toNullableString(raw.EstadoCod),
    capital: toNullableNumber(raw.Capital),
    premium: toNullableNumber(raw.Premio),
  };
}

export function normalizeZurichCoverage(
  raw: ZurichCoverageInput,
): ZurichCoverageMetadata {
  return {
    objectNumber: toNullableString(raw.NumeroObjeto),
    description: toNullableString(raw.DescricaoCobertura),
    capital: toNullableNumber(raw.Capital),

    deductible: toRawScalar(raw.Franquia),
    deductibleValue: toNullableNumber(raw.ValorFranquia),
    maxDeductibleValue: toNullableNumber(raw.ValorMaxFranquia),
    deductibleDays: toNullableNumber(raw.NumDiasFranquia),
  };
}

// -----------------------------------------------------
// MATRÍCULA
// -----------------------------------------------------

/**
 * Mesma regra e mesmo formato que sync.ts (extractVehicleRegistration):
 * primeira ocorrência de XX-XX-XX (letras/dígitos) em DescricaoObjeto,
 * em maiúsculas.
 *   "AC-87-GG Renault -"          -> "AC-87-GG"
 *   "21-AH-98 Renault Megane 1.5" -> "21-AH-98"
 */
export function extractZurichVehicleRegistration(
  description: string | null | undefined,
): string | null {
  if (!description) {
    return null;
  }

  const match = description
    .trim()
    .toUpperCase()
    .match(/\b[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]{2}\b/);

  return match?.[0] ?? null;
}

// -----------------------------------------------------
// SELEÇÃO DA VIATURA PRINCIPAL
// -----------------------------------------------------
//
// O QUE SE SABE: uma viatura é um objeto cujo TipoObjeto contém
// "viatura" (mesma regra do sync atual, sync.ts findVehicleObject).
//
// O QUE NÃO SE SABE (e por isso não se assume):
// - o significado de EstadoCod/Estado (que valores são "ativo");
// - se, após substituição de viatura, a Zurich lista a antiga e a
//   nova, nem por que ordem;
// - se apólices com várias viaturas (frotas) têm uma "principal".
//
// Logo, com UMA viatura a escolha é segura; com VÁRIAS não há forma
// segura de escolher pela semântica atual. Por omissão o módulo
// recusa escolher ("SKIP"): é preferível não preencher a matrícula
// a preencher a de outra viatura. Quem precisar de reproduzir o
// comportamento atual do sync (a primeira da lista) pede-o
// explicitamente com "FIRST_LISTED", e o resultado fica marcado
// como "FIRST_OF_MULTIPLE" para se poder auditar depois.

export type ZurichMultipleVehiclesPolicy = "SKIP" | "FIRST_LISTED";

export type ZurichVehicleSelection =
  | {
      status: "SELECTED";
      reason: "SINGLE_VEHICLE" | "FIRST_OF_MULTIPLE";
      vehicle: ZurichInsuredObjectMetadata;
      candidateCount: number;
    }
  | {
      status: "AMBIGUOUS";
      reason: "MULTIPLE_VEHICLES";
      vehicle: null;
      candidateCount: number;
    }
  | {
      status: "NONE";
      reason: "NO_VEHICLE";
      vehicle: null;
      candidateCount: 0;
    };

export function isZurichVehicleObject(
  object: Pick<ZurichInsuredObjectMetadata, "type">,
): boolean {
  return object.type?.toLowerCase().includes("viatura") ?? false;
}

export function selectPrimaryVehicle(
  objects: readonly ZurichInsuredObjectMetadata[],
  options: { onMultipleVehicles?: ZurichMultipleVehiclesPolicy } = {},
): ZurichVehicleSelection {
  const candidates = objects.filter(isZurichVehicleObject);

  if (candidates.length === 0) {
    return {
      status: "NONE",
      reason: "NO_VEHICLE",
      vehicle: null,
      candidateCount: 0,
    };
  }

  if (candidates.length === 1) {
    return {
      status: "SELECTED",
      reason: "SINGLE_VEHICLE",
      vehicle: candidates[0],
      candidateCount: 1,
    };
  }

  if (options.onMultipleVehicles === "FIRST_LISTED") {
    return {
      status: "SELECTED",
      reason: "FIRST_OF_MULTIPLE",
      vehicle: candidates[0],
      candidateCount: candidates.length,
    };
  }

  return {
    status: "AMBIGUOUS",
    reason: "MULTIPLE_VEHICLES",
    vehicle: null,
    candidateCount: candidates.length,
  };
}

// -----------------------------------------------------
// MARCADORES DE ENRIQUECIMENTO
// -----------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readMarker(value: unknown): ZurichEnrichmentMarker | null {
  if (!isRecord(value)) {
    return null;
  }

  const { source, fetchedAt } = value;

  if (
    (source !== "DAILY_FILE" && source !== "POLICY_LOOKUP") ||
    typeof fetchedAt !== "string" ||
    fetchedAt === ""
  ) {
    return null;
  }

  return { source, fetchedAt };
}

/**
 * Lê `provider_metadata.enrichment` já gravado. Necessário porque o
 * merge do upsertPolicy é superficial: se uma corrida só trouxer
 * objetos, gravar `enrichment` sem o marcador das coberturas apagaria
 * o marcador anterior. Versão desconhecida ou forma inválida -> ignora.
 */
export function readZurichEnrichmentMarkers(value: unknown): {
  objects?: ZurichEnrichmentMarker;
  coverages?: ZurichEnrichmentMarker;
} {
  if (
    !isRecord(value) ||
    value.schemaVersion !== ZURICH_ENRICHMENT_SCHEMA_VERSION
  ) {
    return {};
  }

  const objects = readMarker(value.objects);
  const coverages = readMarker(value.coverages);

  return {
    ...(objects ? { objects } : {}),
    ...(coverages ? { coverages } : {}),
  };
}

// -----------------------------------------------------
// BUILDER
// -----------------------------------------------------

export type ZurichEnrichmentInput = {
  /**
   * Objetos da apólice. Ausente/null = "não foram pedidos" (nenhuma
   * chave de objetos no resultado). `items: []` = "pedidos, não há".
   */
  objects?: {
    source: ZurichEnrichmentSource;
    fetchedAt: string;
    items: readonly ZurichObjectInput[];
  } | null;

  /** Idem para coberturas. */
  coverages?: {
    source: ZurichEnrichmentSource;
    fetchedAt: string;
    items: readonly ZurichCoverageInput[];
  } | null;

  /** Fracionamento cru da apólice. Ausente = não fornecido. */
  paymentFrequency?: ZurichPaymentFrequencyInput | null;

  /** `provider_metadata.enrichment` já gravado (para não perder marcadores). */
  previousEnrichment?: unknown;

  options?: {
    /** Ver "SELEÇÃO DA VIATURA PRINCIPAL". Omissão: "SKIP". */
    onMultipleVehicles?: ZurichMultipleVehiclesPolicy;
  };
};

export type ZurichEnrichmentDiagnostics = {
  /** null = objetos não fornecidos, seleção não avaliada. */
  vehicleSelection: ZurichVehicleSelection | null;

  /** null = não fornecidos. */
  objectCount: number | null;
  coverageCount: number | null;

  /** Campos numéricos com conteúdo que não deram número (ficaram null). */
  unparsableNumbers: number;
};

export type ZurichEnrichmentResult = {
  /** Patch a juntar ao provider_metadata existente. */
  metadata: ZurichEnrichmentMetadata;
  diagnostics: ZurichEnrichmentDiagnostics;
};

export function buildZurichEnrichmentMetadata(
  input: ZurichEnrichmentInput,
): ZurichEnrichmentResult {
  const metadata: ZurichEnrichmentMetadata = {};

  const diagnostics: ZurichEnrichmentDiagnostics = {
    vehicleSelection: null,
    objectCount: null,
    coverageCount: null,
    unparsableNumbers: 0,
  };

  const markers: {
    objects?: ZurichEnrichmentMarker;
    coverages?: ZurichEnrichmentMarker;
  } = {};

  // ---- objetos ----------------------------------------

  if (input.objects) {
    const { items, source, fetchedAt } = input.objects;

    const normalized = items.map(normalizeZurichObject);

    items.forEach((raw, index) => {
      diagnostics.unparsableNumbers +=
        unparsed(raw.Capital, normalized[index].capital) +
        unparsed(raw.Premio, normalized[index].premium);
    });

    const selection = selectPrimaryVehicle(normalized, {
      onMultipleVehicles: input.options?.onMultipleVehicles,
    });

    if (selection.vehicle) {
      const registration = extractZurichVehicleRegistration(
        selection.vehicle.description,
      );

      if (registration) {
        metadata.vehicleRegistration = registration;
      }

      metadata.insuredObject = { ...selection.vehicle };
    }

    metadata.insuredObjects = normalized;

    markers.objects = { source, fetchedAt };
    diagnostics.vehicleSelection = selection;
    diagnostics.objectCount = normalized.length;
  }

  // ---- coberturas -------------------------------------

  if (input.coverages) {
    const { items, source, fetchedAt } = input.coverages;

    const normalized = items.map(normalizeZurichCoverage);

    items.forEach((raw, index) => {
      const coverage = normalized[index];

      diagnostics.unparsableNumbers +=
        unparsed(raw.Capital, coverage.capital) +
        unparsed(raw.ValorFranquia, coverage.deductibleValue) +
        unparsed(raw.ValorMaxFranquia, coverage.maxDeductibleValue) +
        unparsed(raw.NumDiasFranquia, coverage.deductibleDays);
    });

    metadata.coverages = normalized;

    markers.coverages = { source, fetchedAt };
    diagnostics.coverageCount = normalized.length;
  }

  // ---- fracionamento cru ------------------------------

  if (input.paymentFrequency) {
    const code = toNullableString(input.paymentFrequency.code);
    const description = toNullableString(input.paymentFrequency.description);

    if (code !== null || description !== null) {
      metadata.paymentFrequencyRaw = { code, description };
    }
  }

  // ---- marcadores -------------------------------------

  if (markers.objects || markers.coverages) {
    const previous = readZurichEnrichmentMarkers(input.previousEnrichment);

    const objects = markers.objects ?? previous.objects;
    const coverages = markers.coverages ?? previous.coverages;

    metadata.enrichment = {
      schemaVersion: ZURICH_ENRICHMENT_SCHEMA_VERSION,
      ...(objects ? { objects } : {}),
      ...(coverages ? { coverages } : {}),
    };
  }

  return { metadata, diagnostics };
}

// -----------------------------------------------------
// DETEÇÃO DE AUTO E DE CONTEÚDO
// -----------------------------------------------------

/**
 * Códigos de produto Zurich Auto conhecidos. É a mesma lista que a UI
 * (policy-details-drawer) e o ZurichAutoPricingModel já usam; o seu
 * significado não foi verificado junto da Zurich.
 */
export const ZURICH_AUTO_PRODUCT_CODES: readonly string[] = [
  "5324",
  "5907",
  "5910",
];

/**
 * Uma apólice é tratada como Auto se QUALQUER indício o disser (o
 * ramo resolvido na BD, o ramo do mapper, o nome do produto ou um dos
 * códigos conhecidos). Favorece apanhar Autos a mais em vez de a menos:
 * um falso positivo só faz guardar dados a mais e gastar uma consulta.
 */
export function isZurichAutoPolicy(input: {
  insuranceLineCode?: string | null;
  lineCode?: string | null;
  lineName?: string | null;
  productCode?: string | null;
  productName?: string | null;
}): boolean {
  const mentionsAuto = (value: string | null | undefined) =>
    typeof value === "string" && value.toLowerCase().includes("auto");

  if (
    mentionsAuto(input.insuranceLineCode) ||
    mentionsAuto(input.lineCode) ||
    mentionsAuto(input.lineName) ||
    mentionsAuto(input.productName)
  ) {
    return true;
  }

  const code = input.productCode?.trim();

  return code !== undefined && code !== "" && ZURICH_AUTO_PRODUCT_CODES.includes(code);
}

/** True se o objeto cru tem pelo menos um campo com conteúdo. */
export function hasZurichObjectContent(raw: ZurichObjectInput): boolean {
  return [
    raw.NumeroObjeto,
    raw.DescricaoObjeto,
    raw.TipoObjeto,
    raw.Capital,
    raw.EstadoCod,
    raw.Estado,
    raw.Premio,
  ].some((value) => !isBlank(value));
}

/** True se a cobertura crua tem pelo menos um campo com conteúdo. */
export function hasZurichCoverageContent(raw: ZurichCoverageInput): boolean {
  return [
    raw.NumeroObjeto,
    raw.DescricaoCobertura,
    raw.Capital,
    raw.Franquia,
    raw.ValorFranquia,
    raw.ValorMaxFranquia,
    raw.NumDiasFranquia,
  ].some((value) => !isBlank(value));
}

/** True se o objeto cru é uma viatura (mesma regra do sync legado). */
export function isZurichVehicleObjectInput(raw: ZurichObjectInput): boolean {
  return toNullableString(raw.TipoObjeto)?.toLowerCase().includes("viatura") ?? false;
}

// -----------------------------------------------------
// PATCH QUE NUNCA APAGA (merge com o que já está guardado)
// -----------------------------------------------------
//
// O upsertPolicy faz merge superficial: uma chave presente substitui
// a antiga por inteiro. Para listas isso apagaria o que uma corrida
// parcial não trouxe. Por isso as listas são UNIDAS por chave com o
// que já existe (o novo substitui a entrada com a mesma chave; o resto
// mantém-se), e o marcador de um recurso não pedido é preservado.
//
// Consequências assumidas:
// - uma cobertura/objeto que a Zurich deixe de enviar NÃO é removido
//   (pode ficar desatualizado). Só se poderá tratar remoções quando
//   se souber o significado de Estado/EstadoCod e se os ficheiros
//   diários trazem o conjunto completo por apólice;
// - chaves iguais dentro do mesmo pedido colapsam numa só entrada.
//
// A viatura principal (insuredObject/vehicleRegistration) decide-se
// SÓ com os objetos desta corrida, nunca com a lista unida.

function objectKey(item: Record<string, unknown>): string {
  const number = typeof item.number === "string" ? item.number.trim() : "";

  return number !== ""
    ? `n:${number}`
    : `d:${normalizeCoverageDescription(
        typeof item.description === "string" ? item.description : null,
      )}`;
}

function coverageKey(item: Record<string, unknown>): string {
  const objectNumber =
    typeof item.objectNumber === "string" ? item.objectNumber.trim() : "";

  return `${objectNumber}|${normalizeCoverageDescription(
    typeof item.description === "string" ? item.description : null,
  )}`;
}

function mergeByKey<T extends object>(
  existingList: unknown,
  incoming: readonly T[],
  keyOf: (item: Record<string, unknown>) => string,
): T[] {
  const merged: Record<string, unknown>[] = [];
  const positions = new Map<string, number>();

  const add = (item: Record<string, unknown>, replace: boolean) => {
    const key = keyOf(item);
    const position = positions.get(key);

    if (position === undefined) {
      positions.set(key, merged.length);
      merged.push(item);
    } else if (replace) {
      merged[position] = item;
    }
  };

  if (Array.isArray(existingList)) {
    for (const item of existingList) {
      if (isRecord(item)) {
        add(item, false);
      }
    }
  }

  for (const item of incoming) {
    add(item as Record<string, unknown>, true);
  }

  return merged as T[];
}

/**
 * Como buildZurichEnrichmentMetadata, mas já reconciliado com o
 * `provider_metadata` existente: junta as listas por chave e herda os
 * marcadores anteriores. O `metadata` devolvido é o que se deve
 * espalhar (spread) sobre o metadata existente.
 */
export function buildZurichEnrichmentPatch(
  existing: unknown,
  input: ZurichEnrichmentInput,
): ZurichEnrichmentResult {
  const existingMetadata = isRecord(existing) ? existing : {};

  const built = buildZurichEnrichmentMetadata({
    ...input,
    previousEnrichment:
      input.previousEnrichment ?? existingMetadata.enrichment,
  });

  const metadata: ZurichEnrichmentMetadata = { ...built.metadata };

  if (metadata.insuredObjects) {
    metadata.insuredObjects = mergeByKey(
      existingMetadata.insuredObjects,
      metadata.insuredObjects,
      objectKey,
    );
  }

  if (metadata.coverages) {
    metadata.coverages = mergeByKey(
      existingMetadata.coverages,
      metadata.coverages,
      coverageKey,
    );
  }

  return { metadata, diagnostics: built.diagnostics };
}
