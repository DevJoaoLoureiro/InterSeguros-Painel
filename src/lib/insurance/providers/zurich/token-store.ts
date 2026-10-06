import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Onde vive o token Zurich: tabela integration_tokens (uma linha por
 * conta), não o env.
 *
 * Porquê: o token é renovado todos os dias (ver token-renewal.ts) e
 * cada token novo invalida o anterior. Com o token na BD, a Vercel e o
 * computador de desenvolvimento leem sempre o mesmo; no env, cada
 * renovação obrigaria a copiá-lo à mão para os dois sítios.
 *
 * O env (ZURICH_TOKEN / "token" em ZURICH_ACCOUNTS) só serve para
 * ARRANCAR: é usado enquanto não existir linha na BD para a conta.
 *
 * NUNCA registar o token em logs nem devolvê-lo em respostas.
 */

const TABLE = "integration_tokens";

// Outra instância pode ter renovado entretanto: a memória só vale isto.
const MEMORY_TTL_MS = 60_000;

export type StoredZurichToken = {
  token: string;
  // Data da última emissão/gravação (serve de "idade" do token).
  updatedAt: string;
};

const memory = new Map<string, { value: StoredZurichToken; at: number }>();

function providerKey(accountKey: string) {
  return `zurich:${accountKey}`;
}

export function forgetCachedZurichToken(accountKey: string) {
  memory.delete(accountKey);
}

/* Token gravado para a conta, ou null se ainda não há (usa-se o env). */
export async function readStoredZurichToken(
  accountKey: string,
  options: { fresh?: boolean } = {},
): Promise<StoredZurichToken | null> {
  const cached = memory.get(accountKey);

  if (!options.fresh && cached && Date.now() - cached.at < MEMORY_TTL_MS) {
    return cached.value;
  }

  const { data, error } = await createAdminClient()
    .from(TABLE)
    .select("token, updated_at")
    .eq("provider", providerKey(accountKey))
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao ler o token Zurich da BD: ${error.message}`);
  }

  if (!data?.token) {
    memory.delete(accountKey);
    return null;
  }

  const value = { token: data.token as string, updatedAt: data.updated_at as string };
  memory.set(accountKey, { value, at: Date.now() });

  return value;
}

/* Grava (ou substitui) o token da conta. */
export async function writeStoredZurichToken(
  accountKey: string,
  token: string,
): Promise<StoredZurichToken> {
  const updatedAt = new Date().toISOString();

  const { error } = await createAdminClient()
    .from(TABLE)
    .upsert(
      { provider: providerKey(accountKey), token, updated_at: updatedAt },
      { onConflict: "provider" },
    );

  if (error) {
    throw new Error(`Erro ao gravar o token Zurich na BD: ${error.message}`);
  }

  const value = { token, updatedAt };
  memory.set(accountKey, { value, at: Date.now() });

  return value;
}

/*
 * Troca atómica do carimbo de data: só altera se a linha ainda tiver o
 * `expected`. É o "trinco" da renovação — duas instâncias a renovar ao
 * mesmo tempo anulariam o token uma à outra. Devolve true se ganhou.
 */
export async function swapZurichTokenStamp(
  accountKey: string,
  expected: string,
  next: string,
): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from(TABLE)
    .update({ updated_at: next })
    .eq("provider", providerKey(accountKey))
    .eq("updated_at", expected)
    .select("provider");

  if (error) {
    throw new Error(`Erro ao reservar a renovação do token: ${error.message}`);
  }

  memory.delete(accountKey);

  return (data ?? []).length > 0;
}
