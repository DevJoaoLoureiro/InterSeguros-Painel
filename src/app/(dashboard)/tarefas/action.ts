"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import {
  cleanNif,
  reconcileProcessReceipts,
} from "@/lib/tasks/process-receipts";
import {
  getCachedActiveProfiles,
  getCachedInsuranceLines,
} from "@/lib/cache/reference-data";
import {
  deriveProcessStatus,
  isValidDateKey,
} from "@/lib/tasks/process-status";

const taskStatuses = [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;

const taskPriorities = ["LOW", "MEDIUM", "HIGH"] as const;

export type TaskStatus = (typeof taskStatuses)[number];
export type TaskPriority = (typeof taskPriorities)[number];
export type TaskKind = "TASK" | "PROCESS";
export type ReceiptSource = "MANUAL" | "WEBSERVICE";

/*
 * Recibo da companhia ligado a um processo (vindo do webservice).
 */
export type ProcessReceipt = {
  id: string;
  receipt_number: string | null;
  status: string;
  period_start: string | null;
  period_end: string | null;
  due_date: string | null;
  payment_date: string | null;
  total_premium: number | null;
  commercial_premium: number | null;
  policy_number: string | null;
  company_name: string | null;
};

export type TaskRow = {
  id: string;
  kind: TaskKind;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: string | null;
  completed_at: string | null;
  assigned_user_id: string | null;
  created_by_user_id: string | null;
  store_id: string | null;
  client_id: string | null;
  lead_id: string | null;
  policy_id: string | null;
  created_at: string;

  // Campos de processo (kind = PROCESS)
  client_name: string | null;
  client_nif: string | null;
  insurance_line_id: string | null;
  policy_start_date: string | null;
  is_new_policy: boolean | null;
  simulation_presented: boolean;
  issued: boolean;
  receipt_paid: boolean;
  receipt_source: ReceiptSource | null;
  receipt_id: string | null;
  receipt_paid_at: string | null;
  receipt: ProcessReceipt | null;
};

export type ProfileOption = {
  id: string;
  full_name: string;
};

export type InsuranceLineOption = {
  id: string;
  name: string;
};

const TASK_SELECT = `
  id,
  kind,
  title,
  description,
  status,
  priority,
  due_at,
  completed_at,
  assigned_user_id,
  created_by_user_id,
  store_id,
  client_id,
  lead_id,
  policy_id,
  created_at,
  client_name,
  client_nif,
  insurance_line_id,
  policy_start_date,
  is_new_policy,
  simulation_presented,
  issued,
  receipt_paid,
  receipt_source,
  receipt_id,
  receipt_paid_at
`;

function assertValidDate(value: string | null | undefined, label: string) {
  if (value && !isValidDateKey(value)) {
    throw new Error(`${label} inválida: ${value}. Confirma o ano.`);
  }
}

function canAssignOthers(role: string) {
  return role === "OWNER" || role === "ADMIN";
}

async function getAuthenticatedProfile() {
  const profile = await getCurrentProfile();

  if (!profile) {
    throw new Error("Não autenticado.");
  }

  return profile;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

async function loadProcessReceipts(
  admin: ReturnType<typeof createAdminClient>,
  receiptIds: string[],
) {
  const map = new Map<string, ProcessReceipt>();

  if (receiptIds.length === 0) {
    return map;
  }

  const { data, error } = await admin
    .from("receipts")
    .select(`
      id,
      receipt_number,
      status,
      period_start,
      period_end,
      due_date,
      payment_date,
      total_premium,
      commercial_premium,
      company:companies ( name ),
      policy:policies ( policy_number )
    `)
    .in("id", receiptIds);

  if (error) {
    throw new Error(`Erro ao carregar recibos: ${error.message}`);
  }

  for (const row of data ?? []) {
    map.set(row.id, {
      id: row.id,
      receipt_number: row.receipt_number,
      status: row.status,
      period_start: row.period_start,
      period_end: row.period_end,
      due_date: row.due_date,
      payment_date: row.payment_date,
      total_premium:
        row.total_premium === null ? null : Number(row.total_premium),
      commercial_premium:
        row.commercial_premium === null
          ? null
          : Number(row.commercial_premium),
      policy_number:
        firstRelation<{ policy_number: string }>(row.policy)
          ?.policy_number ?? null,
      company_name:
        firstRelation<{ name: string }>(row.company)?.name ?? null,
    });
  }

  return map;
}

export async function getTasksData({
  selectedStoreId,
}: {
  selectedStoreId: string | null;
}) {
  const currentProfile = await getAuthenticatedProfile();
  const privileged = canAssignOthers(currentProfile.role);

  const admin = createAdminClient();

  // Liga processos abertos aos recibos que chegaram pelo webservice.
  // O momento certo é o fim de cada sync (crons); aqui corre só como
  // reforço, DEPOIS de a página ser enviada, para não a bloquear
  // (eram 4 consultas em série antes de mostrar qualquer coisa).
  after(async () => {
    try {
      await reconcileProcessReceipts(createAdminClient());
    } catch (error) {
      console.error("[tarefas] reconcileProcessReceipts", error);
    }
  });

  const storeFilter =
    selectedStoreId && selectedStoreId !== "all"
      ? selectedStoreId
      : null;

  const assignedFilter = privileged ? null : currentProfile.id;

  let query = admin
    .from("tasks")
    .select(TASK_SELECT)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (storeFilter) {
    query = query.eq("store_id", storeFilter);
  }

  if (assignedFilter) {
    query = query.eq("assigned_user_id", assignedFilter);
  }

  // Utilizadores e ramos vêm da cache de referência.
  const [tasksResult, activeProfiles, lines] = await Promise.all([
    query,
    getCachedActiveProfiles(),
    getCachedInsuranceLines(),
  ]);

  if (tasksResult.error) {
    throw new Error(
      `Erro ao carregar tarefas: ${tasksResult.error.message}`,
    );
  }


  const rows = (tasksResult.data ?? []) as Omit<TaskRow, "receipt">[];

  const receiptMap = await loadProcessReceipts(
    admin,
    rows.map((t) => t.receipt_id).filter(Boolean) as string[],
  );

  return {
    privileged,
    currentProfileId: currentProfile.id,
    tasks: rows.map((t) => ({
      ...t,
      receipt: t.receipt_id ? receiptMap.get(t.receipt_id) ?? null : null,
    })) as TaskRow[],
    profiles: activeProfiles
      .filter((p) => privileged || p.id === currentProfile.id)
      .map((p) => ({ id: p.id, full_name: p.full_name })) as ProfileOption[],
    insuranceLines: lines
      .filter((l) => l.active)
      .map((l) => ({ id: l.id, name: l.name })) as InsuranceLineOption[],
  };
}

export type ProcessInput = {
  clientName: string;
  clientNif: string | null;
  insuranceLineId: string | null;
  policyStartDate: string | null;
  isNewPolicy: boolean;
};

export async function createTask(input: {
  kind?: TaskKind;
  title: string;
  description: string | null;
  priority: TaskPriority;
  dueAt: string | null;
  assignedUserId: string | null;
  process?: ProcessInput;
}) {
  const currentProfile = await getAuthenticatedProfile();

  const kind: TaskKind = input.kind === "PROCESS" ? "PROCESS" : "TASK";
  const process = kind === "PROCESS" ? input.process : undefined;

  if (kind === "PROCESS" && !process?.clientName.trim()) {
    throw new Error("O nome do cliente é obrigatório.");
  }

  assertValidDate(input.dueAt, "Data do prazo");
  assertValidDate(process?.policyStartDate, "Data de início do seguro");

  const admin = createAdminClient();

  let lineName: string | null = null;

  if (process?.insuranceLineId) {
    const { data: line } = await admin
      .from("insurance_lines")
      .select("name")
      .eq("id", process.insuranceLineId)
      .maybeSingle();

    lineName = line?.name ?? null;
  }

  // Num processo o título é gerado se não for indicado.
  const title =
    input.title.trim() ||
    (process
      ? `${process.isNewPolicy ? "Nova" : "Renegociação"}${lineName ? ` ${lineName}` : ""} — ${process.clientName.trim()}`
      : "");

  if (!title) {
    throw new Error("O título é obrigatório.");
  }

  const privileged = canAssignOthers(currentProfile.role);

  const assignedUserId = privileged
    ? input.assignedUserId ?? currentProfile.id
    : currentProfile.id;

  const { data: assignedProfile, error: assignedProfileError } =
    await admin
      .from("profiles")
      .select("id, store_id, active")
      .eq("id", assignedUserId)
      .single();

  if (assignedProfileError || !assignedProfile) {
    throw new Error("Responsável não encontrado.");
  }

  if (!assignedProfile.active) {
    throw new Error("Este utilizador está desativado.");
  }

  const nif = process ? cleanNif(process.clientNif) : null;

  let clientId: string | null = null;

  if (nif) {
    const { data: client } = await admin
      .from("clients")
      .select("id")
      .eq("nif", nif)
      .limit(1)
      .maybeSingle();

    clientId = client?.id ?? null;
  }

  // A data de início do seguro é também o lembrete da tarefa.
  const dueAt = process
    ? process.policyStartDate || input.dueAt || null
    : input.dueAt || null;

  const { data: created, error } = await admin
    .from("tasks")
    .insert({
      kind,
      title,
      description: input.description?.trim() || null,
      status: "PENDING",
      priority: input.priority,
      due_at: dueAt,
      assigned_user_id: assignedUserId,
      created_by_user_id: currentProfile.id,
      store_id: assignedProfile.store_id,
      client_id: clientId,
      ...(process
        ? {
            client_name: process.clientName.trim(),
            client_nif: nif,
            insurance_line_id: process.insuranceLineId || null,
            policy_start_date: process.policyStartDate || null,
            is_new_policy: process.isNewPolicy,
          }
        : {}),
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Erro ao criar tarefa: ${error.message}`);
  }

  if (process && nif) {
    try {
      await reconcileProcessReceipts(admin, [created.id]);
    } catch (reconcileError) {
      console.error("[tarefas] reconcile on create", reconcileError);
    }
  }

  revalidatePath("/tarefas");

  return { success: true };
}

async function loadTaskForModify(taskId: string) {
  const currentProfile = await getAuthenticatedProfile();

  const admin = createAdminClient();

  const { data: task, error: taskError } = await admin
    .from("tasks")
    .select(
      "id, kind, status, assigned_user_id, simulation_presented, issued, receipt_paid, receipt_source, completed_at",
    )
    .eq("id", taskId)
    .single<{
      id: string;
      kind: TaskKind;
      status: TaskStatus;
      assigned_user_id: string | null;
      simulation_presented: boolean;
      issued: boolean;
      receipt_paid: boolean;
      receipt_source: ReceiptSource | null;
      completed_at: string | null;
    }>();

  if (taskError || !task) {
    throw new Error("Tarefa não encontrada.");
  }

  const privileged = canAssignOthers(currentProfile.role);

  if (!privileged && task.assigned_user_id !== currentProfile.id) {
    throw new Error("Não tens permissão para alterar esta tarefa.");
  }

  return { admin, task, currentProfile, privileged };
}

/*
 * Editar os dados base de uma tarefa (e de um processo): título,
 * descrição, prioridade, prazo e responsável.
 */
export async function updateTask(
  taskId: string,
  input: {
    title?: string;
    description?: string | null;
    priority?: TaskPriority;
    dueAt?: string | null;
    assignedUserId?: string | null;
  },
) {
  const { admin, task, privileged } = await loadTaskForModify(taskId);

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (input.title !== undefined) {
    if (!input.title.trim()) {
      throw new Error("O título é obrigatório.");
    }
    update.title = input.title.trim();
  }

  if (input.description !== undefined) {
    update.description = input.description?.trim() || null;
  }

  if (input.priority !== undefined) {
    if (!taskPriorities.includes(input.priority)) {
      throw new Error("Prioridade inválida.");
    }
    update.priority = input.priority;
  }

  // Num processo o prazo é a data de início do seguro (updateProcess).
  if (input.dueAt !== undefined && task.kind === "TASK") {
    assertValidDate(input.dueAt, "Data do prazo");
    update.due_at = input.dueAt || null;
  }

  if (input.assignedUserId && input.assignedUserId !== task.assigned_user_id) {
    if (!privileged) {
      throw new Error("Não tens permissão para mudar o responsável.");
    }

    const { data: assigned } = await admin
      .from("profiles")
      .select("id, store_id, active")
      .eq("id", input.assignedUserId)
      .maybeSingle();

    if (!assigned?.active) {
      throw new Error("Responsável inválido ou desativado.");
    }

    update.assigned_user_id = assigned.id;
    update.store_id = assigned.store_id;
  }

  const { error } = await admin
    .from("tasks")
    .update(update)
    .eq("id", taskId);

  if (error) {
    throw new Error(`Erro ao atualizar tarefa: ${error.message}`);
  }

  revalidatePath("/tarefas");

  return { success: true };
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
) {
  if (!taskStatuses.includes(status)) {
    throw new Error("Estado inválido.");
  }

  const { admin, task } = await loadTaskForModify(taskId);

  let nextStatus: TaskStatus = status;

  // Num processo o estado vem dos passos: só se pode cancelar ou
  // reabrir (e ao reabrir volta ao estado que os passos indicam).
  if (task.kind === "PROCESS") {
    nextStatus =
      status === "CANCELLED"
        ? "CANCELLED"
        : deriveProcessStatus({ ...task, status: "PENDING" });

    if (status === "COMPLETED" && nextStatus !== "COMPLETED") {
      throw new Error(
        "O processo só pode ser fechado quando o recibo estiver pago.",
      );
    }
  }

  const { error } = await admin
    .from("tasks")
    .update({
      status: nextStatus,
      completed_at:
        nextStatus === "COMPLETED"
          ? task.completed_at ?? new Date().toISOString()
          : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId);

  if (error) {
    throw new Error(`Erro ao atualizar tarefa: ${error.message}`);
  }

  revalidatePath("/tarefas");

  return { success: true };
}

export type ProcessPatch = {
  clientName?: string;
  clientNif?: string | null;
  insuranceLineId?: string | null;
  policyStartDate?: string | null;
  isNewPolicy?: boolean;
  simulationPresented?: boolean;
  issued?: boolean;
  receiptPaid?: boolean;
};

export async function updateProcess(taskId: string, patch: ProcessPatch) {
  const { admin, task } = await loadTaskForModify(taskId);

  if (task.kind !== "PROCESS") {
    throw new Error("Esta tarefa não é um processo.");
  }

  const now = new Date().toISOString();
  const update: Record<string, unknown> = { updated_at: now };

  if (patch.clientName !== undefined) {
    if (!patch.clientName.trim()) {
      throw new Error("O nome do cliente é obrigatório.");
    }
    update.client_name = patch.clientName.trim();
  }

  if (patch.clientNif !== undefined) {
    update.client_nif = cleanNif(patch.clientNif);
  }

  if (patch.insuranceLineId !== undefined) {
    update.insurance_line_id = patch.insuranceLineId || null;
  }

  if (patch.policyStartDate !== undefined) {
    assertValidDate(patch.policyStartDate, "Data de início do seguro");
    update.policy_start_date = patch.policyStartDate || null;
    update.due_at = patch.policyStartDate || null;
  }

  if (patch.isNewPolicy !== undefined) {
    update.is_new_policy = patch.isNewPolicy;
  }

  if (patch.simulationPresented !== undefined) {
    update.simulation_presented = patch.simulationPresented;
  }

  if (patch.issued !== undefined) {
    update.issued = patch.issued;
  }

  if (patch.receiptPaid !== undefined) {
    // O recibo do webservice manda: não se sobrepõe manualmente.
    if (task.receipt_source === "WEBSERVICE") {
      throw new Error(
        "O recibo deste processo vem do webservice da companhia e não pode ser alterado manualmente.",
      );
    }

    update.receipt_paid = patch.receiptPaid;
    update.receipt_source = patch.receiptPaid ? "MANUAL" : null;
    update.receipt_paid_at = patch.receiptPaid ? now : null;

    // Recibo pago implica apólice emitida.
    if (patch.receiptPaid) {
      update.issued = true;
    }
  }

  // O estado segue os passos (marcar avança, desmarcar recua).
  const nextStatus = deriveProcessStatus({
    status: task.status,
    simulation_presented:
      (update.simulation_presented as boolean | undefined) ??
      task.simulation_presented,
    issued: (update.issued as boolean | undefined) ?? task.issued,
    receipt_paid:
      (update.receipt_paid as boolean | undefined) ?? task.receipt_paid,
  });

  if (nextStatus !== task.status) {
    update.status = nextStatus;
  }

  update.completed_at =
    nextStatus === "COMPLETED" ? task.completed_at ?? now : null;

  const { error } = await admin
    .from("tasks")
    .update(update)
    .eq("id", taskId);

  if (error) {
    throw new Error(`Erro ao atualizar processo: ${error.message}`);
  }

  // NIF ou data podem ter mudado: tentar de novo o recibo do webservice.
  try {
    await reconcileProcessReceipts(admin, [taskId]);
  } catch (reconcileError) {
    console.error("[tarefas] reconcile on update", reconcileError);
  }

  revalidatePath("/tarefas");

  return { success: true };
}

export async function deleteTask(taskId: string) {
  const currentProfile = await getAuthenticatedProfile();

  const admin = createAdminClient();

  const { data: task, error: taskError } = await admin
    .from("tasks")
    .select("id, assigned_user_id, created_by_user_id")
    .eq("id", taskId)
    .single();

  if (taskError || !task) {
    throw new Error("Tarefa não encontrada.");
  }

  const privileged = canAssignOthers(currentProfile.role);

  const canDelete =
    privileged ||
    task.assigned_user_id === currentProfile.id ||
    task.created_by_user_id === currentProfile.id;

  if (!canDelete) {
    throw new Error("Não tens permissão para apagar esta tarefa.");
  }

  const { error } = await admin.from("tasks").delete().eq("id", taskId);

  if (error) {
    throw new Error(`Erro ao apagar tarefa: ${error.message}`);
  }

  revalidatePath("/tarefas");

  return { success: true };
}
