"use server";

import {
  revalidatePath,
} from "next/cache";

import {
  createAdminClient,
} from "@/lib/supabase/admin";

import {
  getCurrentProfile,
} from "@/lib/auth/get-current-profile";

const opportunityStatuses = [
  "nova",
  "qualificada",
  "simulacao",
  "negociacao",
  "proposta",
  "ganha",
  "perdida",
] as const;

export type OpportunityStatus =
  (typeof opportunityStatuses)[number];

type CreateOpportunityInput = {
  title: string;
  insuranceType: string | null;
  estimatedValue: number | null;
  assignedUserId: string | null;
  companyName: string | null;
  expectedCloseDate: string | null;
  notes: string | null;
};

type UpdateOpportunityInput = {
  title: string;
  insuranceType: string | null;
  estimatedValue: number | null;
  assignedUserId: string | null;
  companyName: string | null;
  expectedCloseDate: string | null;
  notes: string | null;
};

function canAssignOthers(
  role: string,
) {
  return (
    role === "OWNER" ||
    role === "ADMIN"
  );
}

async function getAuthenticatedProfile() {
  const profile =
    await getCurrentProfile();

  if (!profile) {
    throw new Error(
      "Não autenticado.",
    );
  }

  return profile;
}

export async function createOpportunity(
  input: CreateOpportunityInput,
) {
  const currentProfile =
    await getAuthenticatedProfile();

  const admin =
    createAdminClient();

  const title =
    input.title.trim();

  if (!title) {
    throw new Error(
      "O título é obrigatório.",
    );
  }

  const privileged =
    canAssignOthers(
      currentProfile.role,
    );

  // OWNER / ADMIN escolhem.
  // Restantes são obrigatoriamente eles próprios.
  const assignedUserId =
    privileged
      ? input.assignedUserId
      : currentProfile.id;

  if (!assignedUserId) {
    throw new Error(
      "Seleciona um responsável.",
    );
  }

  const {
    data: assignedProfile,
    error: assignedProfileError,
  } = await admin
    .from("profiles")
    .select(`
      id,
      full_name,
      store_id,
      active
    `)
    .eq(
      "id",
      assignedUserId,
    )
    .single();

  if (
    assignedProfileError ||
    !assignedProfile
  ) {
    throw new Error(
      "Responsável não encontrado.",
    );
  }

  if (!assignedProfile.active) {
    throw new Error(
      "Este utilizador está desativado.",
    );
  }

  if (!assignedProfile.store_id) {
    throw new Error(
      "O responsável não tem uma loja associada.",
    );
  }

  const {
    data: opportunity,
    error,
  } = await admin
    .from("opportunities")
    .insert({
      title,

      insurance_type:
        input.insuranceType ||
        null,

      status: "nova",

      estimated_value:
        input.estimatedValue,

      assigned_user_id:
        assignedProfile.id,

      store_id:
        assignedProfile.store_id,

      company_name:
        input.companyName?.trim() ||
        null,

      expected_close_date:
        input.expectedCloseDate ||
        null,

      notes:
        input.notes?.trim() ||
        null,
    })
    .select("id")
    .single();

  if (
    error ||
    !opportunity
  ) {
    throw new Error(
      error?.message ??
        "Erro ao criar oportunidade.",
    );
  }

  revalidatePath(
    "/oportunidades",
  );

  revalidatePath(
    "/dashboard",
  );

  return {
    success: true,
    opportunityId:
      opportunity.id,
  };
}

