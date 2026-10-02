import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { hasFullAccess } from "@/lib/auth/permissions";

/*
 * Controlo de acesso nas server actions (que usam o cliente admin,
 * ignorando RLS — por isso a verificação TEM de ser feita aqui).
 *
 * Regra: por FUNÇÃO, sem lojas.
 * - Não há restrição por loja: qualquer utilizador pode trabalhar
 *   clientes de qualquer loja (férias de um colega, etc.). A loja é
 *   só um filtro escolhido no seletor do topo.
 * - Dados de UM cliente (ficha, apólices, recibos desse cliente):
 *   qualquer utilizador com sessão — a IA e o simulador precisam.
 * - Áreas da agência (listas de clientes/recibos/vencimentos,
 *   carteira, comissões, estatísticas, gestão): só OWNER/ADMIN
 *   → requireAdmin / resolveStoreScope / assertStoreAccess.
 */

export class AccessDeniedError extends Error {
  constructor(message = "Não tens acesso a estes dados.") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export async function requireProfile() {
  const profile = await getCurrentProfile();

  if (!profile) throw new Error("Não autenticado.");

  return {
    profile,
    isAdmin: hasFullAccess(profile.role),
    storeId: profile.store?.id ?? null,
  };
}

/* Só OWNER/ADMIN (áreas da agência, gestão, configurações). */
export async function requireAdmin() {
  const context = await requireProfile();

  if (!context.isAdmin) {
    throw new AccessDeniedError("Só administradores podem fazer isto.");
  }

  return context;
}

/*
 * Loja pedida → filtro de consulta ("all"/vazio = todas). Qualquer
 * utilizador com sessão (sem restrição por loja).
 */
export async function resolveStoreScope(requested: string | null | undefined) {
  await requireProfile();

  return requested && requested !== "all" ? requested : null;
}

/* Áreas da agência que recebem uma loja concreta (só OWNER/ADMIN). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function assertStoreAccess(_storeId: string) {
  return requireAdmin();
}

/*
 * Dados de um cliente / apólice / recibo: qualquer utilizador com
 * sessão (sem restrição de loja). Mantidas como funções próprias para
 * que, se a regra mudar, mude só aqui.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function assertClientAccess(_clientIds: string[]) {
  return requireProfile();
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function assertPolicyAccess(_policyId: string) {
  return requireProfile();
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function assertReceiptAccess(_receiptId: string) {
  return requireProfile();
}
