"use client";

import {
  useEffect,
  useState,
  useTransition,
} from "react";

import {
  MoreHorizontal,
  Pencil,
  Trash2,
  UserRound,
} from "lucide-react";

import {
  useRouter,
} from "next/navigation";

import {
  deleteOpportunity,
  updateOpportunityStatus,
  type OpportunityStatus,
} from "@/app/(dashboard)/oportunidades/action";

import {
  EditOpportunityDialog,
} from "@/components/opportunities/edit-opportunity-dialog";

type Opportunity = {
  id: string;
  title: string;
  insurance_type: string | null;
  status: OpportunityStatus;
  estimated_value: number | null;
  assigned_user_id: string | null;
  company_name: string | null;
  expected_close_date: string | null;
};

type Profile = {
  id: string;
  full_name: string;
};

type Props = {
  opportunities: Opportunity[];
  profiles: Profile[];
  canAssignOthers: boolean;
};

const PIPELINE: {
  key: OpportunityStatus;
  label: string;
}[] = [
  { key: "nova", label: "Nova" },
  { key: "qualificada", label: "Qualificada" },
  { key: "simulacao", label: "Simulação" },
  { key: "negociacao", label: "Negociação" },
  { key: "proposta", label: "Proposta" },
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) {
    return "Sem data";
  }

  return new Intl.DateTimeFormat("pt-PT").format(
    new Date(`${value}T12:00:00`),
  );
}

