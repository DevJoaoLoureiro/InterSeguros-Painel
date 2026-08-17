"use client";

import { useEffect, useState } from "react";
import {
  Bot,
  Building2,
  CalendarDays,
  Check,
  Clock3,
  Mail,
  MapPin,
  MessageSquareText,
  Phone,
  Save,
  User,
  X,
} from "lucide-react";

import type {
  Lead,
  LeadStatus,
} from "@/types/lead";
import { LeadPriorityBadge } from "@/components/leads/lead-priority-badge";
import { LeadStatusBadge } from "@/components/leads/lead-status-badge";

type LeadDetailsDrawerProps = {
  lead: Lead | null;
  open: boolean;
  onClose: () => void;
};

const statusOptions: Array<{
  value: LeadStatus;
  label: string;
}> = [
  { value: "nova", label: "Nova" },
  { value: "em_contacto", label: "Em contacto" },
  { value: "a_aguardar", label: "A aguardar" },
  {
    value: "simulacao_enviada",
    label: "Simulação enviada",
  },
  { value: "convertida", label: "Convertida" },
  { value: "perdida", label: "Perdida" },
];

function formatDate(date: string) {
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

function formatAnswer(value: unknown) {
  if (value === true) return "Sim";
  if (value === false) return "Não";
  if (value === null || value === "") return "Não indicado";

  return String(value);
}

export function LeadDetailsDrawer({
  lead,
  open,
  onClose,
}: LeadDetailsDrawerProps) {
  const [notes, setNotes] = useState("");
  const [status, setStatus] =
    useState<LeadStatus>("nova");

  useEffect(() => {
    if (!lead) return;

    setNotes(lead.notes ?? "");
    setStatus(lead.status);
  }, [lead]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open, onClose]);

  return (
    <div
      className={[
        "fixed inset-0 z-[100] transition",
        open ? "pointer-events-auto" : "pointer-events-none",
      ].join(" ")}
      aria-hidden={!open}
    >
      <button
        type="button"
        aria-label="Fechar detalhe da lead"
        onClick={onClose}
        className={[
          "absolute inset-0 bg-slate-950/35 backdrop-blur-[1px] transition-opacity",
          open ? "opacity-100" : "opacity-0",
        ].join(" ")}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Detalhe da lead"
        className={[
          "absolute right-0 top-0 flex h-dvh w-full max-w-[680px] flex-col bg-[#f7f8fc] shadow-2xl transition-transform duration-300",
          open ? "translate-x-0" : "translate-x-full",
        ].join(" ")}
      >
        {lead && (
          <>
            <header className="shrink-0 border-b border-[#e5e8ec] bg-white px-5 py-5 sm:px-7">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <LeadStatusBadge status={status} />
                    <LeadPriorityBadge
                      priority={lead.priority}
                    />
                  </div>

                  <h2 className="mt-3 truncate text-2xl font-semibold tracking-tight text-[#17191d]">
                    {lead.name}
                  </h2>

                  <p className="mt-1 text-sm text-[#6f7680]">
                    {lead.insuranceType} · {lead.id}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#e1e4e8] text-[#59616d] transition hover:bg-[#f4f5f7]"
                  aria-label="Fechar"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                <select
                  value={status}
                  onChange={(event) =>
                    setStatus(
                      event.target.value as LeadStatus,
                    )
                  }
                  className="h-11 rounded-xl border border-[#dde1e6] bg-white px-3 text-sm outline-none focus:border-[#ff4b0a]"
                >
                  {statusOptions.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>

                <a
                  href={`tel:${lead.phone.replace(/\s/g, "")}`}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#dde1e6] bg-white px-4 text-sm font-semibold text-[#424852] transition hover:bg-[#f4f5f7]"
                >
                  <Phone className="h-4 w-4" />
                  Ligar
                </a>

                <a
                  href={
                    lead.email
                      ? `mailto:${lead.email}`
                      : undefined
                  }
                  aria-disabled={!lead.email}
                  className={[
                    "inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition",
                    lead.email
                      ? "bg-[#ff4b0a] text-white hover:bg-[#e94308]"
                      : "cursor-not-allowed bg-[#e5e7eb] text-[#9ca3af]",
                  ].join(" ")}
                >
                  <Mail className="h-4 w-4" />
                  Email
                </a>
              </div>
            </header>

            <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
              <section className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-sm">
                <h3 className="flex items-center gap-2 font-semibold text-[#20242a]">
                  <User className="h-4 w-4 text-[#ff4b0a]" />
                  Dados da lead
                </h3>

                <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-[#8a9099]">
                      Telefone
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-[#333842]">
                      {lead.phone}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs text-[#8a9099]">
                      Email
                    </dt>
                    <dd className="mt-1 break-all text-sm font-medium text-[#333842]">
                      {lead.email ?? "Não indicado"}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs text-[#8a9099]">
                      Data de nascimento
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-[#333842]">
                      {lead.birthDate ?? "Não indicada"}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs text-[#8a9099]">
                      Código postal
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-[#333842]">
                      {lead.postalCode ?? "Não indicado"}
                    </dd>
                  </div>

                  <div>
                    <dt className="flex items-center gap-1 text-xs text-[#8a9099]">
                      <Building2 className="h-3.5 w-3.5" />
                      Loja
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-[#333842]">
                      {lead.store}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs text-[#8a9099]">
                      Responsável
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-[#333842]">
                      {lead.assignedTo ?? "Por atribuir"}
                    </dd>
                  </div>

                  <div>
                    <dt className="flex items-center gap-1 text-xs text-[#8a9099]">
                      <MapPin className="h-3.5 w-3.5" />
                      Origem
                    </dt>
                    <dd className="mt-1 text-sm font-medium capitalize text-[#333842]">
                      {lead.source}
                    </dd>
                  </div>

                  <div>
                    <dt className="flex items-center gap-1 text-xs text-[#8a9099]">
                      <CalendarDays className="h-3.5 w-3.5" />
                      Data de entrada
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-[#333842]">
                      {formatDate(lead.createdAt)}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-sm">
                <h3 className="flex items-center gap-2 font-semibold text-[#20242a]">
                  <MessageSquareText className="h-4 w-4 text-[#ff4b0a]" />
                  Respostas do chatbot
                </h3>

                <dl className="mt-5 divide-y divide-[#edf0f2]">
                  {Object.entries(lead.answers).map(
                    ([question, answer]) => (
                      <div
                        key={question}
                        className="grid gap-1 py-3 sm:grid-cols-[200px_1fr]"
                      >
                        <dt className="text-sm text-[#7d848e]">
                          {question}
                        </dt>
                        <dd className="text-sm font-medium text-[#333842]">
                          {formatAnswer(answer)}
                        </dd>
                      </div>
                    ),
                  )}
                </dl>
              </section>

              <section className="rounded-2xl border border-orange-200 bg-orange-50/60 p-5 shadow-sm">
                <h3 className="flex items-center gap-2 font-semibold text-[#20242a]">
                  <Bot className="h-5 w-5 text-[#ff4b0a]" />
                  Recomendações comerciais
                </h3>

                {lead.recommendations.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    {lead.recommendations.map(
                      (recommendation) => (
                        <article
                          key={recommendation.id}
                          className="rounded-xl border border-orange-100 bg-white p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-[#20242a]">
                                {
                                  recommendation.insuranceType
                                }
                              </p>
                              <p className="mt-1 text-sm leading-6 text-[#656d78]">
                                {recommendation.reason}
                              </p>
                            </div>

                            <span className="shrink-0 rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">
                              {recommendation.confidence}%
                            </span>
                          </div>
                        </article>
                      ),
                    )}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-[#707782]">
                    Não existem recomendações para esta lead.
                  </p>
                )}
              </section>

              <section className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-sm">
                <h3 className="font-semibold text-[#20242a]">
                  Notas internas
                </h3>

                <textarea
                  value={notes}
                  onChange={(event) =>
                    setNotes(event.target.value)
                  }
                  rows={5}
                  placeholder="Adiciona informação útil para a equipa..."
                  className="mt-4 w-full resize-none rounded-xl border border-[#dde1e6] p-3 text-sm outline-none transition focus:border-[#ff4b0a] focus:ring-2 focus:ring-orange-100"
                />

                <button
                  type="button"
                  className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#242a32] px-4 text-sm font-semibold text-white transition hover:bg-[#171b20]"
                >
                  <Save className="h-4 w-4" />
                  Guardar nota
                </button>
              </section>

              <section className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-sm">
                <h3 className="flex items-center gap-2 font-semibold text-[#20242a]">
                  <Clock3 className="h-4 w-4 text-[#ff4b0a]" />
                  Histórico
                </h3>

                <div className="mt-5 space-y-4">
                  {lead.history.map((item) => (
                    <div
                      key={item.id}
                      className="relative pl-7"
                    >
                      <span className="absolute left-0 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-orange-100">
                        <Check className="h-2.5 w-2.5 text-[#ff4b0a]" />
                      </span>

                      <p className="text-sm font-semibold text-[#333842]">
                        {item.title}
                      </p>

                      {item.description && (
                        <p className="mt-1 text-sm text-[#737b86]">
                          {item.description}
                        </p>
                      )}

                      <p className="mt-1 text-xs text-[#9aa0a8]">
                        {formatDate(item.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}