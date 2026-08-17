"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type CreateEmployeeInput = {
  fullName: string;
  email: string;
  password: string;
  role: "OWNER" | "ADMIN" | "GESTOR_LOJA" | "COMERCIAL";
  storeId: string | null;
};

async function getCurrentOwner() {
  const supabase = await createClient();

  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  if (!currentUser) {
    throw new Error("Não autenticado.");
  }

  const { data: currentProfile, error: profileError } =
    await supabase
      .from("profiles")
      .select("role")
      .eq("id", currentUser.id)
      .single();

  if (profileError || !currentProfile) {
    throw new Error("Perfil não encontrado.");
  }

  if (currentProfile.role !== "OWNER") {
    throw new Error(
      "Não tens permissões para gerir utilizadores.",
    );
  }

  return currentUser;
}

export async function createEmployee(
  input: CreateEmployeeInput,
) {
  await getCurrentOwner();

  if (!input.fullName.trim()) {
    throw new Error("O nome é obrigatório.");
  }

  if (!input.email.trim()) {
    throw new Error("O email é obrigatório.");
  }

  if (input.password.length < 8) {
    throw new Error(
      "A palavra-passe deve ter pelo menos 8 caracteres.",
    );
  }

  if (
    input.role !== "OWNER" &&
    !input.storeId
  ) {
    throw new Error(
      "É necessário associar o funcionário a uma loja.",
    );
  }

  const admin = createAdminClient();

  const { data, error } =
    await admin.auth.admin.createUser({
      email: input.email.trim(),
      password: input.password,
      email_confirm: true,
      user_metadata: {
        full_name: input.fullName.trim(),
      },
    });

  if (error || !data.user) {
    throw new Error(
      error?.message ??
        "Erro ao criar utilizador.",
    );
  }

  const { error: insertError } = await admin
    .from("profiles")
    .insert({
      id: data.user.id,
      full_name: input.fullName.trim(),
      role: input.role,
      store_id:
        input.role === "OWNER"
          ? null
          : input.storeId,
      active: true,
    });

  if (insertError) {
    await admin.auth.admin.deleteUser(
      data.user.id,
    );

    throw new Error(insertError.message);
  }

  revalidatePath("/utilizadores");

  return {
    success: true,
    userId: data.user.id,
  };
}

export async function toggleEmployeeStatus(
  userId: string,
  active: boolean,
) {
  const currentUser = await getCurrentOwner();

  if (
    userId === currentUser.id &&
    !active
  ) {
    throw new Error(
      "Não podes desativar a tua própria conta.",
    );
  }

  const admin = createAdminClient();

  const { data: targetProfile, error: targetError } =
    await admin
      .from("profiles")
      .select("id, role, active")
      .eq("id", userId)
      .single();

  if (targetError || !targetProfile) {
    throw new Error(
      "Utilizador não encontrado.",
    );
  }

  const { error } = await admin
    .from("profiles")
    .update({
      active,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/utilizadores");

  return {
    success: true,
  };
}