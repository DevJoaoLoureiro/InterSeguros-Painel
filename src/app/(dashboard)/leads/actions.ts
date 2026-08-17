"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type AssignLeadInput = {
  leadId: string;
  storeId: string;
  commercialId: string;
};

async function requireOwner() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Não autenticado.");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role, active")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    throw new Error("Perfil não encontrado.");
  }

  if (!profile.active) {
    throw new Error("Conta desativada.");
  }

  if (profile.role !== "OWNER") {
    throw new Error(
      "Apenas o OWNER pode gerir atribuições.",
    );
  }

  return user;
}

async function validateCommercial(
  storeId: string,
  commercialId: string,
) {
  const admin = createAdminClient();

  const { data: commercial, error } = await admin
    .from("profiles")
    .select(`
      id,
      full_name,
      role,
      active,
      store_id
    `)
    .eq("id", commercialId)
    .single();

  if (error || !commercial) {
    throw new Error("Comercial não encontrado.");
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

  if (commercial.store_id !== storeId) {
    throw new Error(
      "O comercial não pertence à loja selecionada.",
    );
  }

  return commercial;
}

export async function assignLead(
  input: AssignLeadInput,
) {
  await requireOwner();

  const admin = createAdminClient();

  await validateCommercial(
    input.storeId,
    input.commercialId,
  );

  const { data: lead, error: leadError } = await admin
    .from("leads")
    .select("id, assigned_user_id")
    .eq("id", input.leadId)
    .single();

  if (leadError || !lead) {
    throw new Error("Lead não encontrada.");
  }

  if (lead.assigned_user_id) {
    throw new Error(
      "Esta lead já está atribuída. Usa a opção de reatribuição.",
    );
  }

  const { error } = await admin
    .from("leads")
    .update({
      store_id: input.storeId,
      assigned_user_id: input.commercialId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.leadId)
    .is("assigned_user_id", null);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/leads");

  return {
    success: true,
  };
}

export async function reassignLead(
  input: AssignLeadInput,
) {
  const owner = await requireOwner();

  const admin = createAdminClient();

  const newCommercial = await validateCommercial(
    input.storeId,
    input.commercialId,
  );

  const { data: lead, error: leadError } = await admin
    .from("leads")
    .select(`
      id,
      store_id,
      assigned_user_id
    `)
    .eq("id", input.leadId)
    .single();

  if (leadError || !lead) {
    throw new Error("Lead não encontrada.");
  }

  if (!lead.assigned_user_id) {
    throw new Error(
      "Esta lead ainda não está atribuída.",
    );
  }

  if (
    lead.assigned_user_id === input.commercialId &&
    lead.store_id === input.storeId
  ) {
    throw new Error(
      "A lead já está atribuída a esse comercial.",
    );
  }

  const previousCommercialId =
    lead.assigned_user_id;

  const previousStoreId =
    lead.store_id;

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

  // Se a tua tabela lead_history existir,
  // guarda o histórico da reatribuição.
  const { error: historyError } = await admin
    .from("lead_history")
    .insert({
      lead_id: input.leadId,
      event_type: "lead_reassigned",
      description: `Lead reatribuída para ${newCommercial.full_name}.`,
      metadata: {
        changed_by: owner.id,
        previous_commercial_id:
          previousCommercialId,
        new_commercial_id:
          input.commercialId,
        previous_store_id:
          previousStoreId,
        new_store_id:
          input.storeId,
      },
    });

  if (historyError) {
    console.error(
      "Não foi possível guardar histórico da reatribuição:",
      historyError,
    );
  }

  revalidatePath("/leads");

  return {
    success: true,
  };
}