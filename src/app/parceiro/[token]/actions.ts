"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { notifyRecipients } from "@/lib/partner-submissions/notify";
import { getPartnerByToken } from "@/lib/partner-submissions/partner-token";
import {
  MAX_FILES,
  PARTNER_SUBMISSIONS_BUCKET,
  validateUploadFile,
  type PartnerSubmissionInput,
  type UploadFileMeta,
} from "@/lib/partner-submissions/shared";

/*
 * Formulário público do parceiro (sem sessão). A única credencial é o
 * token do link: cada ação volta a validá-lo e a ler o parceiro da BD.
 *
 * Envio em dois passos, porque os anexos não passam pelo servidor (a
 * Vercel limita o pedido a ~4,5 MB):
 *   1. startPartnerSubmission: valida, cria o envio (DRAFT) e devolve
 *      um link de upload assinado por ficheiro;
 *   2. o browser carrega os ficheiros diretamente para o Storage;
 *   3. finishPartnerSubmission: confirma os ficheiros que chegaram,
 *      marca o envio como NEW e avisa os utilizadores por WhatsApp.
 */

// Limite simples contra abusos do link (por parceiro).
const MAX_SUBMISSIONS_PER_HOUR = 30;

async function requirePartner(token: string) {
  const partner = await getPartnerByToken(token);

  if (!partner) {
    throw new Error("Este link já não é válido. Pede um novo à Interseguros.");
  }

  return partner;
}

function text(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parsePremium(value: string) {
  if (!value) return null;

  const number = Number(value.replace(/\s|€/g, "").replace(",", "."));

  if (!Number.isFinite(number) || number < 0 || number > 10_000_000) {
    throw new Error("O prémio não é um valor válido.");
  }

  return Math.round(number * 100) / 100;
}

function parseDate(value: string) {
  if (!value) return null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error("A data de início não é válida.");
  }

  return value;
}

function safeFileName(name: string) {
  const cleaned = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return (cleaned || "ficheiro").slice(-80);
}

export async function startPartnerSubmission(
  token: string,
  input: PartnerSubmissionInput,
  files: UploadFileMeta[],
): Promise<{
  submissionId: string;
  uploads: { path: string; token: string }[];
}> {
  const partner = await requirePartner(token);
  const admin = createAdminClient();

  // ---------- validação ----------

  const clientName = text(input.clientName);
  if (clientName.length < 2) throw new Error("O nome do cliente é obrigatório.");

  const clientNif = text(input.clientNif, 20).replace(/\D/g, "");
  if (clientNif && clientNif.length !== 9) {
    throw new Error("O NIF tem de ter 9 dígitos.");
  }

  const recipientIds = Array.isArray(input.recipientIds)
    ? [...new Set(input.recipientIds.filter((id) => typeof id === "string"))]
    : [];

  if (recipientIds.length === 0) {
    throw new Error("Escolhe pelo menos uma pessoa para receber a apólice.");
  }

  const { data: recipients, error: recipientsError } = await admin
    .from("profiles")
    .select("id")
    .in("id", recipientIds)
    .eq("active", true);

  if (recipientsError || (recipients ?? []).length !== recipientIds.length) {
    throw new Error("Uma das pessoas escolhidas já não está disponível.");
  }

  if (!Array.isArray(files) || files.length > MAX_FILES) {
    throw new Error(`No máximo ${MAX_FILES} anexos.`);
  }

  for (const file of files) {
    const problem = validateUploadFile(file);
    if (problem) throw new Error(problem);
  }

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count } = await admin
    .from("partner_submissions")
    .select("id", { count: "exact", head: true })
    .eq("partner_id", partner.id)
    .gte("created_at", since);

  if ((count ?? 0) >= MAX_SUBMISSIONS_PER_HOUR) {
    throw new Error("Muitos envios seguidos. Tenta outra vez daqui a pouco.");
  }

  // ---------- gravar ----------

  const { data: submission, error } = await admin
    .from("partner_submissions")
    .insert({
      partner_id: partner.id,
      status: "DRAFT",
      client_name: clientName,
      client_nif: clientNif || null,
      client_phone: text(input.clientPhone, 30) || null,
      client_email: text(input.clientEmail, 120) || null,
      company_name: text(input.companyName, 120) || null,
      insurance_line: text(input.insuranceLine, 120) || null,
      policy_number: text(input.policyNumber, 60) || null,
      premium: parsePremium(text(input.premium, 30)),
      start_date: parseDate(text(input.startDate, 10)),
      notes: text(input.notes, 4000) || null,
    })
    .select("id")
    .single();

  if (error || !submission) {
    console.error("[Parceiros] Erro ao criar envio:", error);
    throw new Error("Não foi possível guardar o envio. Tenta outra vez.");
  }

  const { error: recipientsInsertError } = await admin
    .from("partner_submission_recipients")
    .insert(
      recipientIds.map((userId) => ({
        submission_id: submission.id,
        user_id: userId,
      })),
    );

  if (recipientsInsertError) {
    console.error("[Parceiros] Erro ao gravar destinatários:", recipientsInsertError);
    throw new Error("Não foi possível guardar o envio. Tenta outra vez.");
  }

  // ---------- links de upload ----------

  const uploads: { path: string; token: string }[] = [];
  const fileRows: Record<string, unknown>[] = [];

  for (const [index, file] of files.entries()) {
    const path = `${submission.id}/${index + 1}-${safeFileName(file.name)}`;

    const { data: signed, error: signError } = await admin.storage
      .from(PARTNER_SUBMISSIONS_BUCKET)
      .createSignedUploadUrl(path);

    if (signError || !signed) {
      console.error("[Parceiros] Erro ao preparar upload:", signError);
      throw new Error("Não foi possível preparar o envio dos anexos.");
    }

    uploads.push({ path, token: signed.token });
    fileRows.push({
      submission_id: submission.id,
      storage_path: path,
      file_name: file.name.slice(0, 200),
      mime_type: file.type,
      size_bytes: file.size,
    });
  }

  if (fileRows.length > 0) {
    const { error: filesError } = await admin
      .from("partner_submission_files")
      .insert(fileRows);

    if (filesError) {
      console.error("[Parceiros] Erro ao gravar anexos:", filesError);
      throw new Error("Não foi possível preparar o envio dos anexos.");
    }
  }

  return { submissionId: submission.id, uploads };
}

