"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { LeadStatus } from "@/types/lead";

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

type UpdateLeadStatusInput = {
  leadId: string;
  status: LeadStatus;
};

const validLeadStatuses: LeadStatus[] = [
  "nova",
  "em_contacto",
  "a_aguardar",
  "simulacao_enviada",
  "proposta",
  "ganha",
  "convertida",
  "perdida",
];

export async function updateLeadStatus(
  input: UpdateLeadStatusInput,
) {
  const supabase = await createClient();

  // 1. Quem está autenticado?
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Não autenticado.");
  }

  // 2. Obter perfil e role
  const {
    data: profile,
    error: profileError,
  } = await supabase
    .from("profiles")
    .select(`
      id,
      role,
      store_id,
      active
    `)
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    throw new Error("Perfil não encontrado.");
  }

  if (!profile.active) {
    throw new Error("Conta desativada.");
  }

  // Segurança adicional
  if (!validLeadStatuses.includes(input.status)) {
    throw new Error("Estado inválido.");
  }

  const admin = createAdminClient();

  // 3. Buscar estado atual e responsável
  const {
    data: lead,
    error: leadError,
  } = await admin
    .from("leads")
    .select(`
      id,
      status,
      store_id,
      assigned_user_id
    `)
    .eq("id", input.leadId)
    .single();

  if (leadError || !lead) {
    throw new Error("Lead não encontrada.");
  }

  const currentStatus =
    lead.status as LeadStatus;

  const newStatus = input.status;

  if (currentStatus === newStatus) {
    return {
      success: true,
    };
  }

  // ==========================================
  // COMERCIAL
  // ==========================================

  if (profile.role === "COMERCIAL") {
    // Só mexe nas próprias leads
    if (lead.assigned_user_id !== user.id) {
      throw new Error(
        "Não tens permissão para alterar esta lead.",
      );
    }

    // REGRA PRINCIPAL:
    // comercial NUNCA confirma conversão
    if (newStatus === "convertida") {
      throw new Error(
        "A conversão tem de ser validada pela gestão.",
      );
    }
  }

  // ==========================================
  // GESTOR DE LOJA
  // ==========================================

  if (profile.role === "GESTOR_LOJA") {
    if (
      !profile.store_id ||
      lead.store_id !== profile.store_id
    ) {
      throw new Error(
        "Esta lead não pertence à tua loja.",
      );
    }
  }

  // ==========================================
  // CONVERSÃO
  // ==========================================

  if (newStatus === "convertida") {
    const canValidateConversion =
      profile.role === "OWNER" ||
      profile.role === "ADMIN" ||
      profile.role === "GESTOR_LOJA";

    if (!canValidateConversion) {
      throw new Error(
        "Não tens permissão para validar uma conversão.",
      );
    }

    // Só uma lead marcada como ganha
    // pode ser confirmada como convertida.
    if (currentStatus !== "ganha") {
      throw new Error(
        "A lead tem de estar como 'Ganha' antes de ser convertida.",
      );
    }
  }

  // ==========================================
  // UPDATE
  // ==========================================

  const now = new Date().toISOString();

  const updateData: {
    status: LeadStatus;
    updated_at: string;
    converted_at?: string;
  } = {
    status: newStatus,
    updated_at: now,
  };

  if (newStatus === "convertida") {
    updateData.converted_at = now;
  }

  const { error: updateError } = await admin
    .from("leads")
    .update(updateData)
    .eq("id", input.leadId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  revalidatePath("/leads");
  revalidatePath("/dashboard");

  return {
    success: true,
  };




  
}

type SubmitConversionRequestResult = {
  success: boolean;
};

