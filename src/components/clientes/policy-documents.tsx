"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ExternalLink, FileText, ImageIcon, Loader2, Paperclip, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import {
  deletePolicyDocument,
  finishPolicyDocumentUpload,
  getPolicyDocumentUrl,
  listPolicyDocuments,
  startPolicyDocumentUpload,
} from "@/lib/policy-documents/actions";
import {
  DOC_TYPES,
  DOC_TYPE_LABELS,
  FILE_ACCEPT,
  MAX_FILES_PER_UPLOAD,
  POLICY_DOCUMENTS_BUCKET,
  fileMimeType,
  validateUploadFile,
  type DocType,
  type PolicyDocument,
} from "@/lib/policy-documents/shared";

/*
 * Documentos de uma apólice (ficha da apólice): anexar (escolher ou
 * arrastar), abrir, descarregar e — só administradores — apagar.
 * Os ficheiros vão do browser diretamente para o Storage.
 */

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(iso),
  );
}

export function PolicyDocuments({ policyId }: { policyId: string }) {
  const [documents, setDocuments] = useState<PolicyDocument[]>([]);
  const [canDelete, setCanDelete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [docType, setDocType] = useState<DocType>("APOLICE");
  const [progress, setProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const result = await listPolicyDocuments(policyId);
      setDocuments(result.documents);
      setCanDelete(result.canDelete);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Erro ao carregar documentos." });
    } finally {
      setLoading(false);
    }
  }, [policyId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function upload(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0 || progress) return;

    setMessage(null);

    if (files.length > MAX_FILES_PER_UPLOAD) {
      setMessage({ tone: "error", text: `No máximo ${MAX_FILES_PER_UPLOAD} ficheiros de cada vez.` });
      return;
    }

    const metas = files.map((file) => ({ name: file.name, size: file.size, type: fileMimeType(file) }));
    const problem = metas.map(validateUploadFile).find(Boolean);
    if (problem) {
      setMessage({ tone: "error", text: problem });
      return;
    }

    try {
      setProgress("A preparar…");
      const { uploads } = await startPolicyDocumentUpload(policyId, docType, metas);
      const storage = createClient().storage.from(POLICY_DOCUMENTS_BUCKET);

      for (const [index, item] of uploads.entries()) {
        setProgress(`A enviar ${index + 1} de ${uploads.length}…`);
        const { error } = await storage.uploadToSignedUrl(item.path, item.token, files[index], {
          contentType: metas[index].type,
        });
        // Um ficheiro que falhe não bloqueia os outros: o servidor
        // confirma o que chegou.
        if (error) console.error(error);
      }

      setProgress("A concluir…");
      const result = await finishPolicyDocumentUpload(
        policyId,
        uploads.map((item) => item.documentId),
      );

      setMessage(
        result.failed.length > 0
          ? { tone: "error", text: `Não foi possível enviar: ${result.failed.join(", ")}.` }
          : { tone: "ok", text: result.saved === 1 ? "Documento anexado." : `${result.saved} documentos anexados.` },
      );
      await load();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Erro ao anexar." });
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function open(documentId: string, download: boolean) {
    // Abre o separador já (os browsers bloqueiam janelas abertas depois
    // de um pedido assíncrono) e aponta-o para o link quando chegar.
    const tab = download ? null : window.open("", "_blank");
    try {
      const url = await getPolicyDocumentUrl(documentId, download);
      if (tab) tab.location.assign(url);
      else window.location.assign(url);
    } catch (error) {
      tab?.close();
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Erro ao abrir." });
    }
  }

  async function remove(documentId: string) {
    setConfirmDelete(null);
    try {
      await deletePolicyDocument(documentId);
      setDocuments((current) => current.filter((doc) => doc.id !== documentId));
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Erro ao apagar." });
    }
  }

  return (
    <section className="rounded-2xl border border-[#e5e8ec] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#edf0f2] px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-[#20242a]">
          <Paperclip className="h-4 w-4 text-[#ff4b0a]" />
          Documentos
          {documents.length > 0 && <span className="text-xs font-normal text-[#8a9099]">({documents.length})</span>}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={docType}
            onChange={(event) => setDocType(event.target.value as DocType)}
            disabled={Boolean(progress)}
            className="h-9 rounded-lg border border-[#e1e4e8] bg-white px-2 text-xs text-[#3b4048] outline-none focus:border-[#ff4b0a]"
            aria-label="Tipo de documento"
          >
            {DOC_TYPES.map((type) => (
              <option key={type} value={type}>
                {DOC_TYPE_LABELS[type]}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={Boolean(progress)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#20242a] px-3 text-xs font-semibold text-white transition hover:bg-[#33383f] disabled:opacity-60"
          >
            {progress ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
            {progress ?? "Anexar"}
          </button>

          <input
            ref={inputRef}
            type="file"
            multiple
            accept={FILE_ACCEPT}
            className="hidden"
            onChange={(event) => event.target.files && void upload(event.target.files)}
          />
        </div>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void upload(event.dataTransfer.files);
        }}
        className={`px-4 py-3 transition ${dragging ? "bg-[#fff1eb]" : ""}`}
      >
        {message && (
          <p
            className={`mb-2 rounded-lg px-3 py-2 text-xs ${
              message.tone === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
            }`}
          >
            {message.text}
          </p>
        )}

        {loading ? (
          <p className="flex items-center gap-2 py-3 text-xs text-[#8a9099]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> A carregar documentos…
          </p>
        ) : documents.length === 0 ? (
          <p className="py-3 text-center text-xs text-[#8a9099]">
            {dragging ? "Larga aqui para anexar." : "Sem documentos. Arrasta um PDF para aqui ou carrega em Anexar."}
          </p>
        ) : (
          <ul className="divide-y divide-[#f0f2f4]">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center gap-3 py-2.5">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f4f5f7] text-[#6b727c]">
                  {doc.mimeType === "application/pdf" ? <FileText className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                </span>

                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => void open(doc.id, false)}
                    className="block max-w-full truncate text-left text-sm font-medium text-[#24272d] hover:text-[#ff4b0a]"
                    title={doc.fileName}
                  >
                    {doc.fileName}
                  </button>
                  <p className="truncate text-[11px] text-[#8a9099]">
                    {DOC_TYPE_LABELS[doc.docType]} · {formatSize(doc.sizeBytes)} · {formatDate(doc.createdAt)}
                    {doc.uploadedBy ? ` · ${doc.uploadedBy}` : ""}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void open(doc.id, false)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#6b727c] hover:bg-[#f4f5f7]"
                    aria-label="Abrir"
                    title="Abrir"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void open(doc.id, true)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#6b727c] hover:bg-[#f4f5f7]"
                    aria-label="Descarregar"
                    title="Descarregar"
                  >
                    <Download className="h-4 w-4" />
                  </button>

                  {canDelete &&
                    (confirmDelete === doc.id ? (
                      <span className="flex items-center gap-1 text-xs">
                        <button
                          type="button"
                          onClick={() => void remove(doc.id)}
                          className="rounded-md bg-red-600 px-2 py-1 font-semibold text-white hover:bg-red-700"
                        >
                          Apagar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(null)}
                          className="rounded-md px-2 py-1 text-[#6b727c] hover:bg-[#f4f5f7]"
                        >
                          Cancelar
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(doc.id)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#b4b9c0] hover:bg-red-50 hover:text-red-600"
                        aria-label="Apagar"
                        title="Apagar (só administradores)"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
