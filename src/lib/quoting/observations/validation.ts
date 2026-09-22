import {
  normalizeText,
  parseMoney,
} from "./normalize";
import {
  REAL_QUOTE_BASES,
  USER_SELECTABLE_STATUSES,
  type ObservationStatus,
  type RealQuoteBasis,
  type RealQuoteData,
} from "./types";

/*
 * Validação do formulário "Guardar cotação real Zurich" NO SERVIDOR. A UI
 * valida por comodidade; esta é a validação que conta.
 */

export const MAX_REAL_QUOTE_AMOUNT = 100_000;
export const MAX_NOTES_LENGTH = 2000;

const MAX_PRODUCT_NAME = 120;
const MAX_PRODUCT_CODE = 30;
const MAX_REFERENCE = 80;

export type RealQuoteFormField =
  | "amount"
  | "basis"
  | "productName"
  | "productCode"
  | "reference"
  | "status"
  | "notes";

export type RealQuoteFormErrors = Partial<Record<RealQuoteFormField, string>>;

export type ParsedRealQuoteForm = {
  realQuote: RealQuoteData;
  status: ObservationStatus;
  notes: string | null;
};

export type ParseRealQuoteResult =
  | { ok: true; value: ParsedRealQuoteForm }
  | { ok: false; errors: RealQuoteFormErrors };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(
  raw: unknown,
  max: number,
  label: string,
  errors: RealQuoteFormErrors,
  field: RealQuoteFormField,
): string | null {
  const text = normalizeText(raw);

  if (text !== null && text.length > max) {
    errors[field] = `${label} demasiado longo (máx. ${max} caracteres).`;

    return null;
  }

  return text;
}

export function parseRealQuoteForm(raw: unknown): ParseRealQuoteResult {
  const errors: RealQuoteFormErrors = {};

  if (!isRecord(raw)) {
    return { ok: false, errors: { amount: "Dados em falta." } };
  }

  // ---- valor ----
  const amount = parseMoney(raw.amount);

  if (amount === null) {
    errors.amount = "Indique o valor real da Zurich.";
  } else if (amount <= 0) {
    errors.amount = "O valor tem de ser superior a 0.";
  } else if (amount > MAX_REAL_QUOTE_AMOUNT) {
    errors.amount = "Valor demasiado elevado.";
  }

  // ---- base: nunca assumida (ANNUAL não é o default silencioso) ----
  const basis = normalizeText(raw.basis);

  if (basis === null) {
    errors.basis = "Escolha a base do preço (ou «Não sei»).";
  } else if (!(REAL_QUOTE_BASES as readonly string[]).includes(basis)) {
    errors.basis = "Base do preço inválida.";
  }

  // ---- estado: omitido = VALID; DUPLICATE só o sistema atribui ----
  const rawStatus = normalizeText(raw.status) ?? "VALID";

  if (!(USER_SELECTABLE_STATUSES as readonly string[]).includes(rawStatus)) {
    errors.status = "Estado inválido.";
  }

  const productName = optionalText(raw.productName, MAX_PRODUCT_NAME, "Produto", errors, "productName");
  const productCode = optionalText(raw.productCode, MAX_PRODUCT_CODE, "Código", errors, "productCode");
  const reference = optionalText(raw.reference, MAX_REFERENCE, "Referência", errors, "reference");
  const notes = optionalText(raw.notes, MAX_NOTES_LENGTH, "Notas", errors, "notes");

  if (Object.keys(errors).length > 0 || amount === null || basis === null) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      realQuote: {
        amount,
        basis: basis as RealQuoteBasis,
        productCode,
        productName,
        reference,
      },
      status: rawStatus as ObservationStatus,
      notes,
    },
  };
}
