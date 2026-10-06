import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Contactos do cliente (telefone, email) vindos das companhias.
 *
 * Regra: a companhia só PREENCHE o que está vazio. Um contacto já
 * gravado no CRM (escrito à mão ou vindo de outra companhia) nunca é
 * substituído pelo sync.
 */

/* Primeiro candidato que parece um telefone a sério (≥ 9 dígitos). */
export function pickPhone(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;

    const cleaned = candidate.replace(/[^\d+]/g, "");
    const digits = cleaned.replace(/\D/g, "");

    // Menos de 9 dígitos ou tudo o mesmo dígito (000000000): lixo.
    if (digits.length < 9 || /^(\d)\1+$/.test(digits)) continue;

    return cleaned;
  }

  return null;
}

export function pickEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const email = value.trim().toLowerCase();

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/*
 * Grava telefone/email só nas colunas que estão vazias. Devolve o que
 * foi efetivamente preenchido.
 */
export async function fillMissingContacts(
  supabase: SupabaseClient,
  clientId: string,
  contacts: { phone?: string | null; email?: string | null },
): Promise<{ phone: boolean; email: boolean }> {
  const filled = { phone: false, email: false };

  for (const column of ["phone", "email"] as const) {
    const value = contacts[column];
    if (!value) continue;

    const { data, error } = await supabase
      .from("clients")
      .update({ [column]: value, updated_at: new Date().toISOString() })
      .eq("id", clientId)
      .or(`${column}.is.null,${column}.eq.`)
      .select("id");

    if (error) {
      throw new Error(`Erro ao gravar ${column} do cliente: ${error.message}`);
    }

    filled[column] = (data ?? []).length > 0;
  }

  return filled;
}