export async function submitConversionRequest(
  formData: FormData,
): Promise<SubmitConversionRequestResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Não autenticado.");
  }

  const {
    data: profile,
    error: profileError,
  } = await supabase
    .from("profiles")
    .select(`
      id,
      role,
      active,
      store_id
    `)
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    throw new Error("Perfil não encontrado.");
  }

  if (!profile.active) {
    throw new Error("Conta desativada.");
  }

  const leadId = String(
    formData.get("leadId") ?? "",
  );

  const company = String(
    formData.get("company") ?? "",
  ).trim();

  const premiumValue = String(
    formData.get("premium") ?? "",
  )
    .replace(",", ".")
    .trim();

  const reference = String(
    formData.get("reference") ?? "",
  ).trim();

  const startDate = String(
    formData.get("startDate") ?? "",
  ).trim();

  const notes = String(
    formData.get("notes") ?? "",
  ).trim();

  const document =
    formData.get("document");

  if (!leadId) {
    throw new Error(
      "Lead inválida.",
    );
  }

  if (!company) {
    throw new Error(
      "Indica a companhia.",
    );
  }

  const premium =
    Number(premiumValue);

  if (
    !Number.isFinite(premium) ||
    premium <= 0
  ) {
    throw new Error(
      "Indica um prémio válido.",
    );
  }

  if (!reference) {
    throw new Error(
      "Indica a referência da proposta/apólice.",
    );
  }

  if (!startDate) {
    throw new Error(
      "Indica a data de início.",
    );
  }

  if (!(document instanceof File)) {
    throw new Error(
      "É obrigatório anexar um comprovativo.",
    );
  }

  if (document.size === 0) {
    throw new Error(
      "O ficheiro está vazio.",
    );
  }

  // Para já limitamos a 6 MB.
  const maxFileSize =
    6 * 1024 * 1024;

  if (document.size > maxFileSize) {
    throw new Error(
      "O comprovativo não pode ultrapassar 6 MB.",
    );
  }

  const allowedTypes = [
    "application/pdf",
    "image/jpeg",
    "image/png",
  ];

  if (
    !allowedTypes.includes(
      document.type,
    )
  ) {
    throw new Error(
      "Só são permitidos ficheiros PDF, JPG ou PNG.",
    );
  }

  const admin =
    createAdminClient();

  // =====================================
  // VALIDAR LEAD
  // =====================================

  const {
    data: lead,
    error: leadError,
  } = await admin
    .from("leads")
    .select(`
      id,
      status,
      store_id,
      assigned_user_id
    `)
    .eq("id", leadId)
    .single();

  if (leadError || !lead) {
    throw new Error(
      "Lead não encontrada.",
    );
  }

  // Só se pode submeter uma lead
  // que esteja efetivamente em proposta.
  if (lead.status !== "proposta") {
    throw new Error(
      "Só uma lead em Proposta pode ser submetida para validação.",
    );
  }

  // =====================================
  // PERMISSÕES
  // =====================================

  if (
    profile.role === "COMERCIAL"
  ) {
    if (
      lead.assigned_user_id !==
      user.id
    ) {
      throw new Error(
        "Esta lead não está atribuída a ti.",
      );
    }
  } else if (
    profile.role ===
    "GESTOR_LOJA"
  ) {
    if (
      !profile.store_id ||
      lead.store_id !==
        profile.store_id
    ) {
      throw new Error(
        "Esta lead não pertence à tua loja.",
      );
    }
  } else if (
    profile.role !== "OWNER" &&
    profile.role !== "ADMIN"
  ) {
    throw new Error(
      "Não tens permissão para submeter esta lead.",
    );
  }

  // =====================================
  // GARANTIR QUE NÃO EXISTE
  // PEDIDO PENDENTE
  // =====================================

  const {
    data: pendingRequest,
    error: pendingRequestError,
  } = await admin
    .from(
      "lead_conversion_requests",
    )
    .select("id")
    .eq("lead_id", leadId)
    .eq("status", "pending")
    .maybeSingle();

  if (pendingRequestError) {
    throw new Error(
      pendingRequestError.message,
    );
  }

  if (pendingRequest) {
    throw new Error(
      "Esta lead já tem um pedido de validação pendente.",
    );
  }

  // =====================================
  // UPLOAD DO DOCUMENTO
  // =====================================

  const extension =
    document.name
      .split(".")
      .pop()
      ?.toLowerCase() ?? "file";

  const documentId =
    crypto.randomUUID();

  const documentPath =
    `${leadId}/${documentId}.${extension}`;

  const arrayBuffer =
    await document.arrayBuffer();

  const fileBuffer =
    Buffer.from(arrayBuffer);

  const {
    error: uploadError,
  } = await admin.storage
    .from("lead-documents")
    .upload(
      documentPath,
      fileBuffer,
      {
        contentType:
          document.type,
        upsert: false,
      },
    );

  if (uploadError) {
    throw new Error(
      `Erro ao carregar comprovativo: ${uploadError.message}`,
    );
  }

  // =====================================
  // CRIAR PEDIDO DE VALIDAÇÃO
  // =====================================

  const {
    error: insertError,
  } = await admin
    .from(
      "lead_conversion_requests",
    )
    .insert({
      lead_id: leadId,
      submitted_by: user.id,

      company,
      premium,
      reference,
      start_date: startDate,

      document_path:
        documentPath,

      notes:
        notes || null,

      status: "pending",
    });

  if (insertError) {
    // Se a BD falhar, removemos o
    // ficheiro para não deixar lixo.
    await admin.storage
      .from("lead-documents")
      .remove([
        documentPath,
      ]);

    throw new Error(
      insertError.message,
    );
  }

  // =====================================
  // PROPOSTA -> GANHA
  // "GANHA" = POR VALIDAR
  // =====================================

  const {
    error: leadUpdateError,
  } = await admin
    .from("leads")
    .update({
      status: "ganha",
      updated_at:
        new Date().toISOString(),
    })
    .eq("id", leadId)
    .eq("status", "proposta");

  if (leadUpdateError) {
    // Não queremos um pedido pendente
    // sem a lead ficar em "ganha".
    //
    // Por enquanto reportamos o erro.
    // Depois podemos tornar isto
    // transacional via função SQL/RPC.
    throw new Error(
      leadUpdateError.message,
    );
  }

  revalidatePath("/leads");
  revalidatePath("/dashboard");

  return {
    success: true,
  };
}


