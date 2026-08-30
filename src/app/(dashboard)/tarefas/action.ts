"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";

const taskStatuses = [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;

const taskPriorities = ["LOW", "MEDIUM", "HIGH"] as const;

export type TaskStatus = (typeof taskStatuses)[number];
export type TaskPriority = (typeof taskPriorities)[number];

export type TaskRow = {
  id: string;
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
};

export type ProfileOption = {
  id: string;
  full_name: string;
};

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

export async function getTasksData({
  selectedStoreId,
}: {
  selectedStoreId: string | null;
}) {
  const currentProfile = await getAuthenticatedProfile();
  const privileged = canAssignOthers(currentProfile.role);

  const admin = createAdminClient();

  const storeFilter =
    selectedStoreId && selectedStoreId !== "all"
      ? selectedStoreId
      : null;

  const assignedFilter = privileged ? null : currentProfile.id;

  let query = admin
    .from("tasks")
    .select(`
      id,
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
      created_at
    `)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (storeFilter) {
    query = query.eq("store_id", storeFilter);
  }

  if (assignedFilter) {
    query = query.eq("assigned_user_id", assignedFilter);
  }

  let profilesQuery = admin
    .from("profiles")
    .select("id, full_name")
    .eq("active", true)
    .order("full_name", { ascending: true });

  if (!privileged) {
    profilesQuery = profilesQuery.eq("id", currentProfile.id);
  }

  const [tasksResult, profilesResult] = await Promise.all([
    query,
    profilesQuery,
  ]);

  if (tasksResult.error) {
    throw new Error(
      `Erro ao carregar tarefas: ${tasksResult.error.message}`,
    );
  }

  if (profilesResult.error) {
    throw new Error(
      `Erro ao carregar utilizadores: ${profilesResult.error.message}`,
    );
  }

  return {
    privileged,
    currentProfileId: currentProfile.id,
    tasks: (tasksResult.data ?? []) as TaskRow[],
    profiles: (profilesResult.data ?? []) as ProfileOption[],
  };
}

export async function createTask(input: {
  title: string;
  description: string | null;
  priority: TaskPriority;
  dueAt: string | null;
  assignedUserId: string | null;
}) {
  const currentProfile = await getAuthenticatedProfile();

  const title = input.title.trim();

  if (!title) {
    throw new Error("O título é obrigatório.");
  }

  const privileged = canAssignOthers(currentProfile.role);

  const assignedUserId = privileged
    ? input.assignedUserId ?? currentProfile.id
    : currentProfile.id;

  const admin = createAdminClient();

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

  const { error } = await admin.from("tasks").insert({
    title,
    description: input.description?.trim() || null,
    status: "PENDING",
    priority: input.priority,
    due_at: input.dueAt || null,
    assigned_user_id: assignedUserId,
    created_by_user_id: currentProfile.id,
    store_id: assignedProfile.store_id,
  });

  if (error) {
    throw new Error(`Erro ao criar tarefa: ${error.message}`);
  }

  revalidatePath("/tarefas");

  return { success: true };
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
) {
  const currentProfile = await getAuthenticatedProfile();

  if (!taskStatuses.includes(status)) {
    throw new Error("Estado inválido.");
  }

  const admin = createAdminClient();

  const { data: task, error: taskError } = await admin
    .from("tasks")
    .select("id, assigned_user_id")
    .eq("id", taskId)
    .single();

  if (taskError || !task) {
    throw new Error("Tarefa não encontrada.");
  }

  const privileged = canAssignOthers(currentProfile.role);

  if (!privileged && task.assigned_user_id !== currentProfile.id) {
    throw new Error("Não tens permissão para alterar esta tarefa.");
  }

  const { error } = await admin
    .from("tasks")
    .update({
      status,
      completed_at:
        status === "COMPLETED" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId);

  if (error) {
    throw new Error(`Erro ao atualizar tarefa: ${error.message}`);
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