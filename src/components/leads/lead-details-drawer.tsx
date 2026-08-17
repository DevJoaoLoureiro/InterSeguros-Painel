"use client";
import {
  Bot,
  CalendarDays,
  Clock3,
  MapPin,
  MessageSquareText,
  Phone,
  Save,
  ShieldCheck,
  User,
  UserRoundCheck,
  X,
} from "lucide-react";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { assignLead } from "@/app/(dashboard)/leads/actions";

import type {
  Lead,
  LeadStatus,
} from "@/types/lead";

import { LeadPriorityBadge } from "@/components/leads/lead-priority-badge";
import { LeadStatusBadge } from "@/components/leads/lead-status-badge";


type StoreOption = {
  id: string;
  name: string;
};

type CommercialOption = {
  id: string;
  full_name: string;
  store_id: string | null;
};



type LeadDetailsDrawerProps = {
  lead: Lead | null;
  stores: StoreOption[];
  commercials: CommercialOption[];
  currentUserRole: string | null;
  open: boolean;
  onClose: () => void;
};

const statusOptions: Array<{
  value: LeadStatus;
  label: string;
}> = [
  {
    value: "nova",
    label: "Nova",
  },
  {
    value: "em_contacto",
    label: "Em contacto",
  },
  {
    value: "proposta",
    label: "Proposta",
  },
  {
    value: "ganha",
    label: "Ganha",
  },
  {
    value: "perdida",
    label: "Perdida",
  },
];

function formatDate(
  date: string | null | undefined,
) {
  if (!date) {
    return "—";
  }

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsedDate);
}

function formatAnswer(value: unknown) {
  if (value === true) {
    return "Sim";
  }

  if (value === false) {
    return "Não";
  }

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "Não indicado";
  }

  return String(value);
}

function formatAnswerLabel(key: string) {
  const labels: Record<string, string> = {
    registration: "Matrícula",
    insuranceType: "Tipo de seguro",
    insurance_type: "Tipo de seguro",
    contact: "Contacto",
    phone: "Telefone",
    name: "Nome",
  };

  return (
    labels[key] ??
    key
      .replaceAll("_", " ")
      .replace(/^\w/, (character) =>
        character.toUpperCase(),
      )
  );
}

function getSourceLabel(
  source: string | null,
) {
  if (!source) {
    return "Não indicada";
  }

  const sources: Record<string, string> = {
    chatbot: "Chatbot",
    website: "Website",
    manual: "Manual",
  };

  return sources[source] ?? source;
}