type ConversionReviewRequest = {
  id: string;
  lead_id: string;
  company: string;
  premium: number;
  reference: string;
  start_date: string;
  document_path: string;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  submitted_by: string;
  created_at: string;
};

async function requireManagementUser() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Não autenticado.");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select(`
      id,
      role,
      active,
      store_id
    `)
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    throw new Error("Perfil não encontrado.");
  }

  if (!profile.active) {
    throw new Error("Conta desativada.");
  }

  const allowedRoles = [
    "OWNER",
    "ADMIN",
    "GESTOR_LOJA",
  ];

  if (!allowedRoles.includes(profile.role)) {
    throw new Error(
      "Não tens permissão para validar conversões.",
    );
  }

  return {
    user,
    profile,
  };
}

export async function getConversionRequest(
  leadId: string,
) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error("Não autenticado.");
  }

  const admin = createAdminClient();

  // Buscar perfil do utilizador atual
  const {
    data: profile,
    error: profileError,
  } = await admin
    .from("profiles")
    .select(`
      id,
      role,
      store_id
    `)
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    throw new Error(
      "Perfil do utilizador não encontrado.",
    );
  }

  // Buscar a lead
  const {
    data: lead,
    error: leadError,
  } = await admin
    .from("leads")
    .select(`
      id,
      name,
      store_id,
      assigned_user_id,
      status
    `)
    .eq("id", leadId)
    .single();

  if (leadError || !lead) {
    throw new Error("Lead não encontrada.");
  }

  // ========================================
  // PERMISSÕES
  // ========================================

  const isManagement =
    profile.role === "OWNER" ||
    profile.role === "ADMIN";

  const isStoreManager =
    profile.role === "GESTOR_LOJA" &&
    lead.store_id === profile.store_id;

  const isAssignedCommercial =
    profile.role === "COMERCIAL" &&
    lead.assigned_user_id === profile.id;

  if (
    !isManagement &&
    !isStoreManager &&
    !isAssignedCommercial
  ) {
    throw new Error(
      "Não tens permissão para consultar esta conversão.",
    );
  }

  // ========================================
  // PEDIDO A PROCURAR
  // ========================================

  const allowedRequestStatuses =
    lead.status === "convertida"
      ? ["approved"]
      : ["pending"];

  const {
    data: request,
    error: requestError,
  } = await admin
    .from("lead_conversion_requests")
    .select(`
      id,
      lead_id,
      company,
      premium,
      reference,
      start_date,
      document_path,
      notes,
      status,
      submitted_by,
      created_at
    `)
    .eq("lead_id", leadId)
    .in(
      "status",
      allowedRequestStatuses,
    )
    .order("created_at", {
      ascending: false,
    })
    .limit(1)
    .maybeSingle();

  if (requestError) {
    throw new Error(
      requestError.message,
    );
  }

  if (!request) {
    return null;
  }

  // Segurança extra:
  // comercial só pode ver o pedido
  // que ele próprio submeteu.
  if (
    profile.role === "COMERCIAL" &&
    request.submitted_by !== profile.id
  ) {
    throw new Error(
      "Não tens permissão para consultar este pedido.",
    );
  }

  // ========================================
  // NOME DE QUEM SUBMETEU
  // ========================================

  const {
    data: submittedBy,
  } = await admin
    .from("profiles")
    .select("full_name")
    .eq(
      "id",
      request.submitted_by,
    )
    .maybeSingle();

  // ========================================
  // URL TEMPORÁRIA DO DOCUMENTO
  // ========================================

  const {
    data: signedUrlData,
    error: signedUrlError,
  } = await admin.storage
    .from("lead-documents")
    .createSignedUrl(
      request.document_path,
      60 * 10,
    );

  if (signedUrlError) {
    throw new Error(
      `Não foi possível abrir o comprovativo: ${signedUrlError.message}`,
    );
  }

  return {
    ...(request as ConversionReviewRequest),

    submitted_by_name:
      submittedBy?.full_name ??
      "Utilizador",

    document_url:
      signedUrlData.signedUrl,
  };
}

export async function approveConversionRequest(
  requestId: string,
) {
  const { user, profile } =
    await requireManagementUser();

  const admin = createAdminClient();

  const {
    data: request,
    error: requestError,
  } = await admin
    .from("lead_conversion_requests")
    .select(`
      id,
      lead_id,
      status
    `)
    .eq("id", requestId)
    .single();

  if (
    requestError ||
    !request
  ) {
    throw new Error(
      "Pedido de validação não encontrado.",
    );
  }

  if (request.status !== "pending") {
    throw new Error(
      "Este pedido já foi processado.",
    );
  }

  const {
    data: lead,
    error: leadError,
  } = await admin
    .from("leads")
    .select(`
      id,
      status,
      store_id
    `)
    .eq("id", request.lead_id)
    .single();

  if (leadError || !lead) {
    throw new Error("Lead não encontrada.");
  }

  if (
    profile.role === "GESTOR_LOJA" &&
    lead.store_id !== profile.store_id
  ) {
    throw new Error(
      "Esta lead não pertence à tua loja.",
    );
  }

  if (lead.status !== "ganha") {
    throw new Error(
      "A lead já não está por validar.",
    );
  }

  const now = new Date().toISOString();

  const { error: leadUpdateError } =
    await admin
      .from("leads")
      .update({
        status: "convertida",
        converted_at: now,
        updated_at: now,
      })
      .eq("id", lead.id)
      .eq("status", "ganha");

  if (leadUpdateError) {
    throw new Error(
      leadUpdateError.message,
    );
  }

  const { error: requestUpdateError } =
    await admin
      .from("lead_conversion_requests")
      .update({
        status: "approved",
        reviewed_by: user.id,
        reviewed_at: now,
        updated_at: now,
      })
      .eq("id", request.id)
      .eq("status", "pending");

  if (requestUpdateError) {
    throw new Error(
      requestUpdateError.message,
    );
  }

  revalidatePath("/leads");
  revalidatePath("/dashboard");

  return {
    success: true,
  };
}

export async function rejectConversionRequest(
  requestId: string,
  reason: string,
) {
  const { user, profile } =
    await requireManagementUser();

  const rejectionReason =
    reason.trim();

  if (!rejectionReason) {
    throw new Error(
      "Indica o motivo da rejeição.",
    );
  }

  const admin = createAdminClient();

  const {
    data: request,
    error: requestError,
  } = await admin
    .from("lead_conversion_requests")
    .select(`
      id,
      lead_id,
      status
    `)
    .eq("id", requestId)
    .single();

  if (
    requestError ||
    !request
  ) {
    throw new Error(
      "Pedido de validação não encontrado.",
    );
  }

  if (request.status !== "pending") {
    throw new Error(
      "Este pedido já foi processado.",
    );
  }

  const {
    data: lead,
    error: leadError,
  } = await admin
    .from("leads")
    .select(`
      id,
      status,
      store_id
    `)
    .eq("id", request.lead_id)
    .single();

  if (leadError || !lead) {
    throw new Error("Lead não encontrada.");
  }

  if (
    profile.role === "GESTOR_LOJA" &&
    lead.store_id !== profile.store_id
  ) {
    throw new Error(
      "Esta lead não pertence à tua loja.",
    );
  }

  if (lead.status !== "ganha") {
    throw new Error(
      "A lead já não está por validar.",
    );
  }

  const now = new Date().toISOString();

  const { error: leadUpdateError } =
    await admin
      .from("leads")
      .update({
        status: "proposta",
        updated_at: now,
      })
      .eq("id", lead.id)
      .eq("status", "ganha");

  if (leadUpdateError) {
    throw new Error(
      leadUpdateError.message,
    );
  }

  const { error: requestUpdateError } =
    await admin
      .from("lead_conversion_requests")
      .update({
        status: "rejected",
        reviewed_by: user.id,
        reviewed_at: now,
        rejection_reason:
          rejectionReason,
        updated_at: now,
      })
      .eq("id", request.id)
      .eq("status", "pending");

  if (requestUpdateError) {
    throw new Error(
      requestUpdateError.message,
    );
  }

  revalidatePath("/leads");
  revalidatePath("/dashboard");

  return {
    success: true,
  };
}