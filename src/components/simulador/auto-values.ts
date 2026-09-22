import type {
  AutoCoverageFlags,
  AutoFormErrors,
  AutoFormValues,
  ClaimsAnswer,
  DrivingUsage,
  SimulatorPaymentFrequency,
} from "./types";

/*
 * Lógica pura do formulário Auto: valores por omissão, normalização,
 * presets de cobertura e validação.
 *
 * É partilhada pelo browser (feedback imediato) e pelo Server Action (que
 * volta a validar tudo, porque o cliente nunca é de confiança). Por isso
 * não pode importar nada de servidor.
 */

/* ------------------------------------------------------------------ *
 * Opções
 * ------------------------------------------------------------------ */

export const USAGE_OPTIONS: { value: DrivingUsage; label: string }[] = [
  { value: "PRIVATE", label: "Particular" },
  { value: "PROFESSIONAL", label: "Profissional" },
  { value: "MIXED", label: "Misto" },
  { value: "TVDE", label: "TVDE" },
  { value: "TAXI", label: "Táxi" },
];

export const PAYMENT_FREQUENCY_OPTIONS: {
  value: SimulatorPaymentFrequency;
  label: string;
}[] = [
  { value: "ANNUAL", label: "Anual" },
  { value: "SEMIANNUAL", label: "Semestral" },
  { value: "QUARTERLY", label: "Trimestral" },
  { value: "MONTHLY", label: "Mensal" },
];

/** Franquias oferecidas na UI (euros). `null` = indiferente. */
export const DEDUCTIBLE_OPTIONS: number[] = [0, 150, 250, 500, 1000];

const USAGES = new Set<string>(USAGE_OPTIONS.map((option) => option.value));
const FREQUENCIES = new Set<string>(
  PAYMENT_FREQUENCY_OPTIONS.map((option) => option.value),
);
const CLAIMS_ANSWERS = new Set<string>(["UNKNOWN", "NONE", "SOME"]);

/* ------------------------------------------------------------------ *
 * Presets de cobertura
 *
 * O preset só governa as coberturas "de base"; assistência e proteção
 * jurídica são extras independentes. Se as coberturas de base não
 * coincidirem com nenhum preset, o formulário mostra "Personalizado".
 * ------------------------------------------------------------------ */

export type CoveragePresetId = "LIABILITY" | "PARTIAL" | "FULL";

export const COVERAGE_PRESETS: {
  id: CoveragePresetId;
  label: string;
  description: string;
  core: Pick<
    AutoCoverageFlags,
    "ownDamage" | "fire" | "theft" | "glass"
  >;
}[] = [
  {
    id: "LIABILITY",
    label: "Só responsabilidade civil",
    description: "Cobertura obrigatória, sem danos na própria viatura.",
    core: { ownDamage: false, fire: false, theft: false, glass: false },
  },
  {
    id: "PARTIAL",
    label: "RC + roubo, incêndio e vidros",
    description: "Sem danos próprios por colisão.",
    core: { ownDamage: false, fire: true, theft: true, glass: true },
  },
  {
    id: "FULL",
    label: "Todos os riscos",
    description: "Inclui danos próprios (colisão).",
    core: { ownDamage: true, fire: true, theft: true, glass: true },
  },
];

export function getCoveragePreset(
  coverages: AutoCoverageFlags,
): CoveragePresetId | "CUSTOM" {
  const match = COVERAGE_PRESETS.find(
    (preset) =>
      preset.core.ownDamage === coverages.ownDamage &&
      preset.core.fire === coverages.fire &&
      preset.core.theft === coverages.theft &&
      preset.core.glass === coverages.glass,
  );

  return match?.id ?? "CUSTOM";
}

export function applyCoveragePreset(
  coverages: AutoCoverageFlags,
  presetId: CoveragePresetId,
): AutoCoverageFlags {
  const preset = COVERAGE_PRESETS.find((item) => item.id === presetId);

  return preset ? { ...coverages, ...preset.core } : coverages;
}

/* ------------------------------------------------------------------ *
 * Valores por omissão
 * ------------------------------------------------------------------ */

