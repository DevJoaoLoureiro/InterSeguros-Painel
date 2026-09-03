import type {
  GeneraliParsedFile,
  GeneraliRawRecord,
} from "./types";

function normalizeLines(
  content: string,
): string[] {
  return content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
}

export function parseDat(
  filename: string,
  content: string,
): GeneraliParsedFile {
  const lines =
    normalizeLines(content);

  const records: GeneraliRawRecord[] =
    lines.map((raw, index) => ({
      lineNumber: index + 1,
      raw,
      length: raw.length,
    }));

  return {
    filename,
    type: detectType(filename),
    records,
  };
}

function detectType(
  filename: string,
): string {
  const name =
    filename.toUpperCase();

  if (
    name.startsWith("ICLIENTES") ||
    name.startsWith("DCLIENTES")
  ) {
    return "CLIENTES";
  }

  if (
    name.startsWith("IPOLIZASV") ||
    name.startsWith("DPOLIZASV")
  ) {
    return "POLIZASV";
  }

  if (
    name.startsWith("IPOLIZASA") ||
    name.startsWith("DPOLIZASA")
  ) {
    return "POLIZASA";
  }

  if (
    name.startsWith("IRECIBOS") ||
    name.startsWith("DRECIBOS")
  ) {
    return "RECIBOS";
  }

  if (
    name.startsWith("IGARANTS") ||
    name.startsWith("DGARANTS")
  ) {
    return "GARANTS";
  }

  return "UNKNOWN";
}

export function getCandidateClientId(
  raw: string,
): string | null {
  const value =
    raw.slice(12, 24).trim();

  return value || null;
}

/*
 * Confirmado estruturalmente neste ficheiro:
 * 0-11   = BCN
 * 12-23  = ID cliente
 * 24-103 = nome
 */
export function getCandidateName(
  raw: string,
): string | null {
  const value =
    raw.slice(24, 104).trim();

  return value || null;
}

export function getCandidatePolicyClientId(
  raw: string,
): string | null {
  const value =
    raw.slice(12, 24).trim();

  return value || null;
}

export function getCandidatePolicyId(
  raw: string,
): string | null {
  const value =
    raw.slice(24, 44).trim();

  return value || null;
}

export function getCandidateReceiptClientId(
  raw: string,
): string | null {
  const value =
    raw.slice(12, 24).trim();

  return value || null;
}

/*
 * No IRECIBOS a referência da apólice
 * tem outro formato e ocupa 23 caracteres.
 */
export function getCandidateReceiptPolicyKey(
  raw: string,
): string | null {
  const value =
    raw.slice(24, 47).trim();

  return value || null;
}

/*
 * Primeira referência que aparenta ser
 * identificador do recibo.
 *
 * Mantemos como "candidate" até termos
 * confirmação do layout oficial.
 */
export function getCandidateReceiptId(
  raw: string,
): string | null {
  const value =
    raw.slice(47, 61).trim();

  return value || null;
}

/*
 * Converte o ID usado em POLIZAS para
 * a chave usada pelo ficheiro RECIBOS.
 *
 * Exemplo:
 *
 * 3243240010214401201
 * =>
 * 00324001021440120
 */
export function policyIdToReceiptKey(
  policyId: string,
): string | null {
  const clean =
    policyId.trim();

  if (clean.length < 8) {
    return null;
  }

  return (
    "00" +
    clean.slice(0, 3) +
    clean.slice(6, -1)
  );
}
