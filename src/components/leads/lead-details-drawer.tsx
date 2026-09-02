"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";

import {
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

import {
  approveConversionRequest,
  assignLead,
  getConversionRequest,
  reassignLead,
  rejectConversionRequest,
  submitConversionRequest,
  updateLeadStatus,
} from "@/app/(dashboard)/leads/actions";

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

type PendingConversionRequest = {
  id: string;
  lead_id: string;

  company: string;
  premium: number;
  reference: string;
  start_date: string;

  notes: string | null;

  submitted_by: string;
  submitted_by_name: string;

  created_at: string;

  document_url: string;
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
    value: "a_aguardar",
    label: "A aguardar",
  },
  {
    value: "simulacao_enviada",
    label: "Simulação enviada",
  },
  {
    value: "proposta",
    label: "Proposta",
  },
  {
    value: "ganha",
    label: "Por validar",
  },
  {
    value: "convertida",
    label: "Convertida",
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

  if (
    Number.isNaN(parsedDate.getTime())
  ) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "pt-PT",
    {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  ).format(parsedDate);
}

function formatSimpleDate(
  date: string | null | undefined,
) {
  if (!date) {
    return "—";
  }

  const parsedDate = new Date(
    `${date}T12:00:00`,
  );

  if (
    Number.isNaN(parsedDate.getTime())
  ) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "pt-PT",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    },
  ).format(parsedDate);
}

function formatCurrency(
  value: number,
) {
  return new Intl.NumberFormat(
    "pt-PT",
    {
      style: "currency",
      currency: "EUR",
    },
  ).format(value);
}

