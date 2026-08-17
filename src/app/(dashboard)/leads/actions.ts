"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type AssignLeadInput = {
  leadId: string;
  storeId: string;
  commercialId: string;
};

export async function assignLead(
  input: AssignLeadInput,
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Não autenticado.");
  }

  // Verificar quem está a fazer a atribuição
  const {
    data: currentProfile,
    error: profileError,
  } = await supabase
    .from("profiles")
    .select("id, role, active")
    .eq("id", user.id)
    .single();

  if (profileError || !currentProfile) {
    throw new Error(
      "Perfil do utilizador não encontrado.",
    );
  }

  if (currentProfile.role !== "OWNER") {
    throw new Error(
      "Apenas o OWNER pode atribuir leads.",
    );
  }

  if (!currentProfile.active) {
    throw new Error(
      "A tua conta encontra-se desativada.",
    );
  }

  const admin = createAdminClient();

  // Confirmar que a loja existe
  const {
    data: store,
    error: storeError,
  } = await admin
    .from("stores")
    .select("id")
    .eq("id", input.storeId)
    .single();

  if (storeError || !store) {
    throw new Error(
      "A loja selecionada não existe.",
    );
  }

  // Confirmar que o comercial existe,
  // está ativo e pertence à loja escolhida
  const {
    data: commercial,
    error: commercialError,
  } = await admin
    .from("profiles")
    .select(`
      id,
      role,
      active,
      store_id
    `)
    .eq("id", input.commercialId)
    .single();

  if (commercialError || !commercial) {
    throw new Error(
      "Comercial não encontrado.",
    );
  }

  if (commercial.role !== "COMERCIAL") {
    throw new Error(
      "O utilizador selecionado não é comercial.",
    );
  }

  if (!commercial.active) {
    throw new Error(
      "O comercial selecionado está desativado.",
    );
  }

  if (commercial.store_id !== input.storeId) {
    throw new Error(
      "O comercial não pertence à loja selecionada.",
    );
  }

  // Atualizar a lead
  const { error: updateError } = await admin
    .from("leads")
    .update({
      store_id: input.storeId,
      assigned_user_id: input.commercialId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.leadId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  revalidatePath("/leads");

  return {
    success: true,
  };
}