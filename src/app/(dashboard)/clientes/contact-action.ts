"use server";

import { revalidatePath, revalidateTag } from "next/cache";

import { VENCIMENTOS_TAG } from "@/lib/alerts/expiry-alerts";
import { assertClientAccess } from "@/lib/auth/access";
import { pickEmail, pickPhone } from "@/lib/insurance/sync/client-contacts";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Telefone e email do cliente editados à mão (ficha do cliente e
 * separador Anuladas). Há companhias que não enviam contactos
 * (Prévoir), por isso têm de se poder escrever.
 *
 * O sync nunca apaga isto: só preenche contactos que estejam vazios
 * (lib/insurance/sync/client-contacts).
 */
export async function updateClientContacts(
  clientId: string,
  input: { phone?: string | null; email?: string | null },
) {
  if (!clientId) throw new Error("Cliente inválido.");

  await assertClientAccess([clientId]);

  const update: Record<string, string | null> = {};

  if (input.phone !== undefined) {
    const raw = (input.phone ?? "").trim();
    const phone = raw ? pickPhone(raw) : null;

    if (raw && !phone) {
      throw new Error("Telefone inválido: tem de ter pelo menos 9 dígitos.");
    }

    update.phone = phone;
  }

  if (input.email !== undefined) {
    const raw = (input.email ?? "").trim();
    const email = raw ? pickEmail(raw) : null;

    if (raw && !email) {
      throw new Error("Email inválido.");
    }

    update.email = email;
  }

  if (Object.keys(update).length === 0) {
    return { success: true, phone: null, email: null };
  }

  const { data, error } = await createAdminClient()
    .from("clients")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", clientId)
    .select("phone, email")
    .single();

  if (error) {
    throw new Error(`Erro ao guardar contacto: ${error.message}`);
  }

  // A lista das Anuladas (em cache) mostra o telefone.
  revalidateTag(VENCIMENTOS_TAG, "max");
  revalidatePath("/clientes");
  revalidatePath("/vencimentos");

  return {
    success: true,
    phone: data.phone as string | null,
    email: data.email as string | null,
  };
}
