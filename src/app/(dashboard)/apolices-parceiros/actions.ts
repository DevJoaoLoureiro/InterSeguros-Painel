"use server";

import { revalidatePath } from "next/cache";

import { AccessDeniedError, requireProfile } from "@/lib/auth/access";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  PARTNER_SUBMISSIONS_BUCKET,
  type SubmissionStatus,
} from "@/lib/partner-submissions/shared";

/*
 * Apólices enviadas pelos parceiros (formulário /parceiro/<token>).
 *
 * - OWNER/ADMIN veem todos os envios.
 * - Os restantes só veem os envios em que foram escolhidos.
 * Os rascunhos (DRAFT: parceiro ainda a carregar anexos) nunca
 * aparecem.
 */

export type SubmissionRecipient = {
  userId: string;
  name: string;
  seenAt: string | null;
  whatsappStatus: string | null;
  whatsappError: string | null;
};

export type SubmissionRow = {
  id: string;
  status: Exclude<SubmissionStatus, "DRAFT">;
  partnerName: string;
  clientName: string;
  clientNif: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  companyName: string | null;
  insuranceLine: string | null;
  policyNumber: string | null;
  premium: number | null;
  startDate: string | null;
  notes: string | null;
  submittedAt: string;
  handledByName: string | null;
  handledAt: string | null;
  files: { id: string; name: string; sizeBytes: number | null }[];
  recipients: SubmissionRecipient[];
  // O utilizador atual foi escolhido e ainda não abriu.
  unseenByMe: boolean;
  isRecipient: boolean;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export async function getPartnerSubmissions(): Promise<{
  rows: SubmissionRow[];
  isAdmin: boolean;
  currentUserId: string;
}> {
  const { profile, isAdmin } = await requireProfile();
  const admin = createAdminClient();

  let ids: string[] | null = null;

  if (!isAdmin) {
    const { data: mine } = await admin
      .from("partner_submission_recipients")
      .select("submission_id")
      .eq("user_id", profile.id);

    ids = (mine ?? []).map((row) => row.submission_id);

    if (ids.length === 0) {
      return { rows: [], isAdmin, currentUserId: profile.id };
    }
  }

  let query = admin
    .from("partner_submissions")
    .select(
      `
      id, status, client_name, client_nif, client_phone, client_email,
      company_name, insurance_line, policy_number, premium, start_date,
      notes, submitted_at, handled_at,
      partner:partners ( name ),
      handled_by:profiles!partner_submissions_handled_by_user_id_fkey ( full_name ),
      files:partner_submission_files ( id, file_name, size_bytes, created_at ),
      recipients:partner_submission_recipients (
        user_id, seen_at, whatsapp_status, whatsapp_error,
        profile:profiles ( full_name )
      )
    `,
    )
    .neq("status", "DRAFT")
    .order("submitted_at", { ascending: false })
    .limit(300);

  if (ids) query = query.in("id", ids);

  const { data, error } = await query;

  if (error) {
    throw new Error(`Erro ao carregar envios dos parceiros: ${error.message}`);
  }

  const rows: SubmissionRow[] = (data ?? []).map((row) => {
    const recipients: SubmissionRecipient[] = (row.recipients ?? []).map(
      (r) => ({
        userId: r.user_id,
        name: one(r.profile)?.full_name ?? "—",
        seenAt: r.seen_at,
        whatsappStatus: r.whatsapp_status,
        whatsappError: r.whatsapp_error,
      }),
    );

    const me = recipients.find((r) => r.userId === profile.id);

    return {
      id: row.id,
      status: row.status as SubmissionRow["status"],
      partnerName: one(row.partner)?.name ?? "Parceiro",
      clientName: row.client_name,
      clientNif: row.client_nif,
      clientPhone: row.client_phone,
      clientEmail: row.client_email,
      companyName: row.company_name,
      insuranceLine: row.insurance_line,
      policyNumber: row.policy_number,
      premium: row.premium === null ? null : Number(row.premium),
      startDate: row.start_date,
      notes: row.notes,
      submittedAt: row.submitted_at,
      handledByName: one(row.handled_by)?.full_name ?? null,
      handledAt: row.handled_at,
      files: [...(row.files ?? [])]
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((f) => ({ id: f.id, name: f.file_name, sizeBytes: f.size_bytes })),
      recipients,
      unseenByMe: Boolean(me && !me.seenAt),
      isRecipient: Boolean(me),
    };
  });

  return { rows, isAdmin, currentUserId: profile.id };
}

/* Admin, ou um dos destinatários do envio. */
async function requireSubmissionAccess(submissionId: string) {
  const context = await requireProfile();

  if (context.isAdmin) return context;

  const { data } = await createAdminClient()
    .from("partner_submission_recipients")
    .select("user_id")
    .eq("submission_id", submissionId)
    .eq("user_id", context.profile.id)
    .maybeSingle();

  if (!data) throw new AccessDeniedError();

  return context;
}

export async function markSubmissionSeen(submissionId: string) {
  const { profile } = await requireProfile();

  await createAdminClient()
    .from("partner_submission_recipients")
    .update({ seen_at: new Date().toISOString() })
    .eq("submission_id", submissionId)
    .eq("user_id", profile.id)
    .is("seen_at", null);

  revalidatePath("/apolices-parceiros");
}

export async function setSubmissionStatus(
  submissionId: string,
  status: "NEW" | "IN_PROGRESS" | "DONE",
) {
  if (!["NEW", "IN_PROGRESS", "DONE"].includes(status)) {
    throw new Error("Estado inválido.");
  }

  const { profile } = await requireSubmissionAccess(submissionId);
  const now = new Date().toISOString();

  const { error } = await createAdminClient()
    .from("partner_submissions")
    .update({
      status,
      handled_by_user_id: status === "DONE" ? profile.id : null,
      handled_at: status === "DONE" ? now : null,
      updated_at: now,
    })
    .eq("id", submissionId)
    .neq("status", "DRAFT");

  if (error) throw new Error(`Erro ao atualizar envio: ${error.message}`);

  revalidatePath("/apolices-parceiros");
}

/* Link temporário (5 min) para descarregar um anexo. */
export async function getSubmissionFileUrl(fileId: string) {
  const admin = createAdminClient();

  const { data: file } = await admin
    .from("partner_submission_files")
    .select("submission_id, storage_path, file_name")
    .eq("id", fileId)
    .maybeSingle();

  if (!file) throw new Error("Anexo não encontrado.");

  await requireSubmissionAccess(file.submission_id);

  const { data, error } = await admin.storage
    .from(PARTNER_SUBMISSIONS_BUCKET)
    .createSignedUrl(file.storage_path, 300);

  if (error || !data) throw new Error("Não foi possível abrir o anexo.");

  return data.signedUrl;
}
