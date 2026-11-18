"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { assertPolicyAccess, requireAdmin } from "@/lib/auth/access";
import {
  DOC_TYPES,
  MAX_FILES_PER_UPLOAD,
  POLICY_DOCUMENTS_BUCKET,
  validateUploadFile,
  type DocType,
  type PolicyDocument,
  type UploadFileMeta,
} from "@/lib/policy-documents/shared";

/*
 * Documentos anexados a uma apólice (supabase/migrations/
 * *_policy_documents.sql). Fluxo do upload, igual ao dos parceiros:
 *   1. startPolicyDocumentUpload: valida, cria as linhas (PENDING) e
 *      devolve um link de upload assinado por ficheiro;
 *   2. o browser envia cada ficheiro diretamente para o Storage;
 *   3. finishPolicyDocumentUpload: confirma o que chegou (READY) e
 *      apaga as linhas dos que falharam.
 * Abrir: link assinado de 5 minutos. Apagar: só OWNER/ADMIN.
 */

const SIGNED_URL_SECONDS = 300;

function safeFileName(name: string) {
  const cleaned = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return (cleaned || "ficheiro").slice(-80);
}

export async function listPolicyDocuments(policyId: string): Promise<{
  documents: PolicyDocument[];
  canDelete: boolean;
}> {
  const { isAdmin } = await assertPolicyAccess(policyId);
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("policy_documents")
    .select("id, created_at, doc_type, file_name, mime_type, size_bytes, uploader:profiles ( full_name )")
    .eq("policy_id", policyId)
    .eq("status", "READY")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Erro ao carregar documentos: ${error.message}`);

  return {
    canDelete: isAdmin,
    documents: (data ?? []).map((row) => {
      const uploader = Array.isArray(row.uploader) ? row.uploader[0] : row.uploader;
      return {
        id: row.id,
        createdAt: row.created_at,
        docType: row.doc_type as DocType,
        fileName: row.file_name,
        mimeType: row.mime_type,
        sizeBytes: Number(row.size_bytes),
        uploadedBy: (uploader as { full_name: string | null } | null)?.full_name ?? null,
      };
    }),
  };
}

export async function startPolicyDocumentUpload(
  policyId: string,
  docType: DocType,
  files: UploadFileMeta[],
): Promise<{ uploads: { documentId: string; path: string; token: string }[] }> {
  const { profile } = await assertPolicyAccess(policyId);

  if (!DOC_TYPES.includes(docType)) throw new Error("Tipo de documento inválido.");
  if (files.length === 0) throw new Error("Escolhe pelo menos um ficheiro.");
  if (files.length > MAX_FILES_PER_UPLOAD) {
    throw new Error(`No máximo ${MAX_FILES_PER_UPLOAD} ficheiros de cada vez.`);
  }

  for (const file of files) {
    const problem = validateUploadFile(file);
    if (problem) throw new Error(problem);
  }

  const admin = createAdminClient();
  const { data: policy } = await admin
    .from("policies")
    .select("id, client_id")
    .eq("id", policyId)
    .maybeSingle();

  if (!policy) throw new Error("Apólice não encontrada.");

  const uploads: { documentId: string; path: string; token: string }[] = [];

  for (const file of files) {
    const documentId = crypto.randomUUID();
    const path = `${policy.id}/${documentId}-${safeFileName(file.name)}`;

    const { data: signed, error: signError } = await admin.storage
      .from(POLICY_DOCUMENTS_BUCKET)
      .createSignedUploadUrl(path);

    if (signError || !signed) {
      console.error("[documentos] upload", signError);
      throw new Error("Não foi possível preparar o envio do ficheiro.");
    }

    const { error: insertError } = await admin.from("policy_documents").insert({
      id: documentId,
      policy_id: policy.id,
      client_id: policy.client_id,
      doc_type: docType,
      storage_path: path,
      file_name: file.name.slice(0, 200),
      mime_type: file.type,
      size_bytes: file.size,
      uploaded_by: profile.id,
    });

    if (insertError) {
      console.error("[documentos] registo", insertError);
      throw new Error("Não foi possível guardar o documento.");
    }

    uploads.push({ documentId, path, token: signed.token });
  }

  return { uploads };
}

export async function finishPolicyDocumentUpload(
  policyId: string,
  documentIds: string[],
): Promise<{ saved: number; failed: string[] }> {
  await assertPolicyAccess(policyId);
  if (documentIds.length === 0) return { saved: 0, failed: [] };

  const admin = createAdminClient();

  const [{ data: rows }, { data: stored }] = await Promise.all([
    admin
      .from("policy_documents")
      .select("id, storage_path, file_name")
      .eq("policy_id", policyId)
      .eq("status", "PENDING")
      .in("id", documentIds),
    admin.storage.from(POLICY_DOCUMENTS_BUCKET).list(policyId, { limit: 1000 }),
  ]);

  const storedPaths = new Set((stored ?? []).map((object) => `${policyId}/${object.name}`));
  const arrived = (rows ?? []).filter((row) => storedPaths.has(row.storage_path));
  const missing = (rows ?? []).filter((row) => !storedPaths.has(row.storage_path));

  if (arrived.length > 0) {
    await admin
      .from("policy_documents")
      .update({ status: "READY" })
      .in("id", arrived.map((row) => row.id));
  }

  if (missing.length > 0) {
    await admin
      .from("policy_documents")
      .delete()
      .in("id", missing.map((row) => row.id));
  }

  return { saved: arrived.length, failed: missing.map((row) => row.file_name) };
}

export async function getPolicyDocumentUrl(
  documentId: string,
  download = false,
): Promise<string> {
  const admin = createAdminClient();

  const { data: document } = await admin
    .from("policy_documents")
    .select("policy_id, storage_path, file_name")
    .eq("id", documentId)
    .eq("status", "READY")
    .maybeSingle();

  if (!document) throw new Error("Documento não encontrado.");
  await assertPolicyAccess(document.policy_id);

  const { data, error } = await admin.storage
    .from(POLICY_DOCUMENTS_BUCKET)
    .createSignedUrl(document.storage_path, SIGNED_URL_SECONDS, {
      download: download ? document.file_name : undefined,
    });

  if (error || !data) throw new Error("Não foi possível abrir o documento.");
  return data.signedUrl;
}

export async function deletePolicyDocument(documentId: string): Promise<void> {
  await requireAdmin();
  const admin = createAdminClient();

  const { data: document } = await admin
    .from("policy_documents")
    .select("id, storage_path")
    .eq("id", documentId)
    .maybeSingle();

  if (!document) return;

  const { error: storageError } = await admin.storage
    .from(POLICY_DOCUMENTS_BUCKET)
    .remove([document.storage_path]);

  if (storageError) throw new Error("Não foi possível apagar o ficheiro.");

  await admin.from("policy_documents").delete().eq("id", document.id);
}
