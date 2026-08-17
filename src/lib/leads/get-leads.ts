import { createClient } from "@/lib/supabase/server";

import type { Lead } from "@/types/lead";

export async function getLeads(): Promise<Lead[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return [];
  }

  const { data, error } = await supabase
    .from("leads")
    .select(`
      id,
      name,
      phone,
      insurance_type,
      status,
      priority,
      source,
      source_reference,
      answers,
      store_id,
      assigned_to,
      created_at,
      updated_at
    `)
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    console.error("Erro ao carregar leads:", error);
    return [];
  }

  return (data ?? []) as Lead[];
}