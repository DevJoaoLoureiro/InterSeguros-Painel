import type { QuoteRequest } from "../../domain/types";
import { normalizeCoverageDescription } from "../../../insurance/providers/zurich/coverage-description";
import {
  buildCoverageProfile,
  deriveCoverageTier,
  tierFromRequestedCoverages,
  type CoverageEntry,
  type CoverageProfile,
  type CoverageTier,
} from "./zurich-auto-coverages";
import {
  resolveHistoricalTarget,
  type HistoricalTarget,
  type TargetReceipt,
} from "./zurich-auto-target";

/*
 * Extração de features de uma apólice histórica Zurich Auto e do pedido.
 *
 * Tudo puro e defensivo: `provider_metadata` é `unknown`; números podem
 * vir como number ou string; desconhecido nunca vira 0.
 *
 * NÃO são features (por desenho):
 * - matrícula, número de apólice, id/NIF do cliente: identificadores,
 *   não sinais estatísticos. `groupKey` (cliente) existe SÓ para a
 *   validação não deixar apólices do mesmo cliente prever-se umas às
 *   outras; o estimador nunca o lê.
 * - `insuredObject.capital`: em 106 de 116 apólices é 7 750 000 (capital de
 *   Responsabilidade Civil), não o valor da viatura. O proxy do valor da
 *   viatura é o capital da cobertura de Choque/Colisão (ver coverages).
 * - `insuredObject.premium`: não é equivalente ao prémio anual (ver target).
 * - Carta de condução, potência, cilindrada, combustível, 1ª matrícula,
 *   km, uso, bónus-malus, sinistros: não existem nas apólices históricas.
 */

// ---------- primitivas ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();

    return trimmed === "" ? null : trimmed;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

/**
 * Número ou null. Aceita number finito, "410,92", "1.234,56", "410.92" e
 * "18000". Vazio ou ilegível -> null (nunca 0).
 */
export function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
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

export function getAge(
  birthDate: string | null,
  referenceDate: Date = new Date(),
): number | null {
  if (!birthDate) {
    return null;
  }

  const date = new Date(birthDate);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  let age = referenceDate.getFullYear() - date.getFullYear();

  const monthDifference = referenceDate.getMonth() - date.getMonth();

  if (
    monthDifference < 0 ||
    (monthDifference === 0 && referenceDate.getDate() < date.getDate())
  ) {
    age--;
  }

  return age >= 0 && age <= 120 ? age : null;
}

export function getPostalPrefix(postalCode: string | null): string | null {
  if (!postalCode) {
    return null;
  }

  return postalCode.match(/^(\d{4})/)?.[1] ?? null;
}

// ---------- viatura ----------

export type VehicleClass = "STANDARD" | "TWO_WHEELER" | "LIGHT_COMMERCIAL";

/*
 * Marcas reconhecidas na DescricaoObjeto ("Mercedes-Benz S 350",
 * "Peugeot -"). Lista fechada: as marcas vistas na carteira mais outras
 * comuns. Só se devolve a MARCA: modelo e versão não se extraem (a
 * descrição é livre e inconsistente). A matrícula é removida antes.
 */
const KNOWN_BRANDS: readonly string[] = [
  "Mercedes-Benz", "Peugeot", "Renault", "BMW", "Opel", "Volkswagen", "Ford",
  "Toyota", "Fiat", "Mitsubishi", "Audi", "Seat", "KIA", "Suzuki", "Nissan",
  "Citroen", "Honda", "Tesla", "Keeway", "Volvo", "Mazda", "Smart", "Fendt",
  "Dacia", "Hyundai", "Skoda", "Mini", "Porsche", "Jaguar", "Land Rover",
  "Jeep", "Lexus", "Alfa Romeo", "Yamaha", "Kawasaki", "Ducati", "Piaggio",
  "Vespa", "KTM", "Cupra", "DS", "Iveco", "Mercedes",
];

