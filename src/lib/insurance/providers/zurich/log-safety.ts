// =====================================================
// ZURICH - SANITIZAÇÃO DE LOGS E RESPOSTAS
// =====================================================
//
// Utilitários PUROS (sem imports, sem I/O) para nunca deixar chegar
// a logs ou a respostas HTTP de diagnóstico:
//   - tokens (Token1/Token2, token de 22 caracteres) e passwords;
//   - NIF, IBAN/NIB, emails;
//   - payloads base64 completos.
//
// Regra de ouro dos logs Zurich: registar O QUE aconteceu (operação,
// estado HTTP, código de erro, nº de registos, duração), nunca o
// CONTEÚDO da resposta nem os parâmetros do pedido.
// =====================================================

const MASK = "***";

/**
 * Identificador mascarado: mantém só os últimos `visible` caracteres.
 *   "PT-1234567" -> "***4567"
 * Texto curto demais para mostrar algo -> "***".
 */
export function maskIdentifier(value: unknown, visible = 4): string {
  if (value === null || value === undefined) {
    return "(vazio)";
  }

  const text = String(value).trim();

  if (text === "") {
    return "(vazio)";
  }

  return text.length <= visible ? MASK : `${MASK}${text.slice(-visible)}`;
}

/**
 * Redige, num texto livre (ex.: Mensagem de erro da Zurich ou de uma
 * BD), tudo o que se parece com dados pessoais ou credenciais.
 *
 * Preserva o que os fluxos usam: "Código 6", nomes de operações
 * ("ObterFicheiroDia") e números curtos.
 *
 * É defensivo (pode redigir de mais, nunca de menos de propósito):
 * não substitui verificar que se está a logar o mínimo.
 */
export function sanitizeZurichText(text: string, maxLength = 300): string {
  let out = text;

  // Credenciais em cabeçalhos ou em query strings.
  out = out.replace(/\b(Basic|Bearer)\s+[A-Za-z0-9+/=._-]{6,}/gi, `$1 ${MASK}`);
  out = out.replace(
    /\b(Token1|Token2|Token|Password|Palavra[-_ ]?Chave|Authorization)\s*[=:]\s*[^&\s,;]+/gi,
    `$1=${MASK}`,
  );

  // Emails.
  out = out.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, `${MASK}@${MASK}`);

  // IBAN (ex.: PT50 + 21 dígitos, com ou sem espaços/hífens).
  out = out.replace(/\b[A-Z]{2}\d{2}(?:[ -]?\d){17,30}\b/g, MASK);

  // NIF com separadores (123 456 789 / 123.456.789).
  out = out.replace(/\b\d{3}[ .]\d{3}[ .]\d{3}\b/g, MASK);

  // Sequências longas de dígitos: NIF, NIB, nº de apólice, telefones.
  out = out.replace(/\b\d{9,}\b/g, MASK);

  // Blocos base64 longos (ficheiros inteiros).
  out = out.replace(/[A-Za-z0-9+/]{40,}={0,2}/g, "[base64 omitido]");

  // Tokens: 20+ alfanuméricos com letras E dígitos (ex.: o token de 22
  // caracteres). Nomes de operações não têm dígitos e ficam intactos.
  out = out.replace(
    /\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{20,}\b/g,
    MASK,
  );

  return out.length > maxLength ? `${out.slice(0, maxLength)}…` : out;
}

export type ZurichErrorSummary = {
  errorKind: string;
  operation?: string;
  zurichCode?: number;
  httpStatus?: number;
};

/**
 * Resume um erro só pela SUA FORMA (tipo, operação, código Zurich,
 * estado HTTP), sem NENHUM texto livre. É a forma segura de registar
 * falhas da Zurich: a Mensagem que a Zurich devolve é texto livre e
 * pode conter nomes ou outros dados pessoais que nenhuma expressão
 * regular consegue apanhar (sanitizeZurichText só cobre números,
 * IBAN, emails, tokens e base64).
 *
 *   "Zurich devolveu erro em ObterFicheiroDia (Código 6) [conta x]: …"
 *     -> { errorKind: "ZURICH_ERROR", operation: "ObterFicheiroDia", zurichCode: 6 }
 *   "Erro Zurich em ObterFicheiroDia (500) [conta x]"
 *     -> { errorKind: "ZURICH_HTTP", operation: "ObterFicheiroDia", httpStatus: 500 }
 *   qualquer outro erro -> { errorKind: <nome do erro> }
 */
export function summarizeZurichError(error: unknown): ZurichErrorSummary {
  const message = error instanceof Error ? error.message : "";

  const zurich = /^Zurich devolveu erro em (\w+) \(C[óo]digo (-?\d+)\)/.exec(
    message,
  );

  if (zurich) {
    return {
      errorKind: "ZURICH_ERROR",
      operation: zurich[1],
      zurichCode: Number(zurich[2]),
    };
  }

  const http = /^Erro Zurich em (\w+) \((\d{3})\)/.exec(message);

  if (http) {
    return {
      errorKind: "ZURICH_HTTP",
      operation: http[1],
      httpStatus: Number(http[2]),
    };
  }

  return { errorKind: error instanceof Error ? error.name : typeof error };
}

/**
 * Cópia (superficial) de `record` com os campos indicados mascarados,
 * para respostas de diagnóstico. Chaves comparadas sem distinguir
 * maiúsculas. Vazio/null ficam como estão (para se ver que está vazio).
 * Não altera o objeto original.
 */
export function maskSensitiveFields<T extends Record<string, unknown>>(
  record: T,
  keys: readonly string[],
): T {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const copy: Record<string, unknown> = { ...record };

  for (const key of Object.keys(copy)) {
    if (!wanted.has(key.toLowerCase())) {
      continue;
    }

    const value = copy[key];

    if (
      (typeof value === "string" && value.trim() !== "") ||
      typeof value === "number"
    ) {
      copy[key] = maskIdentifier(value);
    }
  }

  return copy as T;
}
