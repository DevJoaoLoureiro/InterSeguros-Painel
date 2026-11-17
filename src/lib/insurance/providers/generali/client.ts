/*
 * GENERALI (ex-Tranquilidade) — API "Digitização V2"
 *
 * Documentação:
 *   - Swagger: https://ws.tranquilidade.pt/invoke/Digitizacao.V2/Documentacao
 *   - Autenticação: https://wsta.tranquilidade.pt/invoke/Digitizacao.V2.Doc/DocumentoTecnico
 *
 * AUTENTICAÇÃO (OAuth 2.0, "Password Grant")
 * - Utilizador APLICACIONAL (não o de um agente) + client_id/secret.
 * - O token dura 12 h e este fluxo não dá refresh_token: pede-se um
 *   novo quando o atual está a acabar. Ao contrário da Zurich, pedir
 *   um token novo NÃO invalida o anterior.
 * - O token vai num cabeçalho chamado "access_token". A documentação
 *   diz que NÃO funciona em "Authorization: Bearer".
 *
 * O utilizador aplicacional só pode usar as operações de leitura
 * da carteira (/clientes, /apolices, /recibos, /carregamentoinicial,
 * /listas, /apolices/{nr}/detalhe). Extratos, documentos de recibo e
 * "cobrar" exigem um utilizador de agente (fluxo Authorization Code)
 * e não estão aqui.
 *
 * AMBIENTES (credenciais diferentes em cada um):
 *   GENERALI_ENV=ta   -> wsta.tranquilidade.pt (testes)
 *   GENERALI_ENV=prod -> ws.tranquilidade.pt   (produção)
 *
 * NUNCA registar o token, a password nem as respostas (têm NIF,
 * moradas, contactos).
 */

import type {
  GeneraliDetalheApolice,
  GeneraliListas,
  GeneraliRecurso,
  GeneraliRespostaRecurso,
} from "./types";

type GeneraliEnv = "ta" | "prod";

const HOSTS: Record<GeneraliEnv, string> = {
  ta: "https://wsta.tranquilidade.pt",
  prod: "https://ws.tranquilidade.pt",
};

const API_PATH = "/rad/Digitizacao.V2.RESTProvider.API:DigitizacaoAPI";
const TOKEN_PATH = "/invoke/Digitizacao.V2.OAuth/token";

/** Tempo máximo de espera por UMA resposta da Generali (ms). */
const REQUEST_TIMEOUT_MS = 30_000;

/*
 * O carregamento inicial é muito mais lento: em 2026-11-17 a 1.ª página
 * passou dos 30 s. Num Worker a espera por rede não conta como CPU, e
 * um Cron Trigger pode correr até 15 min, por isso aguenta.
 */
const INITIAL_LOAD_TIMEOUT_MS = 180_000;

/** Pede token novo quando faltar menos do que isto para expirar. */
const TOKEN_MARGIN_MS = 10 * 60_000;

// -----------------------------------------------------
// CONFIGURAÇÃO
// -----------------------------------------------------

export function getGeneraliEnv(): GeneraliEnv {
  const value = (process.env.GENERALI_ENV ?? "ta").trim().toLowerCase();
  return value === "prod" ? "prod" : "ta";
}

function getConfig() {
  const missing = [
    "GENERALI_USERNAME",
    "GENERALI_PASSWORD",
    "GENERALI_CLIENT_ID",
    "GENERALI_CLIENT_SECRET",
  ].filter((name) => !process.env[name]?.trim());

  if (missing.length > 0) {
    throw new Error(
      `Generali não configurada: falta ${missing.join(", ")}.`,
    );
  }

  const env = getGeneraliEnv();

  return {
    env,
    host: HOSTS[env],
    username: process.env.GENERALI_USERNAME!.trim(),
    password: process.env.GENERALI_PASSWORD!.trim(),
    clientId: process.env.GENERALI_CLIENT_ID!.trim(),
    clientSecret: process.env.GENERALI_CLIENT_SECRET!.trim(),
  };
}

/**
 * Contas de mediador (7 caracteres) a usar no carregamento inicial.
 * GENERALI_CONTAS="1234567,7654321". Vazio: a API usa todas as contas
 * do utilizador.
 */