export async function finishPartnerSubmission(
  token: string,
  submissionId: string,
): Promise<{ missingFiles: string[] }> {
  const partner = await requirePartner(token);
  const admin = createAdminClient();

  const { data: submission } = await admin
    .from("partner_submissions")
    .select("id, client_name, status")
    .eq("id", submissionId)
    .eq("partner_id", partner.id)
    .maybeSingle();

  if (!submission || submission.status !== "DRAFT") {
    throw new Error("Envio não encontrado.");
  }

  // Só ficam os anexos que chegaram mesmo ao Storage.
  const [{ data: fileRows }, { data: stored }] = await Promise.all([
    admin
      .from("partner_submission_files")
      .select("id, storage_path, file_name")
      .eq("submission_id", submission.id),
    admin.storage
      .from(PARTNER_SUBMISSIONS_BUCKET)
      .list(submission.id, { limit: 100 }),
  ]);

  const storedPaths = new Set(
    (stored ?? []).map((object) => `${submission.id}/${object.name}`),
  );

  const missing = (fileRows ?? []).filter(
    (row) => !storedPaths.has(row.storage_path),
  );

  if (missing.length > 0) {
    await admin
      .from("partner_submission_files")
      .delete()
      .in(
        "id",
        missing.map((row) => row.id),
      );
  }

  const now = new Date().toISOString();

  const { error } = await admin
    .from("partner_submissions")
    .update({ status: "NEW", submitted_at: now, updated_at: now })
    .eq("id", submission.id)
    .eq("status", "DRAFT");

  if (error) {
    console.error("[Parceiros] Erro ao concluir envio:", error);
    throw new Error("Não foi possível concluir o envio. Tenta outra vez.");
  }

  // ---------- aviso por WhatsApp ----------

  const { data: recipients } = await admin
    .from("partner_submission_recipients")
    .select("user_id, profiles ( whatsapp_phone )")
    .eq("submission_id", submission.id);

  await notifyRecipients({
    submissionId: submission.id,
    partnerName: partner.name,
    clientName: submission.client_name,
    recipients: (recipients ?? []).map((row) => {
      const profile = Array.isArray(row.profiles)
        ? row.profiles[0]
        : row.profiles;

      return {
        userId: row.user_id,
        phone: (profile as { whatsapp_phone: string | null } | null)
          ?.whatsapp_phone ?? null,
      };
    }),
  });

  return { missingFiles: missing.map((row) => row.file_name) };
}
