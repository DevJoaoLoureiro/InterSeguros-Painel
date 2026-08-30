import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export const getCurrentProfile = cache(async () => {
  const supabase = await createClient();

  // 1. Utilizador autenticado
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    console.error("Erro ao carregar utilizador:", userError);
    return null;
  }

  // 2. Profile
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(`
      id,
      full_name,
      email,
      role,
      active,
      store_id
    `)
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error(
      "Erro ao carregar profile:",
      JSON.stringify(profileError, null, 2)
    );

    return null;
  }

  if (!profile) {
    console.error("Profile não encontrado para o utilizador:", user.id);
    return null;
  }

  if (!profile.active) {
    console.error("Profile inativo:", user.id);
    return null;
  }

  // 3. Loja
  let store: {
    id: string;
    name: string;
    code: string | null;
  } | null = null;

  if (profile.store_id) {
    const { data: storeData, error: storeError } = await supabase
      .from("stores")
      .select(`
        id,
        name,
        code
      `)
      .eq("id", profile.store_id)
      .maybeSingle();

    if (storeError) {
      console.error(
        "Erro ao carregar loja:",
        JSON.stringify(storeError, null, 2)
      );
    } else {
      store = storeData;
    }
  }

  return {
    id: profile.id,
    full_name: profile.full_name,
    email: profile.email ?? user.email ?? null,
    role: profile.role,
    active: profile.active,
    store,
  };
});