const BRAND_LOOKUP = KNOWN_BRANDS.map((brand) => ({
  brand: brand === "Mercedes" ? "Mercedes-Benz" : brand,
  key: normalizeCoverageDescription(brand),
})).sort((a, b) => b.key.length - a.key.length);

const PLATE = /\b[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]{2}\b/gi;

export function extractVehicleMake(
  description: string | null | undefined,
): string | null {
  if (!description) {
    return null;
  }

  const text = normalizeCoverageDescription(
    description.replace(PLATE, " ").replace(/<placa>/gi, " "),
  );

  for (const { brand, key } of BRAND_LOOKUP) {
    if (text === key || text.startsWith(`${key} `) || text.startsWith(`${key}-`)) {
      return brand;
    }
  }

  return null;
}

type ReadObject = {
  number: string | null;
  type: string | null;
  status: string | null;
  description: string | null;
};

function readObjects(metadata: Record<string, unknown>): ReadObject[] {
  const source = Array.isArray(metadata.insuredObjects)
    ? metadata.insuredObjects
    : isRecord(metadata.insuredObject)
      ? [metadata.insuredObject]
      : [];

  return source.filter(isRecord).map((item) => ({
    number: readText(item.number),
    type: readText(item.type),
    status: readText(item.status),
    description: readText(item.description),
  }));
}

/*
 * Viaturas ATIVAS. Objetos "Anulada" aparecem depois de uma substituição
 * de viatura (o objeto antigo fica listado com prémio 0). Se todos
 * estiverem anulados usa-se a lista completa (não se assume qual é a atual).
 */
function activeVehicles(objects: readonly ReadObject[]): ReadObject[] {
  const vehicles = objects.filter((object) =>
    (object.type ?? "").toLowerCase().includes("viatura"),
  );

  const active = vehicles.filter(
    (object) => !normalizeCoverageDescription(object.status).includes("anulad"),
  );

  return active.length > 0 ? active : vehicles;
}

function readCoverageEntries(
  metadata: Record<string, unknown>,
  vehicleNumber: string | null,
): CoverageEntry[] {
  if (!Array.isArray(metadata.coverages)) {
    return [];
  }

  return metadata.coverages
    .filter(isRecord)
    .map((item) => ({
      objectNumber: readText(item.objectNumber),
      description: readText(item.description),
      capital: readFiniteNumber(item.capital),
      deductibleValue: readFiniteNumber(item.deductibleValue),
    }))
    .filter(
      (item): item is CoverageEntry => item.description !== null,
    )
    // Com uma viatura identificada, só as coberturas dessa viatura (ou
    // sem número de objeto, que não se conseguem atribuir a outra).
    .filter(
      (item) =>
        vehicleNumber === null ||
        item.objectNumber === null ||
        item.objectNumber === vehicleNumber,
    );
}

// ---------- features históricas ----------

export type ProductFamily = "AUTO" | "AUTO_BUSINESS";

export type HistoricalPolicyInput = {
  /** Identificador interno; nunca é feature. */
  id: string;

  /** Cliente: só para a validação agrupar; nunca é feature. */
  groupKey: string | null;

  productCode: string | null;
  productName: string | null;
  status: string | null;
  startDate: string | null;

  annualizedPremium: number | string | null;
  totalPremium: number | string | null;
  paymentFrequency: string | null;

  lastSyncedAt: string | null;
  providerMetadata: unknown;

  holderBirthDate: string | null;
  holderPostalCode: string | null;

  receipts: readonly TargetReceipt[];
};

