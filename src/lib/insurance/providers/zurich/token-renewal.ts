import {
  criarNovoTokenZurich,
  getZurichAccounts,
  isZurichTokenIssueEnabled,
  splitZurichToken,
  type ZurichAccount,
} from "./client";
import {
  readStoredZurichToken,
  swapZurichTokenStamp,
  writeStoredZurichToken,
} from "./token-store";

/*
 * Renovação do token Zurich. Chamado pelo cron antes de cada sync.
 *
 * Não se sabe quanto tempo dura um token (em 2026-09 um morreu ao fim
 * de ~10 dias). Renova-se todos os dias, muito abaixo de qualquer
 * prazo plausível, para nunca chegar a expirar.
 *
 * Cada token novo INVALIDA o anterior, por isso:
 *   1. só uma instância renova de cada vez (trinco na BD);
 *   2. o token novo é gravado logo; se a gravação falhar, repete-se;
 *   3. nunca se renova a meio de um pedido (isso é só aqui).
 *
 * NUNCA devolver nem registar o token: só o que aconteceu.
 */

/** Idade a partir da qual o cron renova (o cron corre de 30 em 30 min). */
export const TOKEN_RENEW_AFTER_HOURS = 20;

/** Tentativas de gravar o token novo na BD antes de desistir. */
const WRITE_ATTEMPTS = 4;

export type TokenRenewalOutcome = {
  account: string;
  action:
    | "seeded" // 1ª vez: token do env copiado para a BD
    | "fresh" // ainda dentro do prazo, nada a fazer
    | "renewed"
    | "disabled" // ZURICH_ALLOW_TOKEN_ISSUE não é 1
    | "busy" // outra instância está a renovar
    | "failed";
  ageHours: number | null;
  error?: string;
};

function ageHours(updatedAt: string) {
  return Math.floor((Date.now() - Date.parse(updatedAt)) / 3_600_000);
}

function isValidToken(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length !== 22) return false;

  try {
    splitZurichToken(value.trim());
    return true;
  } catch {
    return false;
  }
}

async function renewAccount(
  account: ZurichAccount,
  options: { force?: boolean },
): Promise<TokenRenewalOutcome> {
  let stored = await readStoredZurichToken(account.key, { fresh: true });

  // 1ª vez: o token do env passa para a BD. Não se sabe a idade dele,
  // por isso conta a partir de agora (renova daqui a ~1 dia).
  if (!stored) {
    if (!isValidToken(account.token)) {
      return {
        account: account.key,
        action: "failed",
        ageHours: null,
        error: "Sem token na BD e o token do env está em falta ou é inválido.",
      };
    }

    stored = await writeStoredZurichToken(account.key, account.token.trim());

    if (!options.force) {
      return { account: account.key, action: "seeded", ageHours: 0 };
    }
  }

  const age = ageHours(stored.updatedAt);

  if (!options.force && age < TOKEN_RENEW_AFTER_HOURS) {
    return { account: account.key, action: "fresh", ageHours: age };
  }

  if (!isZurichTokenIssueEnabled()) {
    return { account: account.key, action: "disabled", ageHours: age };
  }

  // Trinco: quem conseguir mudar o carimbo é quem renova. A outra
  // instância vê o carimbo novo (idade 0) e não faz nada.
  const claimedAt = new Date().toISOString();
  const claimed = await swapZurichTokenStamp(
    account.key,
    stored.updatedAt,
    claimedAt,
  );

  if (!claimed) {
    return { account: account.key, action: "busy", ageHours: age };
  }

  let newToken: string;

  try {
    const result = await criarNovoTokenZurich(account);

    if (!isValidToken(result.Token)) {
      throw new Error("A Zurich não devolveu um token válido.");
    }

    newToken = result.Token.trim();
  } catch (error) {
    // Não emitiu: repõe o carimbo para o cron tentar outra vez.
    await swapZurichTokenStamp(account.key, claimedAt, stored.updatedAt).catch(
      () => false,
    );

    return {
      account: account.key,
      action: "failed",
      ageHours: age,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // A partir daqui o token antigo JÁ NÃO VALE: gravar o novo é
  // obrigatório. Insiste antes de desistir.
  let writeError: unknown = null;

  for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt++) {
    try {
      await writeStoredZurichToken(account.key, newToken);
      return { account: account.key, action: "renewed", ageHours: age };
    } catch (error) {
      writeError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }

  console.error(
    "[Zurich] TOKEN EMITIDO MAS NÃO GRAVADO — gerar um novo no MyZurich e gravá-lo em /api/dev/zurich-token",
    { account: account.key },
  );

  return {
    account: account.key,
    action: "failed",
    ageHours: age,
    error: `Token emitido mas não gravado na BD: ${
      writeError instanceof Error ? writeError.message : String(writeError)
    }`,
  };
}

/*
 * Renova o token de cada conta se já tiver idade para isso
 * (force: renova já, seja qual for a idade). Nunca lança: devolve o
 * que aconteceu por conta, para o cron seguir com o sync.
 */
export async function renewZurichTokenIfDue(
  options: { force?: boolean } = {},
): Promise<TokenRenewalOutcome[]> {
  const outcomes: TokenRenewalOutcome[] = [];

  for (const account of getZurichAccounts()) {
    try {
      outcomes.push(await renewAccount(account, options));
    } catch (error) {
      outcomes.push({
        account: account.key,
        action: "failed",
        ageHours: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const outcome of outcomes) {
    if (outcome.action === "renewed" || outcome.action === "failed") {
      console.log("[Zurich] Renovação do token", outcome);
    }
  }

  return outcomes;
}

/* Estado do token por conta (sem o token), para a rota de gestão. */
export async function getZurichTokenStatus() {
  const accounts = getZurichAccounts();

  return Promise.all(
    accounts.map(async (account) => {
      const stored = await readStoredZurichToken(account.key, { fresh: true });

      return {
        account: account.key,
        source: stored ? ("bd" as const) : ("env" as const),
        updatedAt: stored?.updatedAt ?? null,
        ageHours: stored ? ageHours(stored.updatedAt) : null,
        renewAfterHours: TOKEN_RENEW_AFTER_HOURS,
        autoRenewEnabled: isZurichTokenIssueEnabled(),
      };
    }),
  );
}

/* Gravar à mão um token gerado no MyZurich (emergência). */
export async function setZurichTokenManually(
  token: string,
  accountKey?: string,
) {
  const accounts = getZurichAccounts();
  const account = accountKey
    ? accounts.find((a) => a.key === accountKey)
    : accounts.length === 1
      ? accounts[0]
      : undefined;

  if (!account) {
    throw new Error(
      `Indica a conta (account): ${accounts.map((a) => a.key).join(", ")}.`,
    );
  }

  if (!isValidToken(token)) {
    throw new Error("Token inválido: tem de ter 22 caracteres.");
  }

  await writeStoredZurichToken(account.key, token.trim());

  return { account: account.key };
}