export function getGeneraliContas(): string[] {
  return (process.env.GENERALI_CONTAS ?? "")
    .split(",")
    .map((conta) => conta.trim())
    .filter(Boolean);
}

// -----------------------------------------------------
// TOKEN
// -----------------------------------------------------

let cachedToken: { value: string; expiresAt: number; env: GeneraliEnv } | null =
  null;

type TokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function requestToken(): Promise<string> {
  const config = getConfig();

  // POST com o corpo em form-urlencoded: a documentação também aceita
  // GET, mas aí a password ficava no URL (e nos logs de quem o vir).
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    username: config.username,
    password: config.password,
    scope: "read write",
  });

  const response = await fetch(`${config.host}${TOKEN_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });

  const data = (await response.json().catch(() => ({}))) as TokenResponse;

  if (!response.ok || !data.access_token) {
    // error/error_description são do OAuth (RFC 6749): não trazem
    // dados de clientes nem as credenciais.
    throw new Error(
      `Generali: falha ao obter token (${response.status}) [${config.env}]: ${
        data.error ?? "sem código"
      }${data.error_description ? ` — ${data.error_description.trim()}` : ""}`,
    );
  }

  const expiresInSeconds = Number(data.expires_in) || 12 * 3600;

  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + expiresInSeconds * 1000,
    env: config.env,
  };

  console.log("[Generali] Token obtido", {
    env: config.env,
    expiresInSeconds,
    scope: data.scope ?? null,
  });

  return data.access_token;
}

async function getToken(options: { fresh?: boolean } = {}): Promise<string> {
  const env = getGeneraliEnv();

  if (
    !options.fresh &&
    cachedToken &&
    cachedToken.env === env &&
    cachedToken.expiresAt - Date.now() > TOKEN_MARGIN_MS
  ) {
    return cachedToken.value;
  }

  return requestToken();
}

/** Só para testes: confirma que as credenciais funcionam. */
export async function testGeneraliLogin() {
  const startedAt = Date.now();
  await getToken({ fresh: true });

  return {
    env: getGeneraliEnv(),
    durationMs: Date.now() - startedAt,
    expiresAt: cachedToken ? new Date(cachedToken.expiresAt).toISOString() : null,
  };
}

// -----------------------------------------------------
// PEDIDOS
// -----------------------------------------------------

type QueryValue = string | string[] | undefined | null;

export class GeneraliHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly operation: string,
  ) {
    super(message);
    this.name = "GeneraliHttpError";
  }
}

async function generaliRequest<T>(
  path: string,
  query: Record<string, QueryValue> = {},
  { isRetry = false, timeoutMs = REQUEST_TIMEOUT_MS }: { isRetry?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const { host } = getConfig();
  const token = await getToken({ fresh: isRetry });

  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;

    // Arrays em "multi": Contas=a&Contas=b (ver Swagger).
    for (const item of Array.isArray(value) ? value : [value]) {
      params.append(key, item);
    }
  }

  const url = `${host}${API_PATH}${path}${params.size > 0 ? `?${params}` : ""}`;
  // Operação para os logs: o caminho sem números de apólice/recibo.
  const operation = path.replace(/\/[^/]*\d[^/]*(?=\/|$)/g, "/{id}");
  const startedAt = Date.now();

  const response = await fetch(url, {
    method: "GET",
    headers: { access_token: token, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  }).catch((error: unknown) => {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new GeneraliHttpError(
        `A Generali não respondeu em ${timeoutMs / 1000} s (${operation})`,
        0,
        operation,
      );
    }

    throw error;
  });

  const durationMs = Date.now() - startedAt;

  // 401: o token pode ter sido revogado antes do prazo. Pede um novo
  // e repete UMA vez (aqui não há o risco da Zurich: um token novo
  // não invalida o anterior).
  if (response.status === 401 && !isRetry) {
    await response.body?.cancel().catch(() => undefined);
    cachedToken = null;
    return generaliRequest<T>(path, query, { isRetry: true, timeoutMs });
  }

  if (!response.ok) {
    // O corpo não entra no erro nem nos logs: pode repetir dados do
    // pedido ou do cliente.
    await response.body?.cancel().catch(() => undefined);

    console.warn("[Generali] Pedido falhou", {
      operation,
      status: response.status,
      durationMs,
    });

    throw new GeneraliHttpError(
      `Erro Generali em ${operation} (${response.status})`,
      response.status,
      operation,
    );
  }

  const data = (await response.json()) as T;

  console.log("[Generali] Pedido concluído", {
    operation,
    status: response.status,
    durationMs,
  });

  return data;
}

// -----------------------------------------------------
// OPERAÇÕES
// -----------------------------------------------------

const RECURSO_PATHS: Record<GeneraliRecurso, string> = {
  Apolices: "/apolices",
  Recibos: "/recibos",
  Clientes: "/clientes",
};

/**
 * Uma página de /apolices, /recibos ou /clientes.
 *
 * Modos (ver "Modo de funcionamento" na documentação):
 * - sem nada: registos novos/alterados nos últimos 7 dias + 1.º SyncToken;
 * - syncToken: continua de onde ficou (modo recomendado);
 * - dataInicio + dataFim (máx. 7 dias): só para correções pontuais.
 */
export function obterPaginaRecurso(
  recurso: GeneraliRecurso,
  options: {
    syncToken?: string | null;
    dataInicio?: string;
    dataFim?: string;
    contaMediador?: string;
  } = {},
): Promise<GeneraliRespostaRecurso> {
  return generaliRequest<GeneraliRespostaRecurso>(RECURSO_PATHS[recurso], {
    SyncToken: options.syncToken,
    DataInicio: options.syncToken ? undefined : options.dataInicio,
    DataFim: options.syncToken ? undefined : options.dataFim,
    ContaMediador: recurso === "Clientes" ? undefined : options.contaMediador,
  });
}

/** Uma página do carregamento inicial (histórico completo). */
export function obterPaginaCarregamentoInicial(
  recurso: GeneraliRecurso,
  options: { syncToken?: string | null; contas?: string[] } = {},
): Promise<GeneraliRespostaRecurso> {
  return generaliRequest<GeneraliRespostaRecurso>(
    "/carregamentoinicial",
    {
      Tipo: recurso,
      // Na continuação basta o SyncToken.
      Contas: options.syncToken ? undefined : options.contas,
      SyncToken: options.syncToken,
    },
    { timeoutMs: INITIAL_LOAD_TIMEOUT_MS },
  );
}

/** Uma apólice pelo número (dados básicos, como em /apolices). */
export async function obterApolicePorNr(nrApolice: string) {
  const result = await generaliRequest<GeneraliRespostaRecurso>("/apolices", {
    NrApolice: nrApolice,
  });

  return result.Apolices?.[0] ?? null;
}

/** Um recibo pelo número. */
export async function obterReciboPorNr(nrRecibo: string) {
  const result = await generaliRequest<GeneraliRespostaRecurso>("/recibos", {
    NrRecibo: nrRecibo,
  });

  return result.Recibos?.[0] ?? null;
}

/** Um cliente pelo número interno da Generali (NrTomador). */
export async function obterClientePorNr(nrCliente: string) {
  const result = await generaliRequest<GeneraliRespostaRecurso>("/clientes", {
    NrCliente: nrCliente,
  });

  return result.Clientes?.[0] ?? null;
}

/** Coberturas, franquias e dados do veículo de uma apólice. */
export function obterDetalheApolice(
  nrApolice: string,
): Promise<GeneraliDetalheApolice> {
  return generaliRequest<GeneraliDetalheApolice>(
    `/apolices/${encodeURIComponent(nrApolice)}/detalhe`,
  );
}

/** Tabela de códigos (estados, fracionamentos, tipos de recibo…). */
export function obterListas(
  options: { servico?: string; campo?: string } = {},
): Promise<GeneraliListas> {
  return generaliRequest<GeneraliListas>("/listas", {
    Servico: options.servico,
    Campo: options.campo,
  });
}

/** "SIM" / "NAO" da API -> boolean. */
export function temMaisRegistos(pagina: { MaisRegistos?: string }): boolean {
  return (pagina.MaisRegistos ?? "").trim().toUpperCase() === "SIM";
}
