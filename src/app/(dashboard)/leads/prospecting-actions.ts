"use server";

import { revalidatePath } from "next/cache";

import { phoneKey, prospectSourceReference } from "@/lib/ai/tools/prospecting";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { generateCallScript } from "@/lib/prospecting/call-script";
import { gradeFromScore, leadInsuranceType } from "@/lib/prospecting/scoring";
import { PROSPECT_GRADE_LABELS, type Prospect } from "@/lib/prospecting/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { LeadPriority } from "@/types/lead";

type SaveProspectResult =
  | { success: true; leadId: string; duplicate: boolean }
  | { success: false; message: string };

const PRIORITY_BY_GRADE: Record<Prospect["grade"], LeadPriority> = {
  boa: "alta",
  media: "media",
  ma: "baixa",
};

/* Quem só vê as leads que lhe estão atribuídas fica já com a lead. */
const SELF_ASSIGN_ROLES = ["COMERCIAL", "GESTOR_COMERCIAL", "GESTOR_LOJA"];

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/* Os dados vêm do browser: só entra o que tem a forma esperada. */
function parseProspect(input: unknown): Prospect | null {
  if (typeof input !== "object" || input === null) return null;

  const raw = input as Record<string, unknown>;

  const placeId = text(raw.placeId, 200);
  const name = text(raw.name, 160);
  const phone = text(raw.phone, 30);
  const score = typeof raw.score === "number" && Number.isFinite(raw.score) ? raw.score : NaN;

  if (!placeId || name.length < 2 || !phoneKey(phone) || Number.isNaN(score)) return null;

  const products = Array.isArray(raw.products)
    ? raw.products.map((product) => text(product, 60)).filter(Boolean).slice(0, 5)
    : [];

  if (products.length === 0) return null;

  const boundedScore = Math.max(0, Math.min(100, Math.round(score)));
  const url = (value: unknown) => {
    const candidate = text(value, 500);
    return /^https?:\/\//i.test(candidate) ? candidate : null;
  };

  return {
    source: raw.source === "google" ? "google" : "web",
    placeId,
    name,
    activity: text(raw.activity, 120),
    address: text(raw.address, 300),
    locality: text(raw.locality, 120) || null,
    phone,
    phoneVerified: raw.phoneVerified === true,
    website: url(raw.website),
    mapsUrl: url(raw.mapsUrl),
    rating: typeof raw.rating === "number" && Number.isFinite(raw.rating) ? raw.rating : null,
    reviews: typeof raw.reviews === "number" && Number.isFinite(raw.reviews) ? Math.max(0, raw.reviews) : 0,
    grade: gradeFromScore(boundedScore),
    score: boundedScore,
    reason: text(raw.reason, 400),
    products,
    partnerHint: raw.partnerHint === true,
  };
}

export async function saveProspectAsLead(input: unknown): Promise<SaveProspectResult> {
  const profile = await getCurrentProfile();

  if (!profile) {
    return { success: false, message: "Não autenticado." };
  }

  const prospect = parseProspect(input);

  if (!prospect) {
    return { success: false, message: "Dados da empresa inválidos." };
  }

  const admin = createAdminClient();
  const sourceReference = prospectSourceReference(prospect.placeId);

  const { data: existingLead, error: existingError } = await admin
    .from("leads")
    .select("id")
    .eq("source_reference", sourceReference)
    .maybeSingle();

  if (existingError) {
    console.error("[PROSPEÇÃO] Erro ao procurar lead existente:", existingError);
    return { success: false, message: "Erro ao verificar se a lead já existe." };
  }

  if (existingLead) {
    return { success: true, leadId: existingLead.id, duplicate: true };
  }

  const firstName = (profile.full_name ?? "").trim().split(/\s+/)[0] || "a equipa";
  const callScript = await generateCallScript(prospect, firstName);

  const answers: Record<string, string> = {
    atividade: prospect.activity,
    morada: prospect.address,
    avaliacao_da_lead: `${PROSPECT_GRADE_LABELS[prospect.grade]} (${prospect.score}/100)`,
    motivo: prospect.reason,
    seguros_a_propor: prospect.products.join(", "),
    guiao_de_chamada: callScript,
  };

  if (prospect.rating !== null) {
    answers.avaliacao_google = `${prospect.rating.toLocaleString("pt-PT")} (${prospect.reviews} avaliações)`;
  }

  if (prospect.website) answers.website = prospect.website;

  if (prospect.mapsUrl) {
    answers[prospect.source === "google" ? "google_maps" : "fonte_do_contacto"] = prospect.mapsUrl;
  }

  if (!prospect.phoneVerified) {
    answers.telefone = "Por confirmar: não foi possível validar o número na página de origem.";
  }

  if (prospect.partnerHint) {
    answers.nota = "Contabilista: pode valer mais como parceiro que referencia clientes.";
  }

  const selfAssign = SELF_ASSIGN_ROLES.includes(profile.role);

  const { data: lead, error } = await admin
    .from("leads")
    .insert({
      source_reference: sourceReference,
      name: prospect.name,
      phone: prospect.phone,
      insurance_type: leadInsuranceType(prospect.products),
      status: "nova",
      priority: PRIORITY_BY_GRADE[prospect.grade],
      source: "prospecao",
      answers,
      privacy_consent: false,
      assigned_user_id: selfAssign ? profile.id : null,
      store_id: selfAssign ? (profile.store?.id ?? null) : null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[PROSPEÇÃO] Erro ao guardar lead:", error);
    return { success: false, message: `Erro ao guardar lead: ${error.message}` };
  }

  const { error: historyError } = await admin.from("lead_history").insert({
    lead_id: lead.id,
    event_type: "lead_created",
    description: `Lead criada por prospeção (${profile.full_name ?? "utilizador"}).`,
  });

  if (historyError) {
    console.error("[PROSPEÇÃO] Não foi possível guardar histórico:", historyError);
  }

  revalidatePath("/leads");
  revalidatePath("/dashboard");

  return { success: true, leadId: lead.id, duplicate: false };
}
