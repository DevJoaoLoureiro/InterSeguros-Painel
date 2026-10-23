"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidateReference } from "@/lib/cache/reference-data";
import { generatePartnerToken } from "@/lib/partner-submissions/partner-token";

export type PartnerRow = {
  id: string;
  name: string;
  partner_type: string | null;
  nif: string | null;
  email: string | null;
  phone: string | null;
  active: boolean;
  created_at: string;
  policies_count: number;
  // Link do formulário de envio de apólices (/parceiro/<token>).
  submission_token: string | null;
};

export type PartnerInput = {
  name: string;
  partnerType: string;
  nif: string | null;
  email: string | null;
  phone: string | null;
};

const PARTNER_TYPES = ["PARTNER", "COMPANY", "PERSON"];

async function requireProfile() {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Não autenticado.");

  return {
    profile,
    isAdmin: profile.role === "OWNER" || profile.role === "ADMIN",
  };
}

async function requireAdmin() {
  const { isAdmin } = await requireProfile();

  if (!isAdmin) {
    throw new Error("Só administradores podem gerir parceiros.");
  }
}

function clean(input: PartnerInput) {
  const name = input.name.trim();

  if (!name) throw new Error("O nome é obrigatório.");

  if (!PARTNER_TYPES.includes(input.partnerType)) {
    throw new Error("Tipo de parceiro inválido.");
  }

  return {
    name,
    partner_type: input.partnerType,
    nif: input.nif?.replace(/\D/g, "") || null,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
  };
}

export async function getPartnersData(): Promise<{
  partners: PartnerRow[];
  isAdmin: boolean;
}> {
  const { isAdmin } = await requireProfile();
  const admin = createAdminClient();

  const [partnersResult, policiesResult] = await Promise.all([
    admin
      .from("partners")
      .select(
        "id, name, partner_type, nif, email, phone, active, created_at, submission_token",
      )
      .order("active", { ascending: false })
      .order("name", { ascending: true }),
    admin
      .from("policies")
      .select("partner_id")
      .not("partner_id", "is", null),
  ]);

  if (partnersResult.error) {
    throw new Error(
      `Erro ao carregar parceiros: ${partnersResult.error.message}`,
    );
  }

  const counts = new Map<string, number>();

  for (const row of policiesResult.data ?? []) {
    counts.set(row.partner_id, (counts.get(row.partner_id) ?? 0) + 1);
  }

  return {
    isAdmin,
    partners: (partnersResult.data ?? []).map((partner) => ({
      ...partner,
      // O link é uma credencial: só os administradores o veem.
      submission_token: isAdmin ? partner.submission_token : null,
      policies_count: counts.get(partner.id) ?? 0,
    })),
  };
}

export async function createPartner(input: PartnerInput) {
  await requireAdmin();

  const { error } = await createAdminClient()
    .from("partners")
    .insert({ ...clean(input), active: true });

  if (error) throw new Error(`Erro ao criar parceiro: ${error.message}`);

  revalidatePath("/configuracoes/parceiros");
  invalidateReference("partners");
}

export async function updatePartner(id: string, input: PartnerInput) {
  await requireAdmin();

  const { error } = await createAdminClient()
    .from("partners")
    .update({ ...clean(input), updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw new Error(`Erro ao guardar parceiro: ${error.message}`);

  revalidatePath("/configuracoes/parceiros");
  invalidateReference("partners");
}

/*
 * Desativar em vez de apagar: as apólices que já têm este parceiro
 * como origem mantêm-no; só deixa de aparecer para novas escolhas.
 */
export async function setPartnerActive(id: string, active: boolean) {
  await requireAdmin();

  const { error } = await createAdminClient()
    .from("partners")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw new Error(`Erro ao atualizar parceiro: ${error.message}`);

  revalidatePath("/configuracoes/parceiros");
  invalidateReference("partners");
}

/*
 * Link do formulário de envio de apólices. Gerar de novo troca o
 * token: o link antigo deixa de funcionar na hora.
 */
export async function generatePartnerLink(id: string) {
  await requireAdmin();

  const token = generatePartnerToken();

  const { error } = await createAdminClient()
    .from("partners")
    .update({
      submission_token: token,
      submission_token_created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(`Erro ao gerar link: ${error.message}`);

  revalidatePath("/configuracoes/parceiros");

  return token;
}

export async function removePartnerLink(id: string) {
  await requireAdmin();

  const { error } = await createAdminClient()
    .from("partners")
    .update({
      submission_token: null,
      submission_token_created_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(`Erro ao desativar link: ${error.message}`);

  revalidatePath("/configuracoes/parceiros");
}
