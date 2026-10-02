import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export const getCurrentProfile = cache(async () => {
  const supabase = await createClient();

  // 1. Utilizador autenticado
  //
  // getClaims() valida o JWT localmente (o projeto usa chaves
  // assimétricas ES256, JWKS em cache) — sem ida ao servidor de Auth
  // em cada pedido, ao contrário do getUser(). Utilizadores
  // desativados continuam bloqueados pelo profile.active abaixo.
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  const userId = claimsData?.claims?.sub;
  const userEmail =
    typeof claimsData?.claims?.email === "string"
      ? claimsData.claims.email
      : null;

  if (claimsError || !userId) {
    if (claimsError) {
      console.error("Erro ao carregar utilizador:", claimsError);
    }
    return null;
  }

  // 2. Profile + loja numa só consulta
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(`
      id,
      full_name,
      email,
      role,
      active,
      store_id,
      store:stores ( id, name, code )
    `)
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    console.error(
      "Erro ao carregar profile:",
      JSON.stringify(profileError, null, 2)
    );

    return null;
  }

  if (!profile) {
    console.error("Profile não encontrado para o utilizador:", userId);
    return null;
  }

  if (!profile.active) {
    console.error("Profile inativo:", userId);
    return null;
  }

  // 3. Loja (já veio no join)
  const storeRelation = profile.store as
    | { id: string; name: string; code: string | null }
    | { id: string; name: string; code: string | null }[]
    | null;

  const store = Array.isArray(storeRelation)
    ? (storeRelation[0] ?? null)
    : storeRelation;

  return {
    id: profile.id,
    full_name: profile.full_name,
    email: profile.email ?? userEmail ?? null,
    role: profile.role,
    active: profile.active,
    store,
  };
});