export type ZurichHistoricalFeatures = {
  id: string;
  groupKey: string | null;

  /** Idade do TITULAR na data de referência (proxy do condutor). */
  driverAge: number | null;
  postalPrefix: string | null;

  productCode: string | null;
  productName: string | null;
  productFamily: ProductFamily;

  /** Capital de Choque/Colisão: proxy do valor da viatura (não confirmado). */
  vehicleCapital: number | null;
  vehicleMake: string | null;
  vehicleClass: VehicleClass;

  /** Viaturas ativas conhecidas (0 = sem dados de objetos). */
  vehicleCount: number;

  coverageTier: CoverageTier;
  coverageProfile: CoverageProfile;

  /** 0..1: fração dos dados esperados que a apólice tem. */
  metadataCompleteness: number;

  target: HistoricalTarget;
  targetPremium: number | null;

  /** Dias desde o início da apólice (proxy da data do prémio); null se desconhecido. */
  ageOfObservationDays: number | null;

  isCancelled: boolean;
  lastSyncedAt: string | null;
};

export function deriveProductFamily(
  productCode: string | null,
  productName: string | null,
): ProductFamily {
  const name = normalizeCoverageDescription(productName);

  return name.includes("empresas") || productCode === "5907" || productCode === "5910"
    ? "AUTO_BUSINESS"
    : "AUTO";
}

/**
 * Completude: fração de verificações satisfeitas. Verificações comuns:
 * produto, alvo (prémio) conhecido, tier conhecido, viatura conhecida,
 * idade, código postal, data de observação. Em danos próprios acresce o
 * capital (proxy do valor do veículo), que é o dado que os distingue.
 */
export function calculateMetadataCompleteness(parts: {
  hasProduct: boolean;
  hasTarget: boolean;
  tier: CoverageTier;
  hasVehicle: boolean;
  hasAge: boolean;
  hasPostal: boolean;
  hasObservationDate: boolean;
  ownDamageCapital: number | null;
}): number {
  const checks = [
    parts.hasProduct,
    parts.hasTarget,
    parts.tier !== "UNKNOWN",
    parts.hasVehicle,
    parts.hasAge,
    parts.hasPostal,
    parts.hasObservationDate,
  ];

  if (parts.tier === "OWN_DAMAGE") {
    checks.push(parts.ownDamageCapital !== null);
  }

  return checks.filter(Boolean).length / checks.length;
}

export function extractZurichHistoricalFeatures(
  policy: HistoricalPolicyInput,
  referenceDate: Date = new Date(),
): ZurichHistoricalFeatures {
  const metadata = isRecord(policy.providerMetadata)
    ? policy.providerMetadata
    : {};

  const vehicles = activeVehicles(readObjects(metadata));
  const vehicleNumber = vehicles.length === 1 ? vehicles[0].number : null;

  // Várias viaturas: o prémio é da apólice, não de uma viatura; sem perfil.
  const entries =
    vehicles.length >= 2 ? [] : readCoverageEntries(metadata, vehicleNumber);

  const coverageProfile = buildCoverageProfile(entries);
  const coverageTier = deriveCoverageTier(coverageProfile);

  const target = resolveHistoricalTarget({
    annualizedPremium: readFiniteNumber(policy.annualizedPremium),
    totalPremium: readFiniteNumber(policy.totalPremium),
    paymentFrequency: policy.paymentFrequency,
    receipts: policy.receipts,
  });

  const driverAge = getAge(policy.holderBirthDate, referenceDate);
  const postalPrefix = getPostalPrefix(policy.holderPostalCode);

  const start = policy.startDate ? Date.parse(policy.startDate) : NaN;
  const ageOfObservationDays = Number.isNaN(start)
    ? null
    : Math.max(0, Math.floor((referenceDate.getTime() - start) / 86_400_000));

  const vehicleClass: VehicleClass =
    coverageProfile.vehicleClassHint ?? "STANDARD";

  return {
    id: policy.id,
    groupKey: policy.groupKey,

    driverAge,
    postalPrefix,

    productCode: policy.productCode,
    productName: policy.productName,
    productFamily: deriveProductFamily(policy.productCode, policy.productName),

    vehicleCapital: coverageProfile.ownDamageCapital,
    vehicleMake:
      vehicles.length === 1 ? extractVehicleMake(vehicles[0].description) : null,
    vehicleClass,
    vehicleCount: vehicles.length,

    coverageTier,
    coverageProfile,

    metadataCompleteness: calculateMetadataCompleteness({
      hasProduct: policy.productCode !== null && policy.productCode !== "",
      hasTarget: target.value !== null,
      tier: coverageTier,
      hasVehicle: vehicles.length === 1,
      hasAge: driverAge !== null,
      hasPostal: postalPrefix !== null,
      hasObservationDate: ageOfObservationDays !== null,
      ownDamageCapital: coverageProfile.ownDamageCapital,
    }),

    target,
    targetPremium: target.value,

    ageOfObservationDays,

    isCancelled: (policy.status ?? "").toUpperCase() === "CANCELLED",
    lastSyncedAt: policy.lastSyncedAt,
  };
}

