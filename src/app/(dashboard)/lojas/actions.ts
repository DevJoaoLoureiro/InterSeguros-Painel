"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type StoreInput = {
  name: string;
  code: string;
  address?: string;
  postalCode?: string;
  city?: string;
  phone?: string;
  email?: string;
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
    .select("role")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    throw new Error("Perfil não encontrado.");
  }

  if (profile.role !== "OWNER") {
    throw new Error(
      "Não tens permissões para gerir lojas.",
    );
  }

  return user;
}

export async function createStore(
  input: StoreInput,
) {
  await requireOwner();

  if (!input.name.trim()) {
    throw new Error(
      "O nome da loja é obrigatório.",
    );
  }

  if (!input.code.trim()) {
    throw new Error(
      "O código da loja é obrigatório.",
    );
  }

  const admin = createAdminClient();

  const { error } = await admin
    .from("stores")
    .insert({
      name: input.name.trim(),
      code: input.code.trim().toUpperCase(),

      address:
        input.address?.trim() || null,

      postal_code:
        input.postalCode?.trim() || null,

      city:
        input.city?.trim() || null,

      phone:
        input.phone?.trim() || null,

      email:
        input.email?.trim().toLowerCase() || null,

      active: true,
    });

  if (error) {
    if (error.code === "23505") {
      throw new Error(
        "Já existe uma loja com esse código.",
      );
    }

    throw new Error(error.message);
  }

  revalidatePath("/lojas");

  return {
    success: true,
  };
}

export async function updateStore(
  storeId: string,
  input: StoreInput,
) {
  await requireOwner();

  if (!storeId) {
    throw new Error("Loja inválida.");
  }

  if (!input.name.trim()) {
    throw new Error(
      "O nome da loja é obrigatório.",
    );
  }

  if (!input.code.trim()) {
    throw new Error(
      "O código da loja é obrigatório.",
    );
  }

  const admin = createAdminClient();

  const { error } = await admin
    .from("stores")
    .update({
      name: input.name.trim(),

      code:
        input.code.trim().toUpperCase(),

      address:
        input.address?.trim() || null,

      postal_code:
        input.postalCode?.trim() || null,

      city:
        input.city?.trim() || null,

      phone:
        input.phone?.trim() || null,

      email:
        input.email?.trim().toLowerCase() || null,

      updated_at:
        new Date().toISOString(),
    })
    .eq("id", storeId);

  if (error) {
    if (error.code === "23505") {
      throw new Error(
        "Já existe outra loja com esse código.",
      );
    }

    throw new Error(error.message);
  }

  revalidatePath("/lojas");

  return {
    success: true,
  };
}

export async function toggleStoreStatus(
  storeId: string,
  active: boolean,
) {
  await requireOwner();

  if (!storeId) {
    throw new Error("Loja inválida.");
  }

  const admin = createAdminClient();

  const { error } = await admin
    .from("stores")
    .update({
      active,
      updated_at:
        new Date().toISOString(),
    })
    .eq("id", storeId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/lojas");

  return {
    success: true,
  };
}