export function createEmptyAutoValues(): AutoFormValues {
  return {
    registration: "",
    birthDate: "",
    postalCode: "",
    drivingLicenceDate: "",
    usage: "PRIVATE",
    coverages: {
      ownDamage: false,
      fire: false,
      theft: false,
      glass: false,
      assistance: false,
      legalProtection: false,
    },
    deductible: null,
    paymentFrequency: "ANNUAL",
    claimsAnswer: "UNKNOWN",
    claimsCount: 1,
    atFaultClaims: 0,
    vehicleValue: "",
  };
}

/* ------------------------------------------------------------------ *
 * Normalização
 * ------------------------------------------------------------------ */

/** Escreve enquanto formata: "ab12cd" -> "AB-12-CD". Máx. 6 caracteres. */
export function formatRegistration(raw: string): string {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);

  return compact.match(/.{1,2}/g)?.join("-") ?? "";
}

export function isCompleteRegistration(value: string): boolean {
  return /^[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]{2}$/.test(value);
}

/** "4000001" -> "4000-001"; aceita parciais enquanto se escreve. */
export function formatPostalCode(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 7);

  return digits.length > 4 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits;
}

export function isCompletePostalCode(value: string): boolean {
  return /^\d{4}-\d{3}$/.test(value);
}

/** Aceita "yyyy-mm-dd" (com ou sem hora) e devolve só a data; senão "". */
export function toDateInputValue(raw: string | null | undefined): string {
  const match = raw?.match(/^(\d{4})-(\d{2})-(\d{2})/);

  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

type DateParts = { year: number; month: number; day: number };

function parseDate(value: string): DateParts | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));

  // Rejeita datas impossíveis (31 de fevereiro, etc.).
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function todayParts(now: Date): DateParts {
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  };
}

function compareParts(a: DateParts, b: DateParts): number {
  return (
    a.year - b.year || a.month - b.month || a.day - b.day
  );
}

/** Anos completos entre `from` e `to`. */
function fullYearsBetween(from: DateParts, to: DateParts): number {
  let years = to.year - from.year;

  if (to.month < from.month || (to.month === from.month && to.day < from.day)) {
    years -= 1;
  }

  return years;
}

/** Idade em anos completos; null se a data for inválida ou futura. */
export function getAgeInYears(
  birthDate: string,
  now: Date = new Date(),
): number | null {
  const parts = parseDate(birthDate);

  if (!parts || compareParts(parts, todayParts(now)) > 0) return null;

  return fullYearsBetween(parts, todayParts(now));
}

/** Anos completos desde a data; null se inválida ou futura. */
export function getYearsSince(
  date: string,
  now: Date = new Date(),
): number | null {
  return getAgeInYears(date, now);
}

