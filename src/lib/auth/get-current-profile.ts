import { createClient } from "@/lib/supabase/server";

export async function getCurrentProfile() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(`
      id,
      full_name,
      role,
      active,
      store:stores (
        id,
        name,
        code
      )
    `)
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
   console.error("Erro ao carregar profile:", {
  message: profileError?.message,
  code: profileError?.code,
  details: profileError?.details,
  hint: profileError?.hint,
});
    return null;
  }

  if (!profile.active) {
  return null;
}

  const store = Array.isArray(profile.store)
    ? profile.store[0] ?? null
    : profile.store ?? null;

  return {
    id: profile.id,
    full_name: profile.full_name,
    role: profile.role,
    active: profile.active,
    email: user.email,
    store,
  };
}