function formatAnswer(
  value: unknown,
) {
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

function formatAnswerLabel(
  key: string,
) {
  const labels: Record<
    string,
    string
  > = {
    registration: "Matrícula",
    insuranceType:
      "Tipo de seguro",
    insurance_type:
      "Tipo de seguro",
    contact: "Contacto",
    phone: "Telefone",
    name: "Nome",
  };

  return (
    labels[key] ??
    key
      .replaceAll("_", " ")
      .replace(
        /^\w/,
        (character) =>
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

  const sources: Record<
    string,
    string
  > = {
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

  // ========================================
  // ATRIBUIÇÃO
  // ========================================

  const [
    storeId,
    setStoreId,
  ] = useState("");

  const [
    commercialId,
    setCommercialId,
  ] = useState("");

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    assignmentError,
    setAssignmentError,
  ] = useState<string | null>(
    null,
  );

  const [
    editingAssignment,
    setEditingAssignment,
  ] = useState(false);

  // ========================================
  // ESTADO
  // ========================================

  const [
    selectedStatus,
    setSelectedStatus,
  ] = useState<LeadStatus>(
    "nova",
  );

  const [
    savingStatus,
    setSavingStatus,
  ] = useState(false);

  const [
    statusError,
    setStatusError,
  ] = useState<string | null>(
    null,
  );

  // ========================================
  // SUBMISSÃO PARA VALIDAÇÃO
  // ========================================

  const [
    showConversionForm,
    setShowConversionForm,
  ] = useState(false);

  const [
    submittingConversion,
    setSubmittingConversion,
  ] = useState(false);

  const [
    conversionError,
    setConversionError,
  ] = useState<string | null>(
    null,
  );

  // ========================================
  // REVISÃO DA CONVERSÃO
  // ========================================

  const [
    pendingConversion,
    setPendingConversion,
  ] =
    useState<PendingConversionRequest | null>(
      null,
    );

  const [
    loadingConversionReview,
    setLoadingConversionReview,
  ] = useState(false);

  const [
    reviewingConversion,
    setReviewingConversion,
  ] = useState(false);

  const [
    reviewError,
    setReviewError,
  ] = useState<string | null>(
    null,
  );

  const [
    showRejectForm,
    setShowRejectForm,
  ] = useState(false);

  const [
    rejectionReason,
    setRejectionReason,
  ] = useState("");

// ========================================
// SINCRONIZAR QUANDO MUDA A LEAD
// ========================================

useEffect(() => {
  if (!lead) {
    setStoreId("");
    setCommercialId("");
    return;
  }

  setStoreId(lead.store_id ?? "");
  setCommercialId(lead.assigned_user_id ?? "");
  setEditingAssignment(false);
}, [lead]);
 
  // ========================================
  // CARREGAR PEDIDO PENDENTE
  // PARA OWNER / ADMIN / GESTOR
  // ========================================

  useEffect(() => {
      if (
      !lead ||
      (
        lead.status !== "ganha" &&
        lead.status !== "convertida"
      )
    ) {
      setPendingConversion(null);

      return;
    }

  const leadId = lead.id;


  let cancelled = false;

  async function loadRequest() {
    try {
      setLoadingConversionReview(true);
      setReviewError(null);

      const request =
        await getConversionRequest(
          leadId,
        );

      if (!cancelled) {
        setPendingConversion(
          request,
        );
      }
    } catch (error) {
      if (!cancelled) {
        setReviewError(
          error instanceof Error
            ? error.message
            : "Erro ao carregar pedido de validação.",
        );
      }
    } finally {
      if (!cancelled) {
        setLoadingConversionReview(
          false,
        );
      }
    }
  }

  void loadRequest();

  return () => {
    cancelled = true;
  };
}, [
  lead,
  currentUserRole,
]);
  // ========================================
  // COMERCIAIS DA LOJA
  // ========================================

  const availableCommercials =
    useMemo(() => {
      if (!storeId) {
        return [];
      }

      return commercials.filter(
        (commercial) =>
          commercial.store_id ===
          storeId,
      );
    }, [
      commercials,
      storeId,
    ]);

  const isAssigned = Boolean(
    lead?.assigned_user_id,
  );

  const canReviewConversion =
    currentUserRole === "OWNER" ||
    currentUserRole === "ADMIN" ||
    currentUserRole ===
      "GESTOR_LOJA";

  // ========================================
  // ATRIBUIÇÃO
  // ========================================

  function handleStoreChange(
    newStoreId: string,
  ) {
    setStoreId(newStoreId);

    setCommercialId("");

    setAssignmentError(null);
  }

  function cancelReassignment() {
    if (!lead) {
      return;
    }

    setStoreId(
      lead.store_id ?? "",
    );

    setCommercialId(
      lead.assigned_user_id ?? "",
    );

    setAssignmentError(null);

    setEditingAssignment(false);
  }

  async function handleAssignment() {
    if (!lead) {
      return;
    }

    if (!storeId) {
      setAssignmentError(
        "Seleciona uma loja.",
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

      if (isAssigned) {
        await reassignLead({
          leadId: lead.id,
          storeId,
          commercialId,
        });
      } else {
        await assignLead({
          leadId: lead.id,
          storeId,
          commercialId,
        });
      }

      router.refresh();

      onClose();
    } catch (error) {
      setAssignmentError(
        error instanceof Error
          ? error.message
          : "Não foi possível guardar a atribuição.",
      );
    } finally {
      setSaving(false);
    }
  }

  // ========================================
  // ALTERAR ESTADO NORMAL
  // ========================================

  async function handleStatusChange() {
    if (!lead) {
      return;
    }

    if (
      selectedStatus ===
      lead.status
    ) {
      return;
    }

    try {
      setSavingStatus(true);

      setStatusError(null);

      await updateLeadStatus({
        leadId: lead.id,
        status: selectedStatus,
      });

      router.refresh();

      onClose();
    } catch (error) {
      setStatusError(
        error instanceof Error
          ? error.message
          : "Não foi possível alterar o estado.",
      );
    } finally {
      setSavingStatus(false);
    }
  }

  // ========================================
  // SUBMETER CONVERSÃO
  // ========================================

  async function handleConversionSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!lead) {
      return;
    }

    try {
      setSubmittingConversion(
        true,
      );

      setConversionError(null);

      const formData =
        new FormData(
          event.currentTarget,
        );

      formData.set(
        "leadId",
        lead.id,
      );

      await submitConversionRequest(
        formData,
      );

      router.refresh();

      onClose();
    } catch (error) {
      setConversionError(
        error instanceof Error
          ? error.message
          : "Não foi possível submeter o negócio para validação.",
      );
    } finally {
      setSubmittingConversion(
        false,
      );
    }
  }

  // ========================================
  // APROVAR CONVERSÃO
  // ========================================

  async function handleApproveConversion() {
    if (!pendingConversion) {
      return;
    }

    try {
      setReviewingConversion(
        true,
      );

      setReviewError(null);

      await approveConversionRequest(
        pendingConversion.id,
      );

      router.refresh();

      onClose();
    } catch (error) {
      setReviewError(
        error instanceof Error
          ? error.message
          : "Não foi possível confirmar a conversão.",
      );
    } finally {
      setReviewingConversion(
        false,
      );
    }
  }

  // ========================================
  // REJEITAR CONVERSÃO
  // ========================================

  async function handleRejectConversion() {
    if (!pendingConversion) {
      return;
    }

    if (
      !rejectionReason.trim()
    ) {
      setReviewError(
        "Indica o motivo da rejeição.",
      );

      return;
    }

    try {
      setReviewingConversion(
        true,
      );

      setReviewError(null);

      await rejectConversionRequest(
        pendingConversion.id,
        rejectionReason,
      );

      router.refresh();

      onClose();
    } catch (error) {
      setReviewError(
        error instanceof Error
          ? error.message
          : "Não foi possível rejeitar o pedido.",
      );
    } finally {
      setReviewingConversion(
        false,
      );
    }
  }

  // ========================================
  // SEM LEAD
  // ========================================

  if (!open || !lead) {
    return null;
  }

  const answers =
    Object.entries(
      lead.answers ?? {},
    );

  const registration =
    lead.answers?.registration;

  const currentStore =
    stores.find(
      (store) =>
        store.id ===
        lead.store_id,
    ) ?? null;

  const currentCommercial =
    commercials.find(
      (commercial) =>
        commercial.id ===
        lead.assigned_user_id,
    ) ?? null;

  return (
    <div className="fixed inset-0 z-[100]">
      {/* OVERLAY */}

      <button
        type="button"
        aria-label="Fechar detalhe da lead"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/35 backdrop-blur-[1px]"
      />

      {/* DRAWER */}

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
                  status={
                    lead.status
                  }
                />

                <LeadPriorityBadge
                  priority={
                    lead.priority
                  }
                />
              </div>

              <h2 className="mt-3 truncate text-2xl font-semibold tracking-tight text-[#17191d]">
                {lead.name}
              </h2>

              <p className="mt-1 text-sm text-[#6f7680]">
                {
                  lead.insurance_type
                }
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
              Estado:

              <span className="ml-1 font-semibold">
                {statusOptions.find(
                  (option) =>
                    option.value ===
                    lead.status,
                )?.label ??
                  lead.status}
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
          {/* DADOS */}

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
                    {
                      lead.phone
                    }
                  </a>
                </dd>
              </div>

              <div>
                <dt className="flex items-center gap-1 text-xs text-[#8a9099]">
                  <ShieldCheck className="h-3.5 w-3.5" />

                  Tipo de seguro
                </dt>

                <dd className="mt-1 text-sm font-medium text-[#333842]">
                  {
                    lead.insurance_type
                  }
                </dd>
              </div>

              {registration && (
                <div>
                  <dt className="text-xs text-[#8a9099]">
                    Matrícula
                  </dt>

                  <dd className="mt-1 text-sm font-medium uppercase text-[#333842]">
                    {formatAnswer(
                      registration,
                    )}
                  </dd>
                </div>
              )}

              <div>
                <dt className="flex items-center gap-1 text-xs text-[#8a9099]">
                  <MapPin className="h-3.5 w-3.5" />

                  Origem
                </dt>

                <dd className="mt-1 text-sm font-medium text-[#333842]">
                  {getSourceLabel(
                    lead.source,
                  )}
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

            {answers.length >
            0 ? (
              <dl className="mt-5 divide-y divide-[#edf0f2]">
                {answers.map(
                  ([
                    question,
                    answer,
                  ]) => (
                    <div
                      key={
                        question
                      }
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
                adicionais para esta
                lead.
              </p>
            )}
          </section>

          {/* ESTADO DA LEAD */}

          <section className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-sm">
            <h3 className="font-semibold text-[#20242a]">
              Estado da lead
            </h3>

            <p className="mt-1 text-sm text-[#7d848e]">
              Atualiza o progresso
              comercial desta lead.
            </p>

            <div className="mt-5">
              <label className="text-xs font-semibold text-[#6f7680]">
                Estado
              </label>

              <select
                value={
                  selectedStatus
                }
                disabled={
                  lead.status ===
                    "ganha" ||
                  lead.status ===
                    "convertida"
                }
                onChange={(
                  event,
                ) =>
                  setSelectedStatus(
                    event.target
                      .value as LeadStatus,
                  )
                }
                className="mt-2 h-11 w-full rounded-xl border border-[#dde1e6] bg-white px-3 text-sm outline-none disabled:cursor-not-allowed disabled:bg-[#f4f5f7] focus:border-[#ff4b0a]"
              >
                <option value="nova">
                  Nova
                </option>

                <option value="em_contacto">
                  Em contacto
                </option>

                <option value="a_aguardar">
                  A aguardar
                </option>

                <option value="simulacao_enviada">
                  Simulação enviada
                </option>

                <option value="proposta">
                  Proposta
                </option>

                {/* "ganha" NÃO entra aqui */}

                <option value="perdida">
                  Perdida
                </option>

                {(
                  lead.status === "ganha" ||
                  lead.status === "convertida"
                ) && (
                  <option value="ganha">
                    Por validar
                  </option>
                )}

                {lead.status ===
                  "convertida" && (
                  <option value="convertida">
                    Convertida
                  </option>
                )}
              </select>
            </div>

            {statusError && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {statusError}
              </div>
            )}

            {lead.status !==
              "ganha" &&
              lead.status !==
                "convertida" && (
                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    onClick={
                      handleStatusChange
                    }
                    disabled={
                      savingStatus ||
                      selectedStatus ===
                        lead.status
                    }
                    className="inline-flex h-11 items-center justify-center rounded-xl bg-[#242a32] px-5 text-sm font-semibold text-white transition hover:bg-[#171b20] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingStatus
                      ? "A guardar..."
                      : "Guardar estado"}
                  </button>
                </div>
              )}
          </section>

          {/* ====================================== */}
          {/* PROPOSTA -> SUBMETER PARA VALIDAÇÃO   */}
          {/* ====================================== */}

          {lead.status ===
            "proposta" && (
            <section className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-sm">
              {!showConversionForm ? (
                <div className="rounded-2xl border border-green-200 bg-green-50 p-5">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green-100">
                      <ShieldCheck className="h-5 w-5 text-green-700" />
                    </div>

                    <div>
                      <h3 className="font-semibold text-[#20242a]">
                        O cliente aceitou
                        a proposta?
                      </h3>

                      <p className="mt-1 text-sm leading-6 text-[#6f7680]">
                        Submete os dados
                        do negócio e o
                        comprovativo para
                        validação pela
                        gestão.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setShowConversionForm(
                        true,
                      );

                      setConversionError(
                        null,
                      );
                    }}
                    className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl bg-green-600 px-5 text-sm font-semibold text-white transition hover:bg-green-700"
                  >
                    Submeter negócio para
                    validação
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={
                    handleConversionSubmit
                  }
                  className="space-y-5"
                >
                  <div>
                    <h3 className="font-semibold text-[#20242a]">
                      Submeter negócio
                      para validação
                    </h3>

                    <p className="mt-1 text-sm text-[#7d848e]">
                      Preenche os dados
                      do negócio. A
                      gestão irá
                      confirmar a
                      conversão.
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="conversion-company"
                      className="text-xs font-semibold text-[#6f7680]"
                    >
                      Companhia *
                    </label>

                    <input
                      id="conversion-company"
                      name="company"
                      type="text"
                      required
                      placeholder="Ex.: Allianz"
                      className="mt-2 h-11 w-full rounded-xl border border-[#dde1e6] bg-white px-3 text-sm outline-none focus:border-[#ff4b0a]"
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="conversion-premium"
                        className="text-xs font-semibold text-[#6f7680]"
                      >
                        Prémio *
                      </label>

                      <div className="relative mt-2">
                        <input
                          id="conversion-premium"
                          name="premium"
                          type="number"
                          min="0.01"
                          step="0.01"
                          required
                          placeholder="438.20"
                          className="h-11 w-full rounded-xl border border-[#dde1e6] bg-white px-3 pr-10 text-sm outline-none focus:border-[#ff4b0a]"
                        />

                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[#7d848e]">
                          €
                        </span>
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="conversion-start-date"
                        className="text-xs font-semibold text-[#6f7680]"
                      >
                        Data de início *
                      </label>

                      <input
                        id="conversion-start-date"
                        name="startDate"
                        type="date"
                        required
                        className="mt-2 h-11 w-full rounded-xl border border-[#dde1e6] bg-white px-3 text-sm outline-none focus:border-[#ff4b0a]"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="conversion-reference"
                      className="text-xs font-semibold text-[#6f7680]"
                    >
                      Referência / nº da
                      proposta *
                    </label>

                    <input
                      id="conversion-reference"
                      name="reference"
                      type="text"
                      required
                      placeholder="Ex.: AUT-2026-12345"
                      className="mt-2 h-11 w-full rounded-xl border border-[#dde1e6] bg-white px-3 text-sm outline-none focus:border-[#ff4b0a]"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="conversion-document"
                      className="text-xs font-semibold text-[#6f7680]"
                    >
                      Comprovativo *
                    </label>

                    <div className="mt-2 rounded-xl border border-dashed border-[#cfd4da] bg-[#fafbfc] p-4">
                      <input
                        id="conversion-document"
                        name="document"
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                        required
                        className="block w-full text-sm text-[#59616d] file:mr-4 file:rounded-lg file:border-0 file:bg-[#242a32] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-[#171b20]"
                      />

                      <p className="mt-2 text-xs text-[#8a9099]">
                        PDF, JPG ou PNG.
                        Máximo 6 MB.
                      </p>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="conversion-notes"
                      className="text-xs font-semibold text-[#6f7680]"
                    >
                      Notas
                    </label>

                    <textarea
                      id="conversion-notes"
                      name="notes"
                      rows={4}
                      placeholder="Informação adicional sobre o negócio..."
                      className="mt-2 w-full resize-none rounded-xl border border-[#dde1e6] bg-white p-3 text-sm outline-none focus:border-[#ff4b0a]"
                    />
                  </div>

                  {conversionError && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {
                        conversionError
                      }
                    </div>
                  )}

                  <div className="flex flex-col-reverse gap-3 border-t border-[#edf0f2] pt-5 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      disabled={
                        submittingConversion
                      }
                      onClick={() => {
                        setShowConversionForm(
                          false,
                        );

                        setConversionError(
                          null,
                        );
                      }}
                      className="h-11 rounded-xl border border-[#dde1e6] bg-white px-5 text-sm font-semibold text-[#4b525c]"
                    >
                      Cancelar
                    </button>

                    <button
                      type="submit"
                      disabled={
                        submittingConversion
                      }
                      className="h-11 rounded-xl bg-green-600 px-5 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
                    >
                      {submittingConversion
                        ? "A submeter..."
                        : "Enviar para validação"}
                    </button>
                  </div>
                </form>
              )}
            </section>
          )}

          {/* ====================================== */}
          {/* POR VALIDAR                            */}
          {/* ====================================== */}

          {(
            lead.status === "ganha" ||
            lead.status === "convertida"
          ) && (
            <section className="rounded-2xl border border-violet-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100">
                  <ShieldCheck className="h-5 w-5 text-violet-700" />
                </div>

                <div>
                    <h3 className="font-semibold text-[#20242a]">
                      {lead.status === "convertida"
                        ? "Negócio convertido"
                        : "Negócio por validar"}
                    </h3>

                  <p className="mt-1 text-sm text-[#7d848e]">
                        {lead.status === "convertida"
                          ? "Conversão validada pela gestão. Os dados e o comprovativo ficam disponíveis para consulta."
                          : "Esta conversão está à espera de validação pela gestão."}
                      </p>
                </div>
              </div>

            {!canReviewConversion && (
              <div className="mt-5 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-700">
                {lead.status === "convertida"
                  ? "Lead convertida."
                  : "O pedido foi enviado para validação."}
              </div>
            )}

              {canReviewConversion &&
                loadingConversionReview && (
                  <div className="mt-5 rounded-xl bg-[#f8f9fa] px-4 py-4 text-sm text-[#6f7680]">
                    A carregar dados da
                    conversão...
                  </div>
                )}

              {reviewError && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {reviewError}
                </div>
              )}

              {canReviewConversion &&
                !loadingConversionReview &&
                !pendingConversion &&
                !reviewError && (
                  <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Não foi encontrado
                    nenhum pedido de
                    validação pendente
                    para esta lead.
                  </div>
                )}

              {pendingConversion && (
                  <>
                    <div className="mt-5 grid gap-5 rounded-xl border border-[#e5e8ec] bg-[#fafbfc] p-4 sm:grid-cols-2">
                      <div>
                        <p className="text-xs text-[#8a9099]">
                          Companhia
                        </p>

                        <p className="mt-1 text-sm font-semibold text-[#20242a]">
                          {
                            pendingConversion.company
                          }
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-[#8a9099]">
                          Prémio
                        </p>

                        <p className="mt-1 text-sm font-semibold text-[#20242a]">
                          {formatCurrency(
                            pendingConversion.premium,
                          )}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-[#8a9099]">
                          Referência
                        </p>

                        <p className="mt-1 break-all text-sm font-semibold text-[#20242a]">
                          {
                            pendingConversion.reference
                          }
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-[#8a9099]">
                          Data de início
                        </p>

                        <p className="mt-1 text-sm font-semibold text-[#20242a]">
                          {formatSimpleDate(
                            pendingConversion.start_date,
                          )}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-[#8a9099]">
                          Submetido por
                        </p>

                        <p className="mt-1 text-sm font-semibold text-[#20242a]">
                          {
                            pendingConversion.submitted_by_name
                          }
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-[#8a9099]">
                          Submetido em
                        </p>

                        <p className="mt-1 text-sm font-semibold text-[#20242a]">
                          {formatDate(
                            pendingConversion.created_at,
                          )}
                        </p>
                      </div>
                    </div>

                    {pendingConversion.notes && (
                      <div className="mt-4 rounded-xl border border-[#e5e8ec] p-4">
                        <p className="text-xs font-semibold text-[#6f7680]">
                          Notas do
                          comercial
                        </p>

                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#333842]">
                          {
                            pendingConversion.notes
                          }
                        </p>
                      </div>
                    )}

                    <a
                      href={
                        pendingConversion.document_url
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl border border-[#dde1e6] bg-white px-5 text-sm font-semibold text-[#20242a] transition hover:bg-[#f5f6f7]"
                    >
                      Ver comprovativo
                    </a>

                    {showRejectForm && (
                      <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4">
                        <label className="text-xs font-semibold text-red-800">
                          Motivo da
                          rejeição *
                        </label>

                        <textarea
                          rows={3}
                          value={
                            rejectionReason
                          }
                          onChange={(
                            event,
                          ) =>
                            setRejectionReason(
                              event
                                .target
                                .value,
                            )
                          }
                          placeholder="Ex.: Referência incorreta, documento inválido..."
                          className="mt-2 w-full resize-none rounded-xl border border-red-200 bg-white p-3 text-sm outline-none"
                        />
                      </div>
                    )}

                     {canReviewConversion &&
                      lead.status === "ganha" && (
                      <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                         {!showRejectForm ? (
                        <button
                          type="button"
                          disabled={
                            reviewingConversion
                          }
                          onClick={() => {
                            setShowRejectForm(
                              true,
                            );

                            setReviewError(
                              null,
                            );
                          }}
                          className="h-11 rounded-xl border border-red-200 bg-white px-5 text-sm font-semibold text-red-700 transition hover:bg-red-50"
                        >
                          Rejeitar
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={
                            reviewingConversion
                          }
                          onClick={() => {
                            setShowRejectForm(
                              false,
                            );

                            setRejectionReason(
                              "",
                            );

                            setReviewError(
                              null,
                            );
                          }}
                          className="h-11 rounded-xl border border-[#dde1e6] bg-white px-5 text-sm font-semibold text-[#4b525c]"
                        >
                          Cancelar
                          rejeição
                        </button>
                      )}

                      {showRejectForm ? (
                        <button
                          type="button"
                          disabled={
                            reviewingConversion ||
                            !rejectionReason.trim()
                          }
                          onClick={
                            handleRejectConversion
                          }
                          className="h-11 rounded-xl bg-red-600 px-5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                        >
                          {reviewingConversion
                            ? "A rejeitar..."
                            : "Confirmar rejeição"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={
                            reviewingConversion
                          }
                          onClick={
                            handleApproveConversion
                          }
                          className="h-11 rounded-xl bg-green-600 px-5 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
                        >
                          {reviewingConversion
                            ? "A confirmar..."
                            : "Confirmar conversão"}
                        </button>
                      )}
                      </div>
                    )}
                  </>
                )}
            </section>
          )}

          {/* ====================================== */}
          {/* ATRIBUIÇÃO - SÓ OWNER                  */}
          {/* ====================================== */}

          {currentUserRole ===
            "OWNER" && (
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
                    Gere a loja e o
                    comercial responsável
                    por esta lead.
                  </p>
                </div>
              </div>

              {isAssigned &&
              !editingAssignment ? (
                <>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold text-[#6f7680]">
                        Loja
                      </p>

                      <div className="mt-2 rounded-xl border border-[#dde1e6] bg-[#f8f9fa] px-4 py-3 text-sm font-semibold text-[#20242a]">
                        {currentStore?.name ??
                          "Loja atribuída"}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-semibold text-[#6f7680]">
                        Responsável
                      </p>

                      <div className="mt-2 rounded-xl border border-[#dde1e6] bg-[#f8f9fa] px-4 py-3 text-sm font-semibold text-[#20242a]">
                        {currentCommercial?.full_name ??
                          "Comercial atribuído"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
                    Esta lead já está
                    atribuída.
                  </div>

                  <div className="mt-5 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingAssignment(
                          true,
                        );

                        setAssignmentError(
                          null,
                        );
                      }}
                      className="inline-flex h-11 items-center justify-center rounded-xl bg-[#ff4b0a] px-5 text-sm font-semibold text-white transition hover:bg-[#e94308]"
                    >
                      Mudar responsável
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="lead-store"
                        className="text-xs font-semibold text-[#6f7680]"
                      >
                        Loja
                      </label>

                      <select
                        id="lead-store"
                        value={
                          storeId
                        }
                        onChange={(
                          event,
                        ) =>
                          handleStoreChange(
                            event
                              .target
                              .value,
                          )
                        }
                        className="mt-2 h-11 w-full rounded-xl border border-[#dde1e6] bg-white px-3 text-sm text-[#333842] outline-none focus:border-[#ff4b0a]"
                      >
                        <option value="">
                          Selecionar loja
                        </option>

                        {stores.map(
                          (store) => (
                            <option
                              key={
                                store.id
                              }
                              value={
                                store.id
                              }
                            >
                              {
                                store.name
                              }
                            </option>
                          ),
                        )}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="lead-commercial"
                        className="text-xs font-semibold text-[#6f7680]"
                      >
                        Comercial
                      </label>

                      <select
                        id="lead-commercial"
                        value={
                          commercialId
                        }
                        disabled={
                          !storeId
                        }
                        onChange={(
                          event,
                        ) => {
                          setCommercialId(
                            event
                              .target
                              .value,
                          );

                          setAssignmentError(
                            null,
                          );
                        }}
                        className="mt-2 h-11 w-full rounded-xl border border-[#dde1e6] bg-white px-3 text-sm text-[#333842] outline-none disabled:cursor-not-allowed disabled:bg-[#f4f5f7] focus:border-[#ff4b0a]"
                      >
                        <option value="">
                          {!storeId
                            ? "Seleciona uma loja primeiro"
                            : "Selecionar comercial"}
                        </option>

                        {availableCommercials.map(
                          (
                            commercial,
                          ) => (
                            <option
                              key={
                                commercial.id
                              }
                              value={
                                commercial.id
                              }
                            >
                              {
                                commercial.full_name
                              }
                            </option>
                          ),
                        )}
                      </select>
                    </div>
                  </div>

                  {storeId &&
                    availableCommercials.length ===
                      0 && (
                      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        Não existem
                        comerciais ativos
                        associados a esta
                        loja.
                      </div>
                    )}

                  {assignmentError && (
                    <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {
                        assignmentError
                      }
                    </div>
                  )}

                  <div className="mt-5 flex justify-end gap-3">
                    {isAssigned && (
                      <button
                        type="button"
                        disabled={
                          saving
                        }
                        onClick={
                          cancelReassignment
                        }
                        className="h-11 rounded-xl border border-[#dde1e6] bg-white px-5 text-sm font-semibold text-[#4b525c]"
                      >
                        Cancelar
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={
                        handleAssignment
                      }
                      disabled={
                        saving ||
                        !storeId ||
                        !commercialId
                      }
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#ff4b0a] px-5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      <Save className="h-4 w-4" />

                      {saving
                        ? "A guardar..."
                        : isAssigned
                          ? "Guardar nova atribuição"
                          : "Atribuir lead"}
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          {/* INFORMAÇÃO DO SISTEMA */}

          <section className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-sm">
            <h3 className="flex items-center gap-2 font-semibold text-[#20242a]">
              <Clock3 className="h-4 w-4 text-[#ff4b0a]" />

              Informação do sistema
            </h3>

            <dl className="mt-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <dt className="text-sm text-[#7d848e]">
                  ID
                </dt>

                <dd className="max-w-[65%] break-all text-right text-xs font-medium text-[#333842]">
                  {lead.id}
                </dd>
              </div>

              <div className="flex items-start justify-between gap-4">
                <dt className="text-sm text-[#7d848e]">
                  Referência externa
                </dt>

                <dd className="max-w-[65%] break-all text-right text-xs font-medium text-[#333842]">
                  {lead.source_reference ??
                    "—"}
                </dd>
              </div>

              <div className="flex items-start justify-between gap-4">
                <dt className="text-sm text-[#7d848e]">
                  Criada
                </dt>

                <dd className="text-right text-sm font-medium text-[#333842]">
                  {formatDate(
                    lead.created_at,
                  )}
                </dd>
              </div>

              <div className="flex items-start justify-between gap-4">
                <dt className="text-sm text-[#7d848e]">
                  Última atualização
                </dt>

                <dd className="text-right text-sm font-medium text-[#333842]">
                  {formatDate(
                    lead.updated_at,
                  )}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </aside>
    </div>
  );
}