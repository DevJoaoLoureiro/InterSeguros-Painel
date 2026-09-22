import type { JsonObject, JsonValue } from "./types";

/*
 * Normalização defensiva antes de persistir.
 *
 * Regras: null continua null; undefined nunca vira 0; NaN/Infinity não se
 * guardam; strings vazias viram null; nada aqui lança exceção.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Texto aparado; vazio, ausente ou de outro tipo -> null. */
export function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();

  return trimmed === "" ? null : trimmed;
}

/** Texto para comparações (sem acentos, minúsculas, espaços colapsados). */
export function comparableText(value: unknown): string | null {
  const text = normalizeText(value);

  if (text === null) return null;

  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Referência: aparada, maiúsculas, espaços colapsados. */
export function normalizeReference(value: unknown): string | null {
  const text = normalizeText(value);

  return text === null ? null : text.replace(/\s+/g, " ").toUpperCase();
}

/** Matrícula XX-XX-XX em maiúsculas; qualquer coisa que não tenha 6 alfanuméricos -> null. */
export function normalizePlate(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");

  return compact.length === 6
    ? `${compact.slice(0, 2)}-${compact.slice(2, 4)}-${compact.slice(4, 6)}`
    : null;
}

/** NNNN-NNN (ou NNNN se só houver os 4 primeiros dígitos); inválido -> null. */
export function normalizePostalCode(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const text = value.trim();
  const full = text.match(/^(\d{4})[-\s]?(\d{3})$/);

  if (full) return `${full[1]}-${full[2]}`;

  return /^\d{4}$/.test(text) ? text : null;
}

/** yyyy-mm-dd de uma data de calendário válida; aceita ISO com hora. Inválido -> null. */
export function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);

  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  const valid =
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day);

  return valid ? `${year}-${month}-${day}` : null;
}

/** Instante ISO (UTC) de uma data válida; inválido -> null. */
export function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** number finito; strings numéricas simples são aceites; o resto -> null (nunca 0). */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function toRoundedInteger(value: unknown): number | null {
  const number = toFiniteNumber(value);

  return number === null ? null : Math.round(number);
}

/**
 * Valor em euros escrito por uma pessoa: "1264,40", "1.264,40", "1 264,40",
 * "1264.40", "1264 €". Ambíguo ou ilegível -> null. Nunca 0 por omissão.
 */
export function parseMoney(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  if (typeof value !== "string") return null;

  const text = value.replace(/[€\s]/g, "");

  if (text === "") return null;

  let normalized: string;

  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(text)) {
    normalized = text.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+,\d+$/.test(text)) {
    normalized = text.replace(",", ".");
  } else if (/^\d+(\.\d+)?$/.test(text)) {
    normalized = text;
  } else {
    return null;
  }

  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Converte para JSON seguro: remove undefined, troca NaN/Infinity por null,
 * datas por ISO, e ignora funções/símbolos. Estruturas cíclicas não se
 * esperam (snapshots planos); a profundidade é limitada por precaução.
 */
export function toJsonValue(value: unknown, depth = 0): JsonValue {
  if (depth > 12) return null;

  if (value === null || value === undefined) return null;

  if (typeof value === "string" || typeof value === "boolean") return value;

  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const result: JsonObject = {};

    for (const [key, item] of Object.entries(value)) {
      if (item === undefined || typeof item === "function") continue;

      result[key] = toJsonValue(item, depth + 1);
    }

    return result;
  }

  return null;
}

export function toJsonObject(value: unknown): JsonObject {
  const json = toJsonValue(value);

  return json !== null && typeof json === "object" && !Array.isArray(json)
    ? json
    : {};
}