export function OpportunitiesKanban({
  opportunities,
  profiles,
  canAssignOthers,
}: Props) {
  const router = useRouter();

  // Estado local otimista — é isto que a UI renderiza.
  // É sincronizado com as props sempre que o servidor
  // manda uma nova lista (após um refresh "de verdade").
  const [localOpportunities, setLocalOpportunities] =
    useState<Opportunity[]>(opportunities);

  useEffect(() => {
    setLocalOpportunities(opportunities);
  }, [opportunities]);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<OpportunityStatus | null>(null);
  const [editingOpportunity, setEditingOpportunity] =
    useState<Opportunity | null>(null);

  const [, startTransition] = useTransition();

  const profilesMap = new Map(
    profiles.map((profile) => [profile.id, profile]),
  );

  function moveOptimistically(
    id: string,
    newStatus: OpportunityStatus,
  ) {
    setLocalOpportunities((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, status: newStatus }
          : item,
      ),
    );
  }

  function removeOptimistically(id: string) {
    setLocalOpportunities((current) =>
      current.filter((item) => item.id !== id),
    );
  }

  async function persistStatus(
    opportunity: Opportunity,
    newStatus: OpportunityStatus,
  ) {
    const previousStatus = opportunity.status;

    // Move já no ecrã, sem esperar pelo servidor.
    moveOptimistically(opportunity.id, newStatus);

    try {
      await updateOpportunityStatus(
        opportunity.id,
        newStatus,
      );

      // Sucesso: não é preciso refresh imediato — o estado
      // local já reflete a realidade. O refresh do Next
      // (via revalidatePath na action) atualiza os KPIs e
      // a lista de fechados em segundo plano, sem bloquear.
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      // Falhou: reverte o cartão para a coluna original.
      moveOptimistically(opportunity.id, previousStatus);

      alert(
        error instanceof Error
          ? error.message
          : "Erro ao mover oportunidade.",
      );
    }
  }

  async function handleDrop(newStatus: OpportunityStatus) {
    if (!draggingId) {
      return;
    }

    const opportunity = localOpportunities.find(
      (item) => item.id === draggingId,
    );

    setDraggingId(null);
    setOverColumn(null);

    if (!opportunity || opportunity.status === newStatus) {
      return;
    }

    void persistStatus(opportunity, newStatus);
  }

  async function handleDelete(opportunity: Opportunity) {
    const confirmed = window.confirm(
      `Apagar "${opportunity.title}"?`,
    );

    if (!confirmed) {
      return;
    }

    const previous = localOpportunities;

    removeOptimistically(opportunity.id);

    try {
      await deleteOpportunity(opportunity.id);

      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setLocalOpportunities(previous);

      alert(
        error instanceof Error
          ? error.message
          : "Erro ao apagar.",
      );
    }
  }

  return (
    <>
      <div className="overflow-x-auto p-4">
        <div className="grid min-w-[1250px] grid-cols-5 gap-4">
          {PIPELINE.map((column) => {
            const items = localOpportunities.filter(
              (opportunity) => opportunity.status === column.key,
            );

            const columnValue = items.reduce(
              (total, opportunity) =>
                total + Number(opportunity.estimated_value ?? 0),
              0,
            );

            return (
              <div
                key={column.key}
                onDragOver={(event) => {
                  event.preventDefault();
                  setOverColumn(column.key);
                }}
                onDragLeave={() => setOverColumn(null)}
                onDrop={(event) => {
                  event.preventDefault();
                  void handleDrop(column.key);
                }}
                className={`min-h-[430px] rounded-2xl p-3 transition ${
                  overColumn === column.key
                    ? "bg-orange-50 ring-2 ring-[#ff4b0a]/30"
                    : "bg-[#f7f8fa]"
                }`}
              >
                <div className="mb-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">
                      {column.label}
                    </h3>

                    <span className="rounded-full bg-white px-2 py-0.5 text-xs">
                      {items.length}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-[#8a9099]">
                    {formatCurrency(columnValue)}
                  </p>
                </div>

                <div className="space-y-3">
                  {items.length === 0 ? (
                    <div className="rounded-xl border border-dashed px-3 py-8 text-center text-xs text-[#a0a5ac]">
                      Arrasta uma oportunidade para aqui
                    </div>
                  ) : (
                    items.map((opportunity) => {
                      const responsible =
                        opportunity.assigned_user_id
                          ? profilesMap.get(
                              opportunity.assigned_user_id,
                            )
                          : undefined;

                      return (
                        <article
                          key={opportunity.id}
                          draggable
                          onDragStart={() =>
                            setDraggingId(opportunity.id)
                          }
                          onDragEnd={() => {
                            setDraggingId(null);
                            setOverColumn(null);
                          }}
                          className={`cursor-grab rounded-xl border bg-white p-4 shadow-sm transition-opacity ${
                            draggingId === opportunity.id
                              ? "opacity-50"
                              : ""
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h4 className="truncate text-sm font-semibold">
                                {opportunity.title}
                              </h4>

                              <p className="mt-1 text-xs text-[#818892]">
                                {opportunity.insurance_type ??
                                  "Seguro não definido"}
                              </p>
                            </div>

                            <div className="flex items-start gap-2">
                              <span className="text-sm font-semibold">
                                {formatCurrency(
                                  Number(
                                    opportunity.estimated_value ?? 0,
                                  ),
                                )}
                              </span>

                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();

                                    document
                                      .getElementById(
                                        `opportunity-menu-${opportunity.id}`,
                                      )
                                      ?.classList.toggle("hidden");
                                  }}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </button>

                                <div
                                  id={`opportunity-menu-${opportunity.id}`}
                                  className="absolute right-0 top-7 z-30 hidden w-36 rounded-xl border bg-white p-1 shadow-xl"
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingOpportunity(opportunity);

                                      document
                                        .getElementById(
                                          `opportunity-menu-${opportunity.id}`,
                                        )
                                        ?.classList.add("hidden");
                                    }}
                                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs hover:bg-[#f5f6f7]"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                    Editar
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleDelete(opportunity)
                                    }
                                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-red-600 hover:bg-red-50"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    Apagar
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>

                          {opportunity.company_name && (
                            <div className="mt-3">
                              <span className="rounded-md bg-[#f4f5f7] px-2 py-1 text-[11px]">
                                {opportunity.company_name}
                              </span>
                            </div>
                          )}

                          <div className="mt-4 border-t pt-3">
                            <div className="flex items-center gap-2 text-xs text-[#6f7680]">
                              <UserRound className="h-3.5 w-3.5 text-[#ff4b0a]" />

                              <span>
                                {responsible?.full_name ??
                                  "Sem responsável"}
                              </span>
                            </div>

                            <p className="mt-2 text-[11px] text-[#9a9fa7]">
                              Fecho: {formatDate(opportunity.expected_close_date)}
                            </p>

                            <p className="mt-2 text-[10px] uppercase text-[#b0b4ba]">
                              Arrasta para mudar de estado
                            </p>

                            {opportunity.status === "proposta" && (
                              <div className="mt-3 grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();

                                    const confirmed = window.confirm(
                                      `Marcar "${opportunity.title}" como negócio ganho?`,
                                    );

                                    if (!confirmed) {
                                      return;
                                    }

                                    void persistStatus(
                                      opportunity,
                                      "ganha",
                                    );
                                  }}
                                  className="rounded-lg bg-green-50 px-3 py-2 text-xs font-semibold text-green-700 transition hover:bg-green-100"
                                >
                                  Ganho
                                </button>

                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();

                                    const confirmed = window.confirm(
                                      `Marcar "${opportunity.title}" como negócio perdido?`,
                                    );

                                    if (!confirmed) {
                                      return;
                                    }

                                    void persistStatus(
                                      opportunity,
                                      "perdida",
                                    );
                                  }}
                                  className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-100"
                                >
                                  Perdido
                                </button>
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <EditOpportunityDialog
        opportunity={editingOpportunity}
        users={profiles}
        canAssignOthers={canAssignOthers}
        onClose={() => setEditingOpportunity(null)}
      />
    </>
  );
}