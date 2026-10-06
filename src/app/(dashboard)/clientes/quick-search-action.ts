"use server";

import { requireProfile } from "@/lib/auth/access";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Pesquisa rápida de clientes para a barra de topo (Ctrl+K): poucos
 * resultados e só o que é preciso para os reconhecer. Procura por
 * nome, NIF ou número de apólice.
 */

export type QuickClient = {
  id: string;
  name: string;
  nif: string | null;
  city: string | null;
  // Preenchido quando o cliente foi encontrado pelo nº de apólice.
  policyNumber: string | null;
};

const LIMIT = 7;

export async function searchClientsQuick(query: string): Promise<QuickClient[]> {
  await requireProfile();

  const text = query.trim().slice(0, 80);

  if (text.length < 2) return [];

  const admin = createAdminClient();
  const digits = text.replace(/\D/g, "");
  const looksLikeNumber = digits.length >= 3 && digits.length === text.replace(/\s/g, "").length;

  const [byName, byNif, byPolicy] = await Promise.all([
    looksLikeNumber
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("clients")
          .select("id, name, nif, city")
          .ilike("name", `%${text}%`)
          .order("name")
          .limit(LIMIT),

    digits.length >= 3
      ? admin
          .from("clients")
          .select("id, name, nif, city")
          .ilike("nif", `${digits}%`)
          .order("name")
          .limit(LIMIT)
      : Promise.resolve({ data: [], error: null }),

    text.length >= 4
      ? admin
          .from("policies")
          .select("policy_number, client:clients ( id, name, nif, city )")
          .ilike("policy_number", `%${text}%`)
          .limit(LIMIT)
      : Promise.resolve({ data: [], error: null }),
  ]);

  for (const result of [byName, byNif, byPolicy]) {
    if (result.error) {
      throw new Error(`Erro ao procurar clientes: ${result.error.message}`);
    }
  }

  const found = new Map<string, QuickClient>();

  for (const row of [...(byNif.data ?? []), ...(byName.data ?? [])]) {
    found.set(row.id, { ...row, policyNumber: null });
  }

  for (const row of byPolicy.data ?? []) {
    const client = (Array.isArray(row.client) ? row.client[0] : row.client) as
      | { id: string; name: string; nif: string | null; city: string | null }
      | null;

    if (client && !found.has(client.id)) {
      found.set(client.id, { ...client, policyNumber: row.policy_number });
    }
  }

  return [...found.values()].slice(0, LIMIT);
}
