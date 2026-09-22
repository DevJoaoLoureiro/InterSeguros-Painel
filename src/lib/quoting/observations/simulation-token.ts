import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  EstimatedQuote,
  QuoteComparison,
  QuoteRequest,
} from "../domain/types";

/*
 * Token assinado (HMAC-SHA256) com o pedido e a previsão Zurich de UMA
 * simulação. SÓ server-side.
 *
 * PORQUÊ. Ao guardar a cotação real, o servidor precisa do pedido e da
 * previsão TAL COMO ERAM. O cliente só guarda a `comparison`; se reenviasse o
 * pedido e a previsão, poderiam ser adulterados ou ficar desfasados do que
 * foi mostrado. O servidor emite este token ao calcular; ao guardar,
 * verifica-o e usa o conteúdo assinado. Assim a UI só envia o token e os
 * campos da cotação real, e o snapshot é imutável e íntegro.
 *
 * CHAVE. Derivada (HMAC com etiqueta fixa) do SUPABASE_SERVICE_ROLE_KEY já
 * existente: sem novas variáveis de ambiente e sem expor a chave de serviço.
 * O token contém dados do pedido (PII) mas só circula entre este servidor e
 * o browser autenticado que o pediu; nunca se regista em logs.
 *
 * VALIDADE. O token expira (TOKEN_MAX_AGE_DAYS): uma cotação real muito
 * depois da simulação pertence a outro momento de mercado.
 */

export const TOKEN_VERSION = "v1";
export const TOKEN_MAX_AGE_DAYS = 14;

const KEY_LABEL = "zurich-quote-observation-snapshot-v1";
const DAY_MS = 86_400_000;

export type SimulationSnapshot = {
  issuedAt: string;
  request: QuoteRequest;
  prediction: EstimatedQuote;
};

export type VerifyResult =
  | { ok: true; snapshot: SimulationSnapshot }
  | { ok: false; reason: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" | "INVALID_PAYLOAD" };

function deriveKey(secret: string): Buffer {
  return createHmac("sha256", secret).update(KEY_LABEL).digest();
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", deriveKey(secret)).update(payload).digest("base64url");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function signSimulationSnapshot(
  snapshot: SimulationSnapshot,
  secret: string,
): string {
  if (!secret) {
    throw new Error("Segredo de assinatura em falta.");
  }

  const payload = Buffer.from(JSON.stringify(snapshot), "utf8").toString("base64url");

  return `${TOKEN_VERSION}.${payload}.${sign(`${TOKEN_VERSION}.${payload}`, secret)}`;
}

export function verifySimulationSnapshot(
  token: unknown,
  secret: string,
  now: Date = new Date(),
): VerifyResult {
  if (typeof token !== "string" || !secret) {
    return { ok: false, reason: "MALFORMED" };
  }

  const parts = token.split(".");

  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
    return { ok: false, reason: "MALFORMED" };
  }

  const [version, payload, signature] = parts;

  const expected = Buffer.from(sign(`${version}.${payload}`, secret));
  const received = Buffer.from(signature);

  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { ok: false, reason: "BAD_SIGNATURE" };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }

  if (
    !isRecord(parsed) ||
    typeof parsed.issuedAt !== "string" ||
    !isRecord(parsed.request) ||
    !isRecord(parsed.prediction)
  ) {
    return { ok: false, reason: "INVALID_PAYLOAD" };
  }

  const issued = Date.parse(parsed.issuedAt);

  if (Number.isNaN(issued) || now.getTime() - issued > TOKEN_MAX_AGE_DAYS * DAY_MS) {
    return { ok: false, reason: "EXPIRED" };
  }

  return {
    ok: true,
    snapshot: {
      issuedAt: parsed.issuedAt,
      request: parsed.request as unknown as QuoteRequest,
      prediction: parsed.prediction as unknown as EstimatedQuote,
    },
  };
}

/** A estimativa Zurich Auto de uma comparação, se existir e tiver valor. */
export function findZurichAutoEstimate(
  comparison: QuoteComparison,
): EstimatedQuote | null {
  const found = comparison.results.find(
    (result): result is EstimatedQuote =>
      result.insurerCode === "ZURICH" &&
      result.productLine === "AUTO" &&
      result.status === "ESTIMATED",
  );

  return found ?? null;
}

/**
 * Emite o token da simulação Zurich (null se não houver estimativa Zurich
 * ou se não for possível assinar; nunca lança para não partir o cálculo).
 */
export function issueZurichSnapshotToken(
  request: QuoteRequest,
  comparison: QuoteComparison,
  secret: string | undefined,
  now: Date = new Date(),
): string | null {
  const prediction = findZurichAutoEstimate(comparison);

  if (!prediction || !secret) return null;

  try {
    return signSimulationSnapshot(
      { issuedAt: now.toISOString(), request, prediction },
      secret,
    );
  } catch {
    // Sem detalhes: o erro pode referir o conteúdo.
    console.error("[simulador] Não foi possível assinar o snapshot da simulação.");

    return null;
  }
}
