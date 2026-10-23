"use client";

import { useEffect, useState, useTransition } from "react";
import {
  CheckCircle2,
  Download,
  FileText,
  Handshake,
  Inbox,
  Loader2,
  MessageCircle,
} from "lucide-react";

import { STATUS_LABELS, formatBytes } from "@/lib/partner-submissions/shared";

import {
  getSubmissionFileUrl,
  markSubmissionSeen,
  setSubmissionStatus,
  type SubmissionRow,
} from "./actions";

type Filter = "OPEN" | "DONE" | "ALL";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "OPEN", label: "Por tratar" },
  { value: "DONE", label: "Tratadas" },
  { value: "ALL", label: "Todas" },
];

const STATUS_CLASSES: Record<SubmissionRow["status"], string> = {
  NEW: "bg-orange-50 text-[#ea5b0c]",
  IN_PROGRESS: "bg-blue-50 text-blue-700",
  DONE: "bg-green-50 text-green-700",
};

const dateTime = new Intl.DateTimeFormat("pt-PT", {
  dateStyle: "short",
  timeStyle: "short",
});

const currency = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
});

export function PartnerSubmissionsBoard({
  rows,
  isAdmin,
  currentUserId,
}: {
  rows: SubmissionRow[];
  isAdmin: boolean;
  currentUserId: string;
}) {
  const [filter, setFilter] = useState<Filter>("OPEN");
  const [onlyMine, setOnlyMine] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visible = rows.filter(
    (row) =>
      (filter === "ALL" ||
        (filter === "DONE" ? row.status === "DONE" : row.status !== "DONE")) &&
      (!onlyMine || row.isRecipient),
  );

  const selected =
    visible.find((row) => row.id === selectedId) ?? visible[0] ?? null;

  // Abrir um envio marca-o como visto (para quem o recebeu).
  const selectedUnseen = selected?.unseenByMe ? selected.id : null;

  useEffect(() => {
    if (selectedUnseen) {
      markSubmissionSeen(selectedUnseen).catch(() => {});
    }
  }, [selectedUnseen]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-[#e4e6e9] bg-white p-0.5">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              className={[
                "h-8 rounded-lg px-3 text-xs font-medium transition",
                filter === item.value
                  ? "bg-[#ff4b0a] text-white"
                  : "text-[#59616d] hover:bg-[#f4f5f7]",
              ].join(" ")}
            >
              {item.label}
            </button>
          ))}
        </div>

        {isAdmin && (
          <label className="inline-flex items-center gap-2 text-sm text-[#59616d]">
            <input
              type="checkbox"
              checked={onlyMine}
              onChange={(e) => setOnlyMine(e.target.checked)}
              className="h-4 w-4 accent-[#ff4b0a]"
            />
            Só as enviadas para mim
          </label>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-[#e5e8ec] bg-white px-5 py-16 text-center shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
          <Inbox className="h-8 w-8 text-[#d5d8dc]" />
          <p className="text-sm text-[#8a9099]">
            {rows.length === 0
              ? "Ainda não chegou nenhuma apólice de parceiros."
              : "Nada nesta lista."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <ul className="max-h-[70vh] divide-y divide-[#eef0f2] overflow-y-auto rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
            {visible.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(row.id)}
                  className={[
                    "flex w-full items-start gap-3 px-4 py-3 text-left transition",
                    selected?.id === row.id
                      ? "bg-orange-50/60"
                      : "hover:bg-[#fafbfc]",
                  ].join(" ")}
                >
                  <span className="mt-1.5 flex h-2 w-2 shrink-0">
                    {row.unseenByMe && (
                      <span className="h-2 w-2 rounded-full bg-[#ff4b0a]" />
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span
                        className={[
                          "truncate text-sm text-[#20242a]",
                          row.unseenByMe ? "font-semibold" : "font-medium",
                        ].join(" ")}
                      >
                        {row.clientName}
                      </span>
                      <span className="shrink-0 text-[11px] text-[#8a9099]">
                        {dateTime.format(new Date(row.submittedAt))}
                      </span>
                    </span>

                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-[#7d848e]">
                        {row.partnerName}
                        {row.insuranceLine ? ` · ${row.insuranceLine}` : ""}
                      </span>
                      <span
                        className={[
                          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold",
                          STATUS_CLASSES[row.status],
                        ].join(" ")}
                      >
                        {STATUS_LABELS[row.status]}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {selected && (
            <SubmissionDetail
              key={selected.id}
              row={selected}
              canEdit={isAdmin || selected.isRecipient}
              currentUserId={currentUserId}
            />
          )}
        </div>
      )}
    </div>
  );
}

function SubmissionDetail({
  row,
  canEdit,
  currentUserId,
}: {
  row: SubmissionRow;
  canEdit: boolean;
  currentUserId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [openingFile, setOpeningFile] = useState<string | null>(null);

  function changeStatus(status: SubmissionRow["status"]) {
    setError(null);

    startTransition(async () => {
      try {
        await setSubmissionStatus(row.id, status);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao atualizar.");
      }
    });
  }

  async function openFile(fileId: string) {
    // A janela abre já (no clique) para o browser não a bloquear.
    const win = window.open("", "_blank");
    if (win) win.opener = null;
    setOpeningFile(fileId);
    setError(null);

    try {
      const url = await getSubmissionFileUrl(fileId);
      if (win) win.location.assign(url);
      else window.location.assign(url);
    } catch (err) {
      win?.close();
      setError(err instanceof Error ? err.message : "Erro ao abrir o anexo.");
    } finally {
      setOpeningFile(null);
    }
  }

  return (
    <section className="space-y-5 rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-[#20242a]">
            {row.clientName}
          </h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-[#737a84]">
            <Handshake className="h-4 w-4 text-[#ff4b0a]" />
            {row.partnerName} · {dateTime.format(new Date(row.submittedAt))}
          </p>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2">
            {pending && <Loader2 className="h-4 w-4 animate-spin text-[#8a9099]" />}

            {row.status === "NEW" && (
              <button
                type="button"
                onClick={() => changeStatus("IN_PROGRESS")}
                disabled={pending}
                className="h-9 rounded-lg border border-[#e4e6e9] px-3 text-xs font-semibold text-[#59616d] transition hover:border-[#ffb899] disabled:opacity-50"
              >
                Começar a tratar
              </button>
            )}

            {row.status !== "DONE" ? (
              <button
                type="button"
                onClick={() => changeStatus("DONE")}
                disabled={pending}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#ff4b0a] px-3 text-xs font-semibold text-white transition hover:bg-[#e64409] disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                Marcar como tratada
              </button>
            ) : (
              <button
                type="button"
                onClick={() => changeStatus("IN_PROGRESS")}
                disabled={pending}
                className="h-9 rounded-lg border border-[#e4e6e9] px-3 text-xs font-semibold text-[#59616d] transition hover:border-[#ffb899] disabled:opacity-50"
              >
                Reabrir
              </button>
            )}
          </div>
        )}
      </div>

      {row.status === "DONE" && row.handledAt && (
        <p className="rounded-xl bg-green-50 px-4 py-2.5 text-sm text-green-800">
          Tratada{row.handledByName ? ` por ${row.handledByName}` : ""} em{" "}
          {dateTime.format(new Date(row.handledAt))}.
        </p>
      )}

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Fields
          title="Cliente"
          items={[
            ["Nome", row.clientName],
            ["NIF", row.clientNif],
            ["Telemóvel", row.clientPhone],
            ["Email", row.clientEmail],
          ]}
        />
        <Fields
          title="Apólice"
          items={[
            ["Seguradora", row.companyName],
            ["Ramo / produto", row.insuranceLine],
            ["Nº da apólice", row.policyNumber],
            ["Prémio", row.premium === null ? null : currency.format(row.premium)],
            [
              "Data de início",
              row.startDate
                ? new Date(`${row.startDate}T00:00:00`).toLocaleDateString("pt-PT")
                : null,
            ],
          ]}
        />
      </div>

      {row.notes && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#8a9099]">
            Observações
          </h3>
          <p className="mt-1.5 whitespace-pre-wrap rounded-xl bg-[#fafbfc] px-4 py-3 text-sm text-[#40464f]">
            {row.notes}
          </p>
        </div>
      )}

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[#8a9099]">
          Anexos ({row.files.length})
        </h3>

        {row.files.length === 0 ? (
          <p className="mt-1.5 text-sm text-[#8a9099]">Sem anexos.</p>
        ) : (
          <ul className="mt-1.5 divide-y divide-[#eef0f2] rounded-xl border border-[#eef0f2]">
            {row.files.map((file) => (
              <li key={file.id}>
                <button
                  type="button"
                  onClick={() => openFile(file.id)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-[#fafbfc]"
                >
                  <FileText className="h-4 w-4 shrink-0 text-[#a0a5ac]" />
                  <span className="min-w-0 flex-1 truncate text-sm text-[#40464f]">
                    {file.name}
                  </span>
                  <span className="text-xs text-[#8a9099]">
                    {formatBytes(file.sizeBytes)}
                  </span>
                  {openingFile === file.id ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[#8a9099]" />
                  ) : (
                    <Download className="h-4 w-4 text-[#ff4b0a]" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[#8a9099]">
          Enviada para
        </h3>
        <ul className="mt-1.5 space-y-1.5">
          {row.recipients.map((recipient) => (
            <li
              key={recipient.userId}
              className="flex flex-wrap items-center gap-2 text-sm text-[#40464f]"
            >
              <span className="font-medium">
                {recipient.name}
                {recipient.userId === currentUserId ? " (tu)" : ""}
              </span>
              <WhatsappBadge
                status={recipient.whatsappStatus}
                error={recipient.whatsappError}
              />
              <span className="text-xs text-[#8a9099]">
                {recipient.seenAt
                  ? `viu ${dateTime.format(new Date(recipient.seenAt))}`
                  : "ainda não abriu"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function WhatsappBadge({
  status,
  error,
}: {
  status: string | null;
  error: string | null;
}) {
  const [label, classes] =
    status === "SENT"
      ? ["WhatsApp enviado", "bg-green-50 text-green-700"]
      : status === "NO_PHONE"
        ? ["Sem telemóvel", "bg-slate-100 text-slate-600"]
        : status === "FAILED"
          ? ["WhatsApp falhou", "bg-red-50 text-red-700"]
          : ["WhatsApp pendente", "bg-slate-100 text-slate-600"];

  return (
    <span
      title={error ?? undefined}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${classes}`}
    >
      <MessageCircle className="h-3 w-3" />
      {label}
    </span>
  );
}

function Fields({
  title,
  items,
}: {
  title: string;
  items: [string, string | null][];
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[#8a9099]">
        {title}
      </h3>
      <dl className="mt-1.5 space-y-1.5">
        {items.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 text-sm">
            <dt className="text-[#7d848e]">{label}</dt>
            <dd className="min-w-0 truncate text-right font-medium text-[#20242a]">
              {value || "—"}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
