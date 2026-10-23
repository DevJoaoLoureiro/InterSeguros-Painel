import { randomBytes } from "crypto";

import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Link do formulário de cada parceiro: /parceiro/<token>.
 * O token é a única credencial do parceiro — aleatório, só se guarda
 * na BD, e pode ser trocado (o antigo deixa de funcionar) ou apagado.
 */

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;

export function generatePartnerToken() {
  return randomBytes(24).toString("base64url");
}

export async function getPartnerByToken(token: string) {
  if (!TOKEN_PATTERN.test(token)) return null;

  const { data } = await createAdminClient()
    .from("partners")
    .select("id, name")
    .eq("submission_token", token)
    .eq("active", true)
    .maybeSingle();

  return data;
}