export function toIsoDate(now: Date = new Date()): string {
  const { year, month, day } = todayParts(now);

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Interpreta euros escritos à portuguesa ("12 500", "12.500,50"). */
export function parseEuroAmount(raw: string): number | null {
  const cleaned = raw
    .replace(/[€\s]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");

  if (!cleaned) return null;

  const value = Number(cleaned);

  return Number.isFinite(value) ? value : null;
}

/* ------------------------------------------------------------------ *
 * Validação
 * ------------------------------------------------------------------ */

export const MIN_DRIVER_AGE = 18;
export const MAX_DRIVER_AGE = 100;
const MIN_LICENCE_AGE = 16;

export function validateAutoValues(
  values: AutoFormValues,
  now: Date = new Date(),
): AutoFormErrors {
  const errors: AutoFormErrors = {};

  // Matrícula
  if (!values.registration) {
    errors.registration = "Indique a matrícula.";
  } else if (!isCompleteRegistration(values.registration)) {
    errors.registration = "A matrícula deve ter 6 caracteres (ex.: AB-12-CD).";
  }

  // Data de nascimento
  const birth = parseDate(values.birthDate);
  const age = birth ? getAgeInYears(values.birthDate, now) : null;

  if (!values.birthDate) {
    errors.birthDate = "Indique a data de nascimento do condutor.";
  } else if (!birth) {
    errors.birthDate = "Data de nascimento inválida.";
  } else if (age === null) {
    errors.birthDate = "A data de nascimento não pode ser futura.";
  } else if (age < MIN_DRIVER_AGE) {
    errors.birthDate = `O condutor tem de ter pelo menos ${MIN_DRIVER_AGE} anos.`;
  } else if (age > MAX_DRIVER_AGE) {
    errors.birthDate = "Confirme a data de nascimento.";
  }

  // Código postal
  if (!values.postalCode) {
    errors.postalCode = "Indique o código postal.";
  } else if (!isCompletePostalCode(values.postalCode)) {
    errors.postalCode = "Código postal incompleto (formato 0000-000).";
  }

  // Data da carta
  const licence = parseDate(values.drivingLicenceDate);

  if (!values.drivingLicenceDate) {
    errors.drivingLicenceDate = "Indique a data da carta de condução.";
  } else if (!licence) {
    errors.drivingLicenceDate = "Data da carta inválida.";
  } else if (compareParts(licence, todayParts(now)) > 0) {
    errors.drivingLicenceDate = "A data da carta não pode ser futura.";
  } else if (
    birth &&
    fullYearsBetween(birth, licence) < MIN_LICENCE_AGE
  ) {
    errors.drivingLicenceDate = `A carta não pode ser anterior aos ${MIN_LICENCE_AGE} anos do condutor.`;
  }

  // Valor da viatura (opcional, só relevante com danos próprios)
  if (values.coverages.ownDamage && values.vehicleValue.trim()) {
    const amount = parseEuroAmount(values.vehicleValue);

    if (amount === null || amount <= 0 || amount > 5_000_000) {
      errors.vehicleValue = "Valor inválido.";
    }
  }

  return errors;
}

/** Etiquetas dos campos essenciais, pela ordem em que aparecem no form. */
const ESSENTIAL_LABELS: [keyof AutoFormValues, string][] = [
  ["registration", "matrícula"],
  ["birthDate", "data de nascimento"],
  ["postalCode", "código postal"],
  ["drivingLicenceDate", "data da carta"],
];

/** Campos essenciais ainda vazios (não valida o conteúdo). */
export function getMissingEssentials(values: AutoFormValues): string[] {
  return ESSENTIAL_LABELS.filter(([key]) => !values[key]).map(
    ([, label]) => label,
  );
}

/* ------------------------------------------------------------------ *
 * Sanitização de input não fiável (Server Action)
 *
 * O tipo diz AutoFormValues, mas em runtime chega o que o POST trouxer.
 * Devolve sempre um objeto bem formado (campos inválidos caem no valor
 * por omissão) para que a validação e o motor nunca vejam lixo.
 * ------------------------------------------------------------------ */

function asString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asIntInRange(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}

export function sanitizeAutoValues(input: unknown): AutoFormValues {
  const base = createEmptyAutoValues();

  if (!input || typeof input !== "object") return base;

  const raw = input as Record<string, unknown>;
  const rawCoverages =
    raw.coverages && typeof raw.coverages === "object"
      ? (raw.coverages as Record<string, unknown>)
      : {};

  const claimsCount = asIntInRange(raw.claimsCount, 1, 20, 1);

  const deductible =
    typeof raw.deductible === "number" &&
    Number.isFinite(raw.deductible) &&
    raw.deductible >= 0 &&
    raw.deductible <= 100_000
      ? raw.deductible
      : null;

  return {
    registration: formatRegistration(asString(raw.registration, 32)),
    birthDate: toDateInputValue(asString(raw.birthDate, 32)),
    postalCode: formatPostalCode(asString(raw.postalCode, 32)),
    drivingLicenceDate: toDateInputValue(asString(raw.drivingLicenceDate, 32)),
    usage: USAGES.has(raw.usage as string)
      ? (raw.usage as DrivingUsage)
      : base.usage,
    coverages: {
      ownDamage: asBoolean(rawCoverages.ownDamage),
      fire: asBoolean(rawCoverages.fire),
      theft: asBoolean(rawCoverages.theft),
      glass: asBoolean(rawCoverages.glass),
      assistance: asBoolean(rawCoverages.assistance),
      legalProtection: asBoolean(rawCoverages.legalProtection),
    },
    deductible,
    paymentFrequency: FREQUENCIES.has(raw.paymentFrequency as string)
      ? (raw.paymentFrequency as SimulatorPaymentFrequency)
      : base.paymentFrequency,
    claimsAnswer: CLAIMS_ANSWERS.has(raw.claimsAnswer as string)
      ? (raw.claimsAnswer as ClaimsAnswer)
      : base.claimsAnswer,
    claimsCount,
    atFaultClaims: asIntInRange(raw.atFaultClaims, 0, claimsCount, 0),
    vehicleValue: asString(raw.vehicleValue, 32),
  };
}
