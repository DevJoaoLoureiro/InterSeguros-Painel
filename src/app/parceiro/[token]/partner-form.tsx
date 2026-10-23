"use client";

import { useRef, useState } from "react";
import {
  CheckCircle2,
  FileText,
  Loader2,
  Paperclip,
  Send,
  X,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import {
  FILE_ACCEPT,
  MAX_FILES,
  PARTNER_SUBMISSIONS_BUCKET,
  fileMimeType,
  formatBytes,
  validateUploadFile,
  type PartnerSubmissionInput,
} from "@/lib/partner-submissions/shared";

import { finishPartnerSubmission, startPartnerSubmission } from "./actions";

const inputClass =
  "mt-1.5 h-10 w-full rounded-lg border border-[#e4e6e9] bg-white px-3 text-sm outline-none transition focus:border-[#ff4b0a]";

const labelClass = "text-xs font-medium text-[#7d848e]";

const EMPTY: Omit<PartnerSubmissionInput, "recipientIds"> = {
  clientName: "",
  clientNif: "",
  clientPhone: "",
  clientEmail: "",
  companyName: "",
  insuranceLine: "",
  policyNumber: "",
  premium: "",
  startDate: "",
  notes: "",
};

export function PartnerForm({
  token,
  partnerName,
  users,
  companies,
  lines,
}: {
  token: string;
  partnerName: string;
  users: { id: string; name: string }[];
  companies: string[];
  lines: string[];
}) {
  const [fields, setFields] = useState(EMPTY);
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ missingFiles: string[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const busy = progress !== null;

  function set<K extends keyof typeof EMPTY>(key: K, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function toggleRecipient(id: string) {
    setRecipientIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function addFiles(list: FileList | null) {
    if (!list) return;

    const added = Array.from(list);
    const problem = added
      .map((f) =>
        validateUploadFile({ name: f.name, size: f.size, type: fileMimeType(f) }),
      )
      .find(Boolean);

    if (problem) {
      setError(problem);
    } else if (files.length + added.length > MAX_FILES) {
      setError(`No máximo ${MAX_FILES} anexos.`);
    } else {
      setError(null);
      setFiles((prev) => [...prev, ...added]);
    }

    if (fileInput.current) fileInput.current.value = "";
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (fields.clientName.trim().length < 2) {
      setError("O nome do cliente é obrigatório.");
      return;
    }

    if (recipientIds.length === 0) {
      setError("Escolhe pelo menos uma pessoa para receber a apólice.");
      return;
    }

    setError(null);

    try {
      setProgress("A guardar…");

      const { submissionId, uploads } = await startPartnerSubmission(
        token,
        { ...fields, recipientIds },
        files.map((f) => ({ name: f.name, size: f.size, type: fileMimeType(f) })),
      );

      const storage = createClient().storage.from(PARTNER_SUBMISSIONS_BUCKET);

      for (const [index, upload] of uploads.entries()) {
        setProgress(`A enviar anexos (${index + 1}/${uploads.length})…`);

        const { error: uploadError } = await storage.uploadToSignedUrl(
          upload.path,
          upload.token,
          files[index],
          { contentType: fileMimeType(files[index]) },
        );

        // Um anexo que falhe não bloqueia o envio: o servidor confirma
        // o que chegou e avisamos no fim.
        if (uploadError) console.error(uploadError);
      }

      setProgress("A concluir…");

      setDone(await finishPartnerSubmission(token, submissionId));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Erro ao enviar. Tenta outra vez.",
      );
    } finally {
      setProgress(null);
    }
  }

  function reset() {
    setFields(EMPTY);
    setRecipientIds([]);
    setFiles([]);
    setDone(null);
    setError(null);
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <CheckCircle2 className="h-10 w-10 text-green-600" />
        <h1 className="text-lg font-semibold text-[#20242a]">
          Apólice enviada
        </h1>
        <p className="max-w-sm text-sm text-[#737a84]">
          A Interseguros já foi avisada. Obrigado!
        </p>

        {done.missingFiles.length > 0 && (
          <p className="max-w-sm rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Estes anexos não chegaram: {done.missingFiles.join(", ")}. Envia-os
            num novo pedido.
          </p>
        )}

        <button
          type="button"
          onClick={reset}
          className="mt-2 h-10 rounded-lg border border-[#e4e6e9] px-4 text-sm font-medium text-[#59616d] transition hover:border-[#ffb899]"
        >
          Enviar outra apólice
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="border-b border-[#edf0f2] px-5 py-4 sm:px-6">
        <h1 className="text-lg font-semibold text-[#20242a]">Enviar apólice</h1>
        <p className="mt-0.5 text-sm text-[#737a84]">
          Parceiro: <span className="font-medium">{partnerName}</span>
        </p>
      </div>

      <div className="space-y-6 px-5 py-5 sm:px-6">
        {/* CLIENTE */}

        <Section title="Cliente">
          <div className="sm:col-span-2">
            <label className={labelClass}>Nome *</label>
            <input
              type="text"
              value={fields.clientName}
              onChange={(e) => set("clientName", e.target.value)}
              required
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>NIF</label>
            <input
              type="text"
              inputMode="numeric"
              value={fields.clientNif}
              onChange={(e) => set("clientNif", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Telemóvel</label>
            <input
              type="tel"
              value={fields.clientPhone}
              onChange={(e) => set("clientPhone", e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Email</label>
            <input
              type="email"
              value={fields.clientEmail}
              onChange={(e) => set("clientEmail", e.target.value)}
              className={inputClass}
            />
          </div>
        </Section>

        {/* APÓLICE */}

        <Section title="Apólice">
          <div>
            <label className={labelClass}>Seguradora</label>
            <input
              type="text"
              list="partner-companies"
              value={fields.companyName}
              onChange={(e) => set("companyName", e.target.value)}
              className={inputClass}
            />
            <datalist id="partner-companies">
              {companies.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
          <div>
            <label className={labelClass}>Ramo / produto</label>
            <input
              type="text"
              list="partner-lines"
              value={fields.insuranceLine}
              onChange={(e) => set("insuranceLine", e.target.value)}
              className={inputClass}
            />
            <datalist id="partner-lines">
              {lines.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
          <div>
            <label className={labelClass}>Nº da apólice</label>
            <input
              type="text"
              value={fields.policyNumber}
              onChange={(e) => set("policyNumber", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Prémio (€)</label>
            <input
              type="text"
              inputMode="decimal"
              value={fields.premium}
              onChange={(e) => set("premium", e.target.value)}
              placeholder="0,00"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Data de início</label>
            <input
              type="date"
              value={fields.startDate}
              onChange={(e) => set("startDate", e.target.value)}
              className={inputClass}
            />
          </div>
        </Section>

        {/* ANEXOS */}

        <div>
          <h2 className="text-sm font-semibold text-[#20242a]">Anexos</h2>
          <p className="mt-0.5 text-xs text-[#8a9099]">
            PDF ou fotos (apólice, cartão de cidadão, carta de condução…). Até{" "}
            {MAX_FILES} ficheiros de 15 MB.
          </p>

          {files.length > 0 && (
            <ul className="mt-3 divide-y divide-[#eef0f2] rounded-xl border border-[#eef0f2]">
              {files.map((file, index) => (
                <li
                  key={`${file.name}-${index}`}
                  className="flex items-center gap-3 px-3 py-2"
                >
                  <FileText className="h-4 w-4 shrink-0 text-[#a0a5ac]" />
                  <span className="min-w-0 flex-1 truncate text-sm text-[#40464f]">
                    {file.name}
                  </span>
                  <span className="text-xs text-[#8a9099]">
                    {formatBytes(file.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setFiles((prev) => prev.filter((_, i) => i !== index))
                    }
                    disabled={busy}
                    className="rounded p-1 text-[#a0a5ac] hover:bg-[#f4f5f7] hover:text-[#606771]"
                    aria-label={`Remover ${file.name}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <input
            ref={fileInput}
            type="file"
            multiple
            accept={FILE_ACCEPT}
            onChange={(e) => addFiles(e.target.files)}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy || files.length >= MAX_FILES}
            className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg border border-dashed border-[#d5d8dc] px-4 text-sm font-medium text-[#59616d] transition hover:border-[#ff4b0a] hover:text-[#ff4b0a] disabled:opacity-50"
          >
            <Paperclip className="h-4 w-4" />
            Adicionar anexos
          </button>
        </div>

        {/* OBSERVAÇÕES */}

        <div>
          <label className="text-sm font-semibold text-[#20242a]">
            Observações
          </label>
          <textarea
            value={fields.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={4}
            className="mt-1.5 w-full rounded-lg border border-[#e4e6e9] bg-white px-3 py-2 text-sm outline-none transition focus:border-[#ff4b0a]"
          />
        </div>

        {/* DESTINATÁRIOS */}

        <div>
          <h2 className="text-sm font-semibold text-[#20242a]">
            Enviar para *
          </h2>
          <p className="mt-0.5 text-xs text-[#8a9099]">
            Quem deve tratar desta apólice. Pode ser mais do que uma pessoa.
          </p>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {users.map((user) => {
              const checked = recipientIds.includes(user.id);

              return (
                <label
                  key={user.id}
                  className={[
                    "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition",
                    checked
                      ? "border-[#ff4b0a] bg-orange-50 text-[#20242a]"
                      : "border-[#e4e6e9] text-[#40464f] hover:border-[#ffb899]",
                  ].join(" ")}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleRecipient(user.id)}
                    className="h-4 w-4 accent-[#ff4b0a]"
                  />
                  {user.name}
                </label>
              );
            })}
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      <div className="flex justify-end border-t border-[#edf0f2] px-5 py-4 sm:px-6">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-[#ff6a2b] to-[#ea5b0c] px-5 text-sm font-semibold text-white shadow-[0_2px_10px_rgba(234,91,12,0.28)] transition hover:shadow-[0_6px_18px_rgba(234,91,12,0.36)] disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {progress ?? "Enviar apólice"}
        </button>
      </div>
    </form>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-[#20242a]">{title}</h2>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}
