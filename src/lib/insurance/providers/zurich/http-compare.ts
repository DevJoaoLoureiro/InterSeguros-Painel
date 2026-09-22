// =====================================================
// ZURICH - COMPARAÇÃO DE CLIENTES HTTP (TEMPORÁRIO)
// =====================================================
//
// Faz a MESMA chamada Zurich (ObterFicheiroDia), em série, com dois
// clientes HTTP diferentes do Node:
//   1) fetch  (o que o client.ts usa: undici, via Next)
//   2) https.request nativo
// com o mesmo host, path, Basic Auth, AgenteNr, Token1, Token2,
// TipoFicheiro e Data, e os mesmos headers explícitos.
//
// Objetivo: saber se o fetch fica pendurado enquanto o https.request
// nativo responde (ou o contrário).
//
// NÃO altera o client.ts, não escreve na BD, não emite nem renova
// tokens (só usa o do env) e não usa o backfill.
//
// A resposta é sanitizada: só diz se cada cliente obteve resposta, em
// quanto tempo, e a FORMA do erro. Nunca inclui o URL (nem a query),
// tokens, credenciais, nem qualquer conteúdo da Zurich (o ficheiro em
// base64 é lido em memória, interpretado e descartado).
// =====================================================

import https from "node:https";
import zlib from "node:zlib";

import type { ZurichAccount } from "./client";

export const HTTP_COMPARE_TIMEOUT_MS = 15_000;

/** Limite de corpo lido pelo https.request (o fetch não tem, como no client). */
const MAX_BODY_BYTES = 30 * 1024 * 1024;

// Iguais aos do client.ts (getUrls().consultas). Um teste compara-os com
// o pedido que o client realmente monta, para não haver divergência.
const CONSULTAS_PROD =
  "https://myzurich.zurich.com.pt/ZurichServicos/rest/InfoAgente/";
const CONSULTAS_UAT =
  "https://uat-myzurich-pt.zurich.com/ZurichServicos/rest/InfoAgente/";

// Igual ao User-Agent que o client.ts envia.
const CLIENT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export type HttpAttemptOutcome = {
  ok: boolean;
  elapsedMs: number;
  /** Tempo até chegarem os cabeçalhos da resposta (se chegaram). */
  headersMs?: number;
  httpStatus?: number;
  errorKind?: string;
  /** Código de sistema do erro (ex.: ECONNRESET, UND_ERR_*), se houver. */
  errorCode?: string;
  zurichCode?: number;
};

export type HttpCompareResult = {
  success: true;
  fetch: HttpAttemptOutcome;
  httpsRequest: HttpAttemptOutcome;
};

export type HttpCompareDeps = {
  /** Liga tarde ao fetch/https.request atuais (permite simular nos testes). */
  fetchFn: (input: string, init: RequestInit) => Promise<Response>;
  requestFn: (
    url: URL,
    options: https.RequestOptions,
    callback: (res: import("node:http").IncomingMessage) => void,
  ) => import("node:http").ClientRequest;
  createAgent: () => import("node:http").Agent;
  now: () => number;
};

export const defaultHttpCompareDeps: HttpCompareDeps = {
  fetchFn: (input, init) => globalThis.fetch(input, init),
  requestFn: (url, options, callback) => https.request(url, options, callback),
  createAgent: () => new https.Agent({ keepAlive: false }),
  now: () => Date.now(),
};

export type HttpCompareParams = {
  account: ZurichAccount;
  /** Token1/Token2 já derivados do token do env (splitZurichToken). */
  token1: string;
  token2: string;
  /** AAAA-MM-DD */
  date: string;
  /** Qual corre primeiro (para excluir efeito de ordem). Omissão: fetch. */
  first?: "fetch" | "https";
  timeoutMs?: number;
  /** Só para testes (servidor local). Omissão: o host do ZURICH_ENV. */
  baseUrl?: string;
  /** TipoFicheiro. Omissão: 1 (Apólices). */
  tipoFicheiro?: number;
  maxBodyBytes?: number;
};

/** Base InfoAgente segundo ZURICH_ENV (mesma regra do client.ts). */
export function resolveConsultasBase(env: string | undefined): string {
  return (env || "uat").toLowerCase() === "prod"
    ? CONSULTAS_PROD
    : CONSULTAS_UAT;
}

