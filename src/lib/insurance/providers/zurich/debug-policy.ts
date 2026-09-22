// =====================================================
// ZURICH - DIAGNÓSTICO ISOLADO (TEMPORÁRIO)
// =====================================================
//
// Mede, separadamente e no mesmo processo, três operações do client
// com a MESMA conta, o MESMO token e o MESMO host (InfoAgente):
//   - obterFicheiroDia          (ficheiro de Apólices de um dia)
//   - obterObjetosPorNrApolice
//   - obterCoberturasPorApolice
// usando a conta cujo storeExternalCode é DEBUG_STORE_CODE.
//
// Serve para saber se a Zurich responde a uma operação enquanto outra
// fica em timeout.
//
// Só LÊ da Zurich, com o token que já está no env. Nunca emite nem
// renova tokens, nunca escreve na BD e não usa o backfill.
//
// A resposta é sanitizada: só indica se cada chamada correu bem, quanto
// demorou e, se falhou, a FORMA do erro (tipo, código Zurich, estado
// HTTP). Nunca devolve conteúdo da Zurich (nem o ficheiro/base64),
// credenciais, tokens, dados pessoais nem o número da apólice.
//
// Como ler o resultado do ficheiro: `ok:false` com `zurichCode` 6 ou 7
// ("sem ficheiro/dados nesse dia") ou com qualquer `httpStatus` significa
// que a Zurich RESPONDEU. Só `errorKind: "ZurichLookupTimeout"` (ou um
// erro de rede) significa que não respondeu.
// =====================================================

import type { ZurichAccount } from "./client";
import { summarizeZurichError } from "./log-safety";

/** storeExternalCode da conta a diagnosticar. */
export const DEBUG_STORE_CODE = "12603";

/** Tempo máximo de CADA chamada (ms). */
export const DEBUG_LOOKUP_TIMEOUT_MS = 15_000;

export type DebugErrorFields = {
  errorKind?: string;
  zurichCode?: number;
  httpStatus?: number;
};

export type DebugLookupOutcome = {
  ok: boolean;
  /** Nº de itens devolvidos (0 se falhou ou se veio vazio). */
  count: number;
  elapsedMs: number;
} & DebugErrorFields;

/** Ficheiro: só se respondeu e quanto demorou. Sem contagem nem conteúdo. */
export type DebugFileOutcome = {
  ok: boolean;
  elapsedMs: number;
} & DebugErrorFields;

export type DebugOnly = "objects" | "coverages" | "file" | "all";

export type DebugPolicyResult =
  | {
      success: true;
      accountResolved: true;
      file?: DebugFileOutcome;
      objects?: DebugLookupOutcome;
      coverages?: DebugLookupOutcome;
    }
  | {
      success: false;
      accountResolved: false;
      error: string;
    };

export type DebugPolicyDeps = {
  getAccounts: () => ZurichAccount[];
  lookupObjects: (
    policyNumber: string,
    account: ZurichAccount,
  ) => Promise<unknown>;
  lookupCoverages: (
    policyNumber: string,
    account: ZurichAccount,
  ) => Promise<unknown>;
  /** Pede o ficheiro de Apólices do dia. O resultado NUNCA é devolvido. */
  lookupFile: (date: string, account: ZurichAccount) => Promise<unknown>;
  /** Relógio em ms (epoch). */
  now: () => number;
};

/** Data (UTC) do dia anterior a `nowMs`, AAAA-MM-DD. */
export function defaultFileDate(nowMs: number): string {
  return new Date(nowMs - 86_400_000).toISOString().slice(0, 10);
}

/** AAAA-MM-DD, data de calendário real e não posterior a hoje (UTC). */
export function isValidFileDate(value: string, nowMs: number): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    return false;
  }

  return value <= new Date(nowMs).toISOString().slice(0, 10);
}

class DebugTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`A Zurich não respondeu em ${timeoutMs} ms.`);
    // Mesmo nome que o timeout do backfill, para o resumo de erro ser igual.
    this.name = "ZurichLookupTimeout";
  }
}

/**
 * Rejeita se `work` não terminar a tempo. A chamada em curso NÃO é
 * cancelada (o client não recebe AbortSignal); o resultado tardio é
 * ignorado, sem unhandled rejection.
 */
function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new DebugTimeoutError(timeoutMs)),
      timeoutMs,
    );

    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function measure(
  work: () => Promise<unknown>,
  timeoutMs: number,
  now: () => number,
): Promise<DebugLookupOutcome> {
  const startedAt = now();

  try {
    const items = await withTimeout(work(), timeoutMs);

    return {
      ok: true,
      count: Array.isArray(items) ? items.length : 0,
      elapsedMs: now() - startedAt,
    };
  } catch (error) {
    const summary = summarizeZurichError(error);

    return {
      ok: false,
      count: 0,
      elapsedMs: now() - startedAt,
      errorKind: summary.errorKind,
      ...(summary.zurichCode !== undefined
        ? { zurichCode: summary.zurichCode }
        : {}),
      ...(summary.httpStatus !== undefined
        ? { httpStatus: summary.httpStatus }
        : {}),
    };
  }
}

export async function runZurichPolicyDebug(
  params: {
    /** Não é usado quando só se pede o ficheiro. */
    policyNumber?: string;
    /**
     * Omissão: objetos + coberturas.
     * "file": só o ficheiro. "all": ficheiro, objetos e coberturas (por
     * esta ordem, em série).
     */
    only?: DebugOnly | null;
    /** AAAA-MM-DD do ficheiro. Omissão: dia anterior (UTC). */
    fileDate?: string;
    timeoutMs?: number;
  },
  deps: DebugPolicyDeps,
): Promise<DebugPolicyResult> {
  const account = deps
    .getAccounts()
    .find((candidate) => candidate.storeExternalCode === DEBUG_STORE_CODE);

  if (!account) {
    return {
      success: false,
      accountResolved: false,
      error: "Nenhuma conta configurada com o storeExternalCode pedido.",
    };
  }

  const timeoutMs =
    typeof params.timeoutMs === "number" &&
    Number.isFinite(params.timeoutMs) &&
    params.timeoutMs > 0
      ? params.timeoutMs
      : DEBUG_LOOKUP_TIMEOUT_MS;

  const only = params.only ?? null;

  const wantFile = only === "file" || only === "all";
  const wantObjects = only === null || only === "objects" || only === "all";
  const wantCoverages =
    only === null || only === "coverages" || only === "all";

  const policyNumber = params.policyNumber ?? "";

  const result: {
    success: true;
    accountResolved: true;
    file?: DebugFileOutcome;
    objects?: DebugLookupOutcome;
    coverages?: DebugLookupOutcome;
  } = { success: true, accountResolved: true };

  // Em série e independentes: a falha de uma não impede as outras, e
  // nunca correm em simultâneo (para não se influenciarem na medição).
  // O ficheiro vai primeiro: é o termo de comparação.
  if (wantFile) {
    const date = params.fileDate ?? defaultFileDate(deps.now());

    // O count é descartado: do ficheiro só interessa se respondeu.
    const { count, ...file } = await measure(
      () => deps.lookupFile(date, account),
      timeoutMs,
      deps.now,
    );

    void count;
    result.file = file;
  }

  if (wantObjects) {
    result.objects = await measure(
      () => deps.lookupObjects(policyNumber, account),
      timeoutMs,
      deps.now,
    );
  }

  if (wantCoverages) {
    result.coverages = await measure(
      () => deps.lookupCoverages(policyNumber, account),
      timeoutMs,
      deps.now,
    );
  }

  return result;
}