/**
 * Apólice utilizável como histórico: prémio anual conhecido e não
 * contraditado por recibos, e uma só viatura ativa (com várias, o prémio
 * é da apólice e não comparável com o de um só carro).
 */
export function isEligibleHistorical(
  features: ZurichHistoricalFeatures,
): boolean {
  return (
    features.targetPremium !== null &&
    features.target.confidence !== "INCONSISTENT" &&
    features.vehicleCount <= 1
  );
}

// ---------- pedido ----------

/** Features do pedido do simulador, no mesmo espaço das históricas. */
export type RequestFeatures = {
  driverAge: number | null;
  postalPrefix: string | null;

  /** Só se o pedido trouxer `metadata.productCode` (a UI não o envia). */
  productCode: string | null;
  productFamily: ProductFamily | null;

  coverageTier: CoverageTier;
  wantsGlass: boolean;

  /** Só com danos próprios e valor positivo indicado. */
  vehicleValue: number | null;

  /** Só com danos próprios e franquia indicada (>= 0). */
  deductible: number | null;
};

export function extractRequestFeatures(
  request: QuoteRequest,
  referenceDate: Date = new Date(),
): RequestFeatures {
  const { requestedCoverages } = request;
  const tier = tierFromRequestedCoverages(requestedCoverages);

  const rawProductCode = request.metadata?.productCode;
  const productCode =
    typeof rawProductCode === "string" && rawProductCode.trim() !== ""
      ? rawProductCode.trim()
      : null;

  const marketValue = request.vehicle?.marketValue;
  const deductible = requestedCoverages.deductible;

  return {
    driverAge: getAge(request.customer.birthDate, referenceDate),
    postalPrefix: getPostalPrefix(request.customer.postalCode),

    productCode,
    productFamily: productCode ? deriveProductFamily(productCode, null) : null,

    coverageTier: tier,
    wantsGlass: requestedCoverages.glass,

    vehicleValue:
      tier === "OWN_DAMAGE" &&
      typeof marketValue === "number" &&
      Number.isFinite(marketValue) &&
      marketValue > 0
        ? marketValue
        : null,

    deductible:
      tier === "OWN_DAMAGE" &&
      typeof deductible === "number" &&
      Number.isFinite(deductible) &&
      deductible >= 0
        ? deductible
        : null,
  };
}

/**
 * O que o mediador introduziria no simulador para reproduzir esta apólice:
 * idade, código postal, coberturas pedidas, valor do veículo e franquia
 * (quando conhecidos). Nunca produto (a UI não o envia) nem classe de
 * viatura. Serve para medir o erro do modelo contra o próprio histórico.
 */
export function requestFeaturesFromHistorical(
  policy: ZurichHistoricalFeatures,
): RequestFeatures {
  const ownDamage = policy.coverageTier === "OWN_DAMAGE";

  return {
    driverAge: policy.driverAge,
    postalPrefix: policy.postalPrefix,
    productCode: null,
    productFamily: null,
    coverageTier: policy.coverageTier,
    wantsGlass: policy.coverageProfile.hasGlass === true,
    vehicleValue: ownDamage ? policy.vehicleCapital : null,
    deductible: ownDamage ? policy.coverageProfile.ownDamageDeductible : null,
  };
}