export async function updateOpportunity(
  opportunityId: string,
  input: UpdateOpportunityInput,
) {
  const currentProfile =
    await getAuthenticatedProfile();

  const admin =
    createAdminClient();

  const title =
    input.title.trim();

  if (!title) {
    throw new Error(
      "O título é obrigatório.",
    );
  }

  const {
    data: currentOpportunity,
    error: currentOpportunityError,
  } = await admin
    .from("opportunities")
    .select(`
      id,
      assigned_user_id,
      store_id
    `)
    .eq(
      "id",
      opportunityId,
    )
    .single();

  if (
    currentOpportunityError ||
    !currentOpportunity
  ) {
    throw new Error(
      "Oportunidade não encontrada.",
    );
  }

  const privileged =
    canAssignOthers(
      currentProfile.role,
    );

  // Comercial/Gestor só pode editar
  // oportunidades atribuídas a si próprio.
  if (
    !privileged &&
    currentOpportunity.assigned_user_id !==
      currentProfile.id
  ) {
    throw new Error(
      "Não tens permissão para editar esta oportunidade.",
    );
  }

  const finalAssignedUserId =
    privileged
      ? input.assignedUserId ??
        currentOpportunity.assigned_user_id
      : currentOpportunity.assigned_user_id;

  if (!finalAssignedUserId) {
    throw new Error(
      "A oportunidade não tem responsável.",
    );
  }

  const {
    data: assignedProfile,
    error: assignedProfileError,
  } = await admin
    .from("profiles")
    .select(`
      id,
      store_id,
      active
    `)
    .eq(
      "id",
      finalAssignedUserId,
    )
    .single();

  if (
    assignedProfileError ||
    !assignedProfile
  ) {
    throw new Error(
      "Responsável não encontrado.",
    );
  }

  if (!assignedProfile.active) {
    throw new Error(
      "Este utilizador está desativado.",
    );
  }

  if (!assignedProfile.store_id) {
    throw new Error(
      "O responsável não tem uma loja associada.",
    );
  }

  const {
    error: updateError,
  } = await admin
    .from("opportunities")
    .update({
      title,

      insurance_type:
        input.insuranceType ||
        null,

      estimated_value:
        input.estimatedValue,

      assigned_user_id:
        assignedProfile.id,

      store_id:
        assignedProfile.store_id,

      company_name:
        input.companyName?.trim() ||
        null,

      expected_close_date:
        input.expectedCloseDate ||
        null,

      notes:
        input.notes?.trim() ||
        null,

      updated_at:
        new Date().toISOString(),
    })
    .eq(
      "id",
      opportunityId,
    );

  if (updateError) {
    throw new Error(
      `Erro ao atualizar oportunidade: ${updateError.message}`,
    );
  }

  revalidatePath(
    "/oportunidades",
  );

  revalidatePath(
    "/dashboard",
  );

  return {
    success: true,
  };
}

export async function updateOpportunityStatus(
  opportunityId: string,
  status: OpportunityStatus,
) {
  const currentProfile =
    await getAuthenticatedProfile();

  if (
    !opportunityStatuses.includes(
      status,
    )
  ) {
    throw new Error(
      "Estado inválido.",
    );
  }

  const admin =
    createAdminClient();

  const {
    data: opportunity,
    error: opportunityError,
  } = await admin
    .from("opportunities")
    .select(`
      id,
      assigned_user_id,
      status
    `)
    .eq(
      "id",
      opportunityId,
    )
    .single();

  if (
    opportunityError ||
    !opportunity
  ) {
    throw new Error(
      "Oportunidade não encontrada.",
    );
  }

  const privileged =
    canAssignOthers(
      currentProfile.role,
    );

  if (
    !privileged &&
    opportunity.assigned_user_id !==
      currentProfile.id
  ) {
    throw new Error(
      "Não tens permissão para alterar esta oportunidade.",
    );
  }

  if (
    opportunity.status ===
    status
  ) {
    return {
      success: true,
    };
  }

  const now =
    new Date().toISOString();

  const updateData: {
    status: OpportunityStatus;
    updated_at: string;
    won_at: string | null;
    lost_at: string | null;
  } = {
    status,
    updated_at: now,
    won_at: null,
    lost_at: null,
  };

  if (
    status === "ganha"
  ) {
    updateData.won_at =
      now;
  }

  if (
    status === "perdida"
  ) {
    updateData.lost_at =
      now;
  }

  const {
    error,
  } = await admin
    .from("opportunities")
    .update(updateData)
    .eq(
      "id",
      opportunityId,
    );

  if (error) {
    throw new Error(
      `Erro ao atualizar oportunidade: ${error.message}`,
    );
  }

  revalidatePath(
    "/oportunidades",
  );

  revalidatePath(
    "/dashboard",
  );

  return {
    success: true,
  };
}

export async function deleteOpportunity(
  opportunityId: string,
) {
  const currentProfile =
    await getAuthenticatedProfile();

  const admin =
    createAdminClient();

  const {
    data: opportunity,
    error: opportunityError,
  } = await admin
    .from("opportunities")
    .select(`
      id,
      assigned_user_id
    `)
    .eq(
      "id",
      opportunityId,
    )
    .single();

  if (
    opportunityError ||
    !opportunity
  ) {
    throw new Error(
      "Oportunidade não encontrada.",
    );
  }

  const privileged =
    canAssignOthers(
      currentProfile.role,
    );

  if (
    !privileged &&
    opportunity.assigned_user_id !==
      currentProfile.id
  ) {
    throw new Error(
      "Não tens permissão para apagar esta oportunidade.",
    );
  }

  const {
    error,
  } = await admin
    .from("opportunities")
    .delete()
    .eq(
      "id",
      opportunityId,
    );

  if (error) {
    throw new Error(
      `Erro ao apagar oportunidade: ${error.message}`,
    );
  }

  revalidatePath(
    "/oportunidades",
  );

  revalidatePath(
    "/dashboard",
  );

  return {
    success: true,
  };
}