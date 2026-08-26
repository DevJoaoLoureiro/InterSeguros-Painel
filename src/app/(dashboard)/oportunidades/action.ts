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

export type OpportunityRow = {
  id: string;
  title: string;
  insurance_type: string | null;
  status: OpportunityStatus;
  estimated_value: number | null;
  assigned_user_id: string | null;
  store_id: string | null;
  company_name: string | null;
  expected_close_date: string | null;
  created_at: string;
};

export type ProfileRow = {
  id: string;
  full_name: string;
  store_id: string | null;
};

type OpportunityStats = {
  open_count: number;
  pipeline_value: number;
  won_count: number;
  won_value: number;
  lost_count: number;
};

const CLOSED_PAGE_SIZE = 15;

// Limite de segurança para o kanban; se uma loja
// tiver mais oportunidades abertas do que isto,
// convém repensar a UI (colunas paginadas, por ex.).
const OPEN_OPPORTUNITIES_LIMIT = 300;

type CreateOpportunityInput = {
  title: string;
  insuranceType: string | null;
  estimatedValue: number | null;
  assignedUserId: string | null;
  companyName: string | null;
  expectedCloseDate: string | null;
  notes: string | null;
};

type UpdateOpportunityInput = CreateOpportunityInput;

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

/**
 * Reúne tudo o que a página de Oportunidades precisa:
 * estatísticas agregadas (via RPC, sem trazer as linhas todas),
 * lista de oportunidades abertas para o kanban,
 * lista paginada de negócios fechados,
 * e utilizadores para atribuição.
 */
export async function getOpportunitiesPageData(
  input: {
    closedPage?: number;
  } = {},
) {
  const currentProfile =
    await getAuthenticatedProfile();

  const privileged =
    canAssignOthers(
      currentProfile.role,
    );

  // Nota: a leitura do cookie "selected_store_id"
  // continua a acontecer no page.tsx (Server Component),
  // porque cookies() só pode ser lido lá. Aqui recebemos
  // já o storeId resolvido.
  return {
    privileged,
    currentProfile,
  };
}

export async function getOpportunitiesData(
  input: {
    selectedStoreId: string | null;
    privileged: boolean;
    currentProfileId: string;
    closedPage?: number;
  },
) {
  const {
    selectedStoreId,
    privileged,
    currentProfileId,
  } = input;

  const closedPage = Math.max(
    1,
    input.closedPage ?? 1,
  );

  const admin =
    createAdminClient();

  const storeFilter =
    selectedStoreId &&
    selectedStoreId !== "all"
      ? selectedStoreId
      : null;

  const assignedFilter =
    privileged
      ? null
      : currentProfileId;

  // 1) Estatísticas agregadas — uma única chamada, sem
  //    trazer nenhuma linha de oportunidades para o Node.
  const {
    data: statsRows,
    error: statsError,
  } = await admin.rpc(
    "get_opportunity_stats",
    {
      p_store_id: storeFilter,
      p_assigned_user_id:
        assignedFilter,
    },
  );

  if (statsError) {
    throw new Error(
      `Erro ao calcular estatísticas: ${statsError.message}`,
    );
  }

  const stats: OpportunityStats =
    (statsRows?.[0] as
      | OpportunityStats
      | undefined) ?? {
      open_count: 0,
      pipeline_value: 0,
      won_count: 0,
      won_value: 0,
      lost_count: 0,
    };

  const decided =
    stats.won_count +
    stats.lost_count;

  const conversionRate =
    decided > 0
      ? (stats.won_count /
          decided) *
        100
      : 0;

  const selectColumns = `
    id,
    title,
    insurance_type,
    status,
    estimated_value,
    assigned_user_id,
    store_id,
    company_name,
    expected_close_date,
    created_at
  `;

  // 2) Oportunidades abertas para o kanban.
  let openQuery = admin
    .from("opportunities")
    .select(selectColumns)
    .not(
      "status",
      "in",
      "(ganha,perdida)",
    )
    .order(
      "created_at",
      { ascending: false },
    )
    .limit(
      OPEN_OPPORTUNITIES_LIMIT,
    );

  if (storeFilter) {
    openQuery = openQuery.eq(
      "store_id",
      storeFilter,
    );
  }

  if (assignedFilter) {
    openQuery = openQuery.eq(
      "assigned_user_id",
      assignedFilter,
    );
  }

  // 3) Negócios fechados, paginados.
  const closedFrom =
    (closedPage - 1) *
    CLOSED_PAGE_SIZE;

  const closedTo =
    closedFrom +
    CLOSED_PAGE_SIZE -
    1;

  let closedQuery = admin
    .from("opportunities")
    .select(selectColumns, {
      count: "exact",
    })
    .in("status", [
      "ganha",
      "perdida",
    ])
    .order(
      "updated_at",
      { ascending: false },
    )
    .range(
      closedFrom,
      closedTo,
    );

  if (storeFilter) {
    closedQuery =
      closedQuery.eq(
        "store_id",
        storeFilter,
      );
  }

  if (assignedFilter) {
    closedQuery =
      closedQuery.eq(
        "assigned_user_id",
        assignedFilter,
      );
  }

  // 4) Utilizadores para o formulário de criação/atribuição.
  let profilesQuery = admin
    .from("profiles")
    .select(`
      id,
      full_name,
      store_id
    `)
    .eq("active", true)
    .not(
      "store_id",
      "is",
      null,
    )
    .order(
      "full_name",
      { ascending: true },
    );

  if (!privileged) {
    profilesQuery =
      profilesQuery.eq(
        "id",
        currentProfileId,
      );
  }

  const [
    openResult,
    closedResult,
    profilesResult,
  ] = await Promise.all([
    openQuery,
    closedQuery,
    profilesQuery,
  ]);

  if (openResult.error) {
    throw new Error(
      `Erro ao carregar oportunidades abertas: ${openResult.error.message}`,
    );
  }

  if (closedResult.error) {
    throw new Error(
      `Erro ao carregar negócios fechados: ${closedResult.error.message}`,
    );
  }

  if (profilesResult.error) {
    throw new Error(
      `Erro ao carregar utilizadores: ${profilesResult.error.message}`,
    );
  }

  const closedTotal =
    closedResult.count ?? 0;

  const closedTotalPages =
    Math.max(
      1,
      Math.ceil(
        closedTotal /
          CLOSED_PAGE_SIZE,
      ),
    );

  return {
    stats,
    conversionRate,
    openOpportunities:
      (openResult.data ??
        []) as OpportunityRow[],
    closedOpportunities:
      (closedResult.data ??
        []) as OpportunityRow[],
    closedTotal,
    closedPage,
    closedTotalPages,
    profiles:
      (profilesResult.data ??
        []) as ProfileRow[],
  };
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

  if (status === "ganha") {
    updateData.won_at = now;
  }

  if (status === "perdida") {
    updateData.lost_at = now;
  }

  const { error } = await admin
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

  const { error } = await admin
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