/**
 * URL e headers do pedido, montados como o client.ts os monta
 * (zurichRequest): AgenteNr, Token1, Token2 e depois TipoFicheiro, Data.
 */
export function buildFicheiroDiaRequest(params: {
  account: ZurichAccount;
  token1: string;
  token2: string;
  date: string;
  tipoFicheiro: number;
  baseUrl: string;
}): { url: URL; headers: Record<string, string> } {
  const query = new URLSearchParams({
    AgenteNr: params.account.agenteNr,
    Token1: params.token1,
    Token2: params.token2,
  });

  query.set("TipoFicheiro", String(params.tipoFicheiro));
  query.set("Data", params.date);

  const basicAuth = Buffer.from(
    `${params.account.username}:${params.account.password}`,
  ).toString("base64");

  return {
    url: new URL(
      `${params.baseUrl.replace(/\/+$/, "")}/ObterFicheiroDia?${query.toString()}`,
    ),
    headers: {
      Authorization: `Basic ${basicAuth}`,
      Accept: "application/json",
      "User-Agent": CLIENT_USER_AGENT,
    },
  };
}

class CompareTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Sem resposta em ${timeoutMs} ms.`);
    this.name = "ZurichLookupTimeout";
  }
}

function safeCode(error: unknown): string | undefined {
  const raw =
    (error as { code?: unknown })?.code ??
    (error as { cause?: { code?: unknown } })?.cause?.code;

  return typeof raw === "string" && /^[A-Z0-9_]{3,40}$/.test(raw)
    ? raw
    : undefined;
}

function failure(
  error: unknown,
  elapsedMs: number,
  extra: { headersMs?: number; httpStatus?: number } = {},
): HttpAttemptOutcome {
  const code = safeCode(error);

  return {
    ok: false,
    elapsedMs,
    ...(extra.headersMs !== undefined ? { headersMs: extra.headersMs } : {}),
    ...(extra.httpStatus !== undefined ? { httpStatus: extra.httpStatus } : {}),
    errorKind:
      error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(error.name)
        ? error.name
        : "Error",
    ...(code ? { errorCode: code } : {}),
  };
}

/**
 * Interpreta a resposta: estado HTTP e, se for JSON, CodigoErro/Successo.
 * Nunca devolve conteúdo.
 */
function interpret(
  httpStatus: number,
  bodyText: string,
): Pick<HttpAttemptOutcome, "ok" | "errorKind" | "zurichCode"> {
  const success = httpStatus >= 200 && httpStatus < 300;

  let data: Record<string, unknown> | null = null;

  try {
    const parsed: unknown = JSON.parse(bodyText);

    data =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
  } catch {
    data = null;
  }

  if (!success) {
    return { ok: false, errorKind: "ZURICH_HTTP" };
  }

  if (!data) {
    return { ok: false, errorKind: "ResponseNotJson" };
  }

  const flag = data.Successo ?? data.Sucesso;
  const code = data.CodigoErro;

  if (flag === false || (code !== undefined && code !== 0)) {
    return {
      ok: false,
      errorKind: "ZURICH_ERROR",
      ...(typeof code === "number" ? { zurichCode: code } : {}),
    };
  }

  return { ok: true };
}

// ---------- 1) fetch ----------

async function attemptFetch(
  request: { url: URL; headers: Record<string, string> },
  timeoutMs: number,
  deps: HttpCompareDeps,
): Promise<HttpAttemptOutcome> {
  const startedAt = deps.now();
  const controller = new AbortController();

  let headersMs: number | undefined;
  let httpStatus: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CompareTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  const work = (async (): Promise<HttpAttemptOutcome> => {
    const response = await deps.fetchFn(request.url.toString(), {
      method: "GET",
      headers: request.headers,
      cache: "no-store",
      signal: controller.signal,
    });

    headersMs = deps.now() - startedAt;
    httpStatus = response.status;

    const text = await response.text();

    return {
      elapsedMs: deps.now() - startedAt,
      headersMs,
      httpStatus,
      ...interpret(response.status, text),
    };
  })();

  // Se o timeout ganhar, a rejeição tardia de `work` (abort) fica tratada.
  work.catch(() => undefined);

  try {
    return await Promise.race([work, timeout]);
  } catch (error) {
    return failure(error, deps.now() - startedAt, { headersMs, httpStatus });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

// ---------- 2) https.request nativo ----------

function decodeBody(
  raw: Buffer,
  encoding: string | string[] | undefined,
): string {
  const kind = String(encoding ?? "").toLowerCase();

  if (kind.includes("gzip")) {
    return zlib.gunzipSync(raw).toString("utf8");
  }

  if (kind.includes("br")) {
    return zlib.brotliDecompressSync(raw).toString("utf8");
  }

  if (kind.includes("deflate")) {
    return zlib.inflateSync(raw).toString("utf8");
  }

  return raw.toString("utf8");
}

function attemptHttps(
  request: { url: URL; headers: Record<string, string> },
  timeoutMs: number,
  maxBodyBytes: number,
  deps: HttpCompareDeps,
): Promise<HttpAttemptOutcome> {
  return new Promise<HttpAttemptOutcome>((resolve) => {
    const startedAt = deps.now();
    const agent = deps.createAgent();

    let settled = false;
    let headersMs: number | undefined;
    let httpStatus: number | undefined;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (outcome: HttpAttemptOutcome) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timer) {
        clearTimeout(timer);
      }

      agent.destroy();
      resolve(outcome);
    };

    const fail = (error: unknown) =>
      finish(
        failure(error, deps.now() - startedAt, { headersMs, httpStatus }),
      );

    const req = deps.requestFn(
      request.url,
      { method: "GET", headers: request.headers, agent },
      (res) => {
        headersMs = deps.now() - startedAt;
        httpStatus = res.statusCode ?? 0;

        const chunks: Buffer[] = [];
        let size = 0;

        res.on("data", (chunk: Buffer) => {
          size += chunk.length;

          if (size > maxBodyBytes) {
            const error = new Error("Resposta demasiado grande.");
            error.name = "ResponseTooLarge";
            fail(error);
            req.destroy();
            return;
          }

          chunks.push(chunk);
        });

        res.on("end", () => {
          try {
            const text = decodeBody(
              Buffer.concat(chunks),
              res.headers["content-encoding"],
            );

            finish({
              elapsedMs: deps.now() - startedAt,
              headersMs,
              httpStatus,
              ...interpret(httpStatus ?? 0, text),
            });
          } catch (error) {
            fail(error);
          }
        });

        res.on("error", fail);
        res.on("aborted", () => {
          const error = new Error("Resposta abortada.");
          error.name = "ResponseAborted";
          fail(error);
        });
      },
    );

    req.on("error", fail);

    timer = setTimeout(() => {
      fail(new CompareTimeoutError(timeoutMs));
      req.destroy();
    }, timeoutMs);

    req.end();
  });
}

export async function runHttpCompare(
  params: HttpCompareParams,
  deps: HttpCompareDeps = defaultHttpCompareDeps,
): Promise<HttpCompareResult> {
  const timeoutMs =
    typeof params.timeoutMs === "number" &&
    Number.isFinite(params.timeoutMs) &&
    params.timeoutMs > 0
      ? params.timeoutMs
      : HTTP_COMPARE_TIMEOUT_MS;

  const maxBodyBytes =
    typeof params.maxBodyBytes === "number" && params.maxBodyBytes > 0
      ? params.maxBodyBytes
      : MAX_BODY_BYTES;

  // O MESMO pedido para os dois clientes.
  const request = buildFicheiroDiaRequest({
    account: params.account,
    token1: params.token1,
    token2: params.token2,
    date: params.date,
    tipoFicheiro: params.tipoFicheiro ?? 1,
    baseUrl: params.baseUrl ?? resolveConsultasBase(process.env.ZURICH_ENV),
  });

  // Em série: nunca em simultâneo, para não se influenciarem.
  let fetchOutcome: HttpAttemptOutcome;
  let httpsOutcome: HttpAttemptOutcome;

  if (params.first === "https") {
    httpsOutcome = await attemptHttps(request, timeoutMs, maxBodyBytes, deps);
    fetchOutcome = await attemptFetch(request, timeoutMs, deps);
  } else {
    fetchOutcome = await attemptFetch(request, timeoutMs, deps);
    httpsOutcome = await attemptHttps(request, timeoutMs, maxBodyBytes, deps);
  }

  return { success: true, fetch: fetchOutcome, httpsRequest: httpsOutcome };
}
