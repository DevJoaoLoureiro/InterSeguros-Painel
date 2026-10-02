import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Controlo de acesso por loja para dados de clientes/apólices/recibos.
 *
 * As server actions usam o cliente admin (service role, ignora RLS),
 * por isso a verificação TEM de ser feita aqui — senão qualquer
 * utilizador autenticado lia qualquer cliente sabendo o ID.
 *
 * Regra (igual à da carteira e dos vencimentos):
 * - OWNER/ADMIN veem tudo;
 * - restantes veem clientes com pelo menos uma apólice da sua loja
 *   ou ainda sem loja (ex.: Zurich por associar).
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
    isAdmin: profile.role === "OWNER" || profile.role === "ADMIN",
    storeId: profile.store?.id ?? null,
  };
}

/* Só OWNER/ADMIN (secção GESTÃO, fechos oficiais, configurações). */
export async function requireAdmin() {
  const context = await requireProfile();

  if (!context.isAdmin) {
    throw new AccessDeniedError("Só administradores podem fazer isto.");
  }

  return context;
}

/*
 * Loja efetiva de um pedido. Server actions recebem o storeId do
 * browser, por isso é aqui que se decide: OWNER/ADMIN escolhem
 * qualquer loja (ou todas → null); restantes ficam SEMPRE na sua.
 */
export async function resolveStoreScope(requested: string | null | undefined) {
  const context = await requireProfile();

  if (context.isAdmin) {
    return requested && requested !== "all" ? requested : null;
  }

  if (!context.storeId) {
    throw new AccessDeniedError("O utilizador não tem uma loja associada.");
  }

  return context.storeId;
}

/* Para ações que recebem uma loja concreta: não-admins só a sua. */
export async function assertStoreAccess(storeId: string) {
  const context = await requireProfile();

  if (!context.isAdmin && storeId !== context.storeId) {
    throw new AccessDeniedError("Não tens acesso a esta loja.");
  }

  return context;
}

function storeFilter(storeId: string) {
  return `issuing_store_id.eq.${storeId},issuing_store_id.is.null`;
}

export async function assertClientAccess(clientIds: string[]) {
  const context = await requireProfile();

  if (context.isAdmin) return context;

  if (!context.storeId) {
    throw new AccessDeniedError("O utilizador não tem uma loja associada.");
  }

  const ids = clientIds.filter(Boolean);
  if (ids.length === 0) throw new AccessDeniedError();

  const { count, error } = await createAdminClient()
    .from("policies")
    .select("id", { count: "exact", head: true })
    .in("client_id", ids)
    .or(storeFilter(context.storeId));

  if (error) throw new Error(`Erro a validar acesso: ${error.message}`);
  if (!count) throw new AccessDeniedError("Não tens acesso a este cliente.");

  return context;
}

export async function assertPolicyAccess(policyId: string) {
  const context = await requireProfile();

  if (context.isAdmin) return context;

  if (!context.storeId) {
    throw new AccessDeniedError("O utilizador não tem uma loja associada.");
  }

  const { data, error } = await createAdminClient()
    .from("policies")
    .select("issuing_store_id")
    .eq("id", policyId)
    .maybeSingle();

  if (error) throw new Error(`Erro a validar acesso: ${error.message}`);

  if (
    !data ||
    (data.issuing_store_id !== null &&
      data.issuing_store_id !== context.storeId)
  ) {
    throw new AccessDeniedError("Não tens acesso a esta apólice.");
  }

  return context;
}

export async function assertReceiptAccess(receiptId: string) {
  const context = await requireProfile();

  if (context.isAdmin) return context;

  const { data, error } = await createAdminClient()
    .from("receipts")
    .select("policy_id")
    .eq("id", receiptId)
    .maybeSingle();

  if (error) throw new Error(`Erro a validar acesso: ${error.message}`);
  if (!data?.policy_id) throw new AccessDeniedError("Recibo não encontrado.");

  return assertPolicyAccess(data.policy_id);
}