export function LeadDetailsDrawer({
  lead,
  stores,
  commercials,
  currentUserRole,
  open,
  onClose,
}: LeadDetailsDrawerProps) {
  const router = useRouter();

  const [storeId, setStoreId] = useState("");
  const [commercialId, setCommercialId] =
    useState("");

  const [saving, setSaving] = useState(false);
  const [assignmentError, setAssignmentError] =
    useState<string | null>(null);

  const [assignmentSuccess, setAssignmentSuccess] =
    useState(false);

  useEffect(() => {
    if (!lead) {
      return;
    }

    setStoreId(lead.store_id ?? "");
    setCommercialId(lead.assigned_to ?? "");
    setAssignmentError(null);
    setAssignmentSuccess(false);
  }, [lead]);

  const availableCommercials = useMemo(() => {
    if (!storeId) {
      return [];
    }

    return commercials.filter(
      (commercial) =>
        commercial.store_id === storeId,
    );
  }, [commercials, storeId]);

  function handleStoreChange(
    newStoreId: string,
  ) {
    setStoreId(newStoreId);
    setCommercialId("");
    setAssignmentError(null);
    setAssignmentSuccess(false);
  }

  async function handleAssignment() {
    if (!lead) {
      return;
    }

    if (!storeId) {
      setAssignmentError(
        "Seleciona primeiro uma loja.",
      );
      return;
    }

    if (!commercialId) {
      setAssignmentError(
        "Seleciona um comercial.",
      );
      return;
    }

    try {
      setSaving(true);
      setAssignmentError(null);
      setAssignmentSuccess(false);

      await assignLead({
        leadId: lead.id,
        storeId,
        commercialId,
      });

      setAssignmentSuccess(true);

      router.refresh();
    } catch (error) {
      setAssignmentError(
        error instanceof Error
          ? error.message
          : "Não foi possível atribuir a lead.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!open || !lead) {
    return null;
  }

  const answers = Object.entries(
    lead.answers ?? {},
  );


  const registration =
    lead.answers?.registration;

  return (
    <div className="fixed inset-0 z-[100]">
      <button
        type="button"
        aria-label="Fechar detalhe da lead"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/35 backdrop-blur-[1px]"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Detalhe da lead"
        className="absolute right-0 top-0 flex h-dvh w-full max-w-[680px] flex-col bg-[#f7f8fc] shadow-2xl"
      >
        {/* HEADER */}

        <header className="shrink-0 border-b border-[#e5e8ec] bg-white px-5 py-5 sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <LeadStatusBadge
                  status={lead.status}
                />

                <LeadPriorityBadge
                  priority={lead.priority}
                />
              </div>

              <h2 className="mt-3 truncate text-2xl font-semibold tracking-tight text-[#17191d]">
                {lead.name}
              </h2>

              <p className="mt-1 text-sm text-[#6f7680]">
                {lead.insurance_type}
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

          <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="flex h-11 items-center rounded-xl border border-[#dde1e6] bg-[#f8f9fa] px-3 text-sm text-[#59616d]">
              Estado:{" "}
              <span className="ml-1 font-semibold">
                {
                  statusOptions.find(
                    (option) =>
                      option.value ===
                      lead.status,
                  )?.label
                }
              </span>
            </div>

            <a
              href={`tel:${lead.phone.replace(/\s/g, "")}`}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#ff4b0a] px-5 text-sm font-semibold text-white transition hover:bg-[#e94308]"
            >
              <Phone className="h-4 w-4" />
              Ligar
            </a>
          </div>
        </header>

        {/* BODY */}

        <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          {/* CONTACTO */}

          <section className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-sm">
            <h3 className="flex items-center gap-2 font-semibold text-[#20242a]">
              <User className="h-4 w-4 text-[#ff4b0a]" />
              Dados da lead
            </h3>

            <dl className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-[#8a9099]">
                  Nome
                </dt>

                <dd className="mt-1 text-sm font-medium text-[#333842]">
                  {lead.name}
                </dd>
              </div>

              <div>
                <dt className="text-xs text-[#8a9099]">
                  Telefone
                </dt>

                <dd className="mt-1">
                  <a
                    href={`tel:${lead.phone.replace(/\s/g, "")}`}
                    className="text-sm font-semibold text-[#ff4b0a] hover:underline"
                  >
                    {lead.phone}
                  </a>
                </dd>
              </div>

              <div>
                <dt className="flex items-center gap-1 text-xs text-[#8a9099]">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Tipo de seguro
                </dt>

                <dd className="mt-1 text-sm font-medium text-[#333842]">
                  {lead.insurance_type}
                </dd>
              </div>

              {registration && (
                <div>
                  <dt className="text-xs text-[#8a9099]">
                    Matrícula
                  </dt>

                  <dd className="mt-1 text-sm font-medium uppercase text-[#333842]">
                    {registration}
                  </dd>
                </div>
              )}

              <div>
                <dt className="flex items-center gap-1 text-xs text-[#8a9099]">
                  <MapPin className="h-3.5 w-3.5" />
                  Origem
                </dt>

                <dd className="mt-1 text-sm font-medium text-[#333842]">
                  {getSourceLabel(lead.source)}
                </dd>
              </div>

              <div>
                <dt className="flex items-center gap-1 text-xs text-[#8a9099]">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Data de entrada
                </dt>

                <dd className="mt-1 text-sm font-medium text-[#333842]">
                  {formatDate(
                    lead.created_at,
                  )}
                </dd>
              </div>
            </dl>
          </section>

          {/* RESPOSTAS CHATBOT */}

          <section className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-sm">
            <h3 className="flex items-center gap-2 font-semibold text-[#20242a]">
              <MessageSquareText className="h-4 w-4 text-[#ff4b0a]" />
              Respostas do chatbot
            </h3>

            {answers.length > 0 ? (
              <dl className="mt-5 divide-y divide-[#edf0f2]">
                {answers.map(
                  ([question, answer]) => (
                    <div
                      key={question}
                      className="grid gap-1 py-3 sm:grid-cols-[200px_1fr]"
                    >
                      <dt className="text-sm text-[#7d848e]">
                        {formatAnswerLabel(
                          question,
                        )}
                      </dt>

                      <dd className="text-sm font-medium text-[#333842]">
                        {formatAnswer(
                          answer,
                        )}
                      </dd>
                    </div>
                  ),
                )}
              </dl>
            ) : (
              <p className="mt-4 text-sm text-[#707782]">
                Não existem respostas
                adicionais para esta lead.
              </p>
            )}
          </section>

            {/* GESTÃO / ATRIBUIÇÃO */}
          {currentUserRole === "OWNER" && (
          <section className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50">
                <UserRoundCheck className="h-5 w-5 text-[#ff4b0a]" />
              </div>

              <div>
                <h3 className="font-semibold text-[#20242a]">
                  Atribuição da lead
                </h3>

                <p className="mt-1 text-sm text-[#7d848e]">
                  Seleciona a loja e o comercial responsável
                  por esta lead.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {/* LOJA */}

              <div>
                <label
                  htmlFor="lead-store"
                  className="text-xs font-semibold text-[#6f7680]"
                >
                  Loja
                </label>

                <select
                  id="lead-store"
                  value={storeId}
                  onChange={(event) =>
                    handleStoreChange(event.target.value)
                  }
                  className="mt-2 h-11 w-full rounded-xl border border-[#dde1e6] bg-white px-3 text-sm text-[#333842] outline-none transition focus:border-[#ff4b0a] focus:ring-2 focus:ring-orange-100"
                >
                  <option value="">
                    Selecionar loja
                  </option>

                  {stores.map((store) => (
                    <option
                      key={store.id}
                      value={store.id}
                    >
                      {store.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* COMERCIAL */}

              <div>
                <label
                  htmlFor="lead-commercial"
                  className="text-xs font-semibold text-[#6f7680]"
                >
                  Comercial
                </label>

                <select
                  id="lead-commercial"
                  value={commercialId}
                  disabled={!storeId}
                  onChange={(event) => {
                    setCommercialId(event.target.value);
                    setAssignmentError(null);
                    setAssignmentSuccess(false);
                  }}
                  className="mt-2 h-11 w-full rounded-xl border border-[#dde1e6] bg-white px-3 text-sm text-[#333842] outline-none transition disabled:cursor-not-allowed disabled:bg-[#f4f5f7] disabled:text-[#9ca3af] focus:border-[#ff4b0a] focus:ring-2 focus:ring-orange-100"
                >
                  <option value="">
                    {!storeId
                      ? "Seleciona uma loja primeiro"
                      : "Selecionar comercial"}
                  </option>

                  {availableCommercials.map(
                    (commercial) => (
                      <option
                        key={commercial.id}
                        value={commercial.id}
                      >
                        {commercial.full_name}
                      </option>
                    ),
                  )}
                </select>
              </div>
            </div>

            {/* SEM COMERCIAIS */}

            {storeId &&
              availableCommercials.length === 0 && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Não existem comerciais ativos associados a
                  esta loja.
                </div>
              )}

            {/* ERRO */}

            {assignmentError && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {assignmentError}
              </div>
            )}

            {/* SUCESSO */}

            {assignmentSuccess && (
              <div className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
                Lead atribuída com sucesso.
              </div>
            )}

            {/* BOTÃO */}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={handleAssignment}
                disabled={
                  saving ||
                  !storeId ||
                  !commercialId
                }
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#ff4b0a] px-5 text-sm font-semibold text-white transition hover:bg-[#e94308] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save className="h-4 w-4" />

                {saving
                  ? "A guardar..."
                  : lead.assigned_to
                    ? "Alterar atribuição"
                    : "Atribuir lead"}
              </button>
            </div>
          </section>
          )}
        </div>
      </aside>
    </div>
  );
}