"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Search, TrendingUp } from "lucide-react";

import { ProcessCard } from "@/components/tarefas/process-card";
import {
  CreateTaskModal,
  NotIssuedModal,
  ProcessModal,
  type TaskEditInput,
} from "@/components/tarefas/task-modals";
import { Toaster, useToasts } from "@/components/tarefas/toasts";
import {
  applyProcessPatch,
  daysToAgenda,
  isInNextDays,
  isOverdue,
  processStage,
  processStages,
  processStatusFor,
  type ProcessStage,
} from "@/components/tarefas/utils";
import {
  NOT_ISSUED_REASONS,
  type NotIssuedReason,
} from "@/lib/tasks/not-issued";

import {
  deleteTask,
  markProcessNotIssued,
  updateProcess,
  updateTask,
  updateTaskStatus,
  type InsuranceLineOption,
  type ProcessPatch,
  type ProfileOption,
  type TaskRow,
} from "@/app/(dashboard)/tarefas/action";

type Props = {
  initialProcesses: TaskRow[];
  profiles: ProfileOption[];
  insuranceLines: InsuranceLineOption[];
  privileged: boolean;
  currentProfileId: string;
};

type View = "ACTIVE" | "NOT_ISSUED";
type Focus = "ALL" | "NEXT7" | "OVERDUE";

const COLUMN_PAGE = 10;

/* Mais urgente primeiro: data de início do seguro; sem data no fim. */
function byAgenda(a: TaskRow, b: TaskRow) {
  const da = daysToAgenda(a);
  const db = daysToAgenda(b);

  if (da === null && db === null) {
    return b.created_at.localeCompare(a.created_at);
  }
  if (da === null) return 1;
  if (db === null) return -1;

  return da - db;
}

export function ProcessesBoard({
  initialProcesses,
  profiles,
  insuranceLines,
  privileged,
  currentProfileId,
}: Props) {
  const [processes, setProcesses] = useState(initialProcesses);
  const [synced, setSynced] = useState(initialProcesses);

  // Depois de cada ação o servidor (revalidatePath) devolve dados
  // novos: substituem o estado otimista local sem recarregar a página.
  if (initialProcesses !== synced) {
    setSynced(initialProcesses);
    setProcesses(initialProcesses);
  }

  const [view, setView] = useState<View>("ACTIVE");
  const [focus, setFocus] = useState<Focus>("ALL");
  const [search, setSearch] = useState("");
  // Todos veem os processos da equipa; funcionários abrem em "Os meus".
  const [assigneeFilter, setAssigneeFilter] = useState<string>(
    privileged ? "ALL" : currentProfileId,
  );

  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notIssuedId, setNotIssuedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<
    Partial<Record<ProcessStage, boolean>>
  >({});

  const [, startTransition] = useTransition();
  const { toasts, push, dismiss } = useToasts();

  const profileMap = useMemo(
    () => new Map(profiles.map((p) => [p.id, p.full_name])),
    [profiles],
  );

  const lineMap = useMemo(
    () => new Map(insuranceLines.map((l) => [l.id, l.name])),
    [insuranceLines],
  );

  const openProcess = processes.find((p) => p.id === openId) ?? null;
  const notIssuedProcess = processes.find((p) => p.id === notIssuedId) ?? null;

  // ----------------------------------------
  // FILTROS / CONTADORES
  // ----------------------------------------

  const scoped = useMemo(() => {
    const query = search.trim().toLowerCase();

    return processes.filter((p) => {
      if (assigneeFilter !== "ALL" && p.assigned_user_id !== assigneeFilter) {
        return false;
      }

      return (
        !query ||
        p.title.toLowerCase().includes(query) ||
        (p.client_name ?? "").toLowerCase().includes(query) ||
        (p.client_nif ?? "").includes(query) ||
        (p.description ?? "").toLowerCase().includes(query)
      );
    });
  }, [processes, search, assigneeFilter]);

  const active = useMemo(
    () => scoped.filter((p) => p.status !== "CANCELLED"),
    [scoped],
  );

  const notIssued = useMemo(
    () =>
      scoped
        .filter((p) => p.status === "CANCELLED")
        .sort((a, b) =>
          (b.not_issued_at ?? b.created_at).localeCompare(
            a.not_issued_at ?? a.created_at,
          ),
        ),
    [scoped],
  );

  const counts = {
    open: active.filter((p) => !p.receipt_paid).length,
    next7: active.filter((p) => isInNextDays(p, 7)).length,
    overdue: active.filter(isOverdue).length,
    notIssued: notIssued.length,
  };

  const visibleActive = active.filter((p) =>
    focus === "NEXT7"
      ? isInNextDays(p, 7)
      : focus === "OVERDUE"
        ? isOverdue(p)
        : true,
  );

  // Dos processos já fechados (emitidos com recibo pago ou não
  // emitidos), quantos acabaram em apólice.
  const closedDone = active.filter((p) => p.receipt_paid).length;
  const issueRate =
    closedDone + notIssued.length > 0
      ? Math.round((closedDone / (closedDone + notIssued.length)) * 100)
      : null;

  const reasonCounts = NOT_ISSUED_REASONS.map((reason) => ({
    ...reason,
    count: notIssued.filter((p) => p.not_issued_reason === reason.value)
      .length,
  })).filter((reason) => reason.count > 0);

  // ----------------------------------------
  // AÇÕES (otimistas, com reversão em erro)
  // ----------------------------------------

  function replace(next: TaskRow) {
    setProcesses((prev) => prev.map((p) => (p.id === next.id ? next : p)));
  }

  function run(
    previous: TaskRow,
    action: () => Promise<unknown>,
    successMessage?: string,
  ) {
    startTransition(async () => {
      try {
        await action();
        if (successMessage) push("success", successMessage);
      } catch (error) {
        setProcesses((prev) => {
          const exists = prev.some((p) => p.id === previous.id);
          return exists
            ? prev.map((p) => (p.id === previous.id ? previous : p))
            : [previous, ...prev];
        });

        push(
          "error",
          error instanceof Error ? error.message : "Não foi possível guardar.",
        );
      }
    });
  }

  function handlePatch(process: TaskRow, patch: ProcessPatch) {
    const next = applyProcessPatch(process, patch);
    replace(next);

    const from = processStage(process);
    const to = processStage(next);

    run(
      process,
      () => updateProcess(process.id, patch),
      from !== to
        ? to === "DONE"
          ? "Recibo pago — processo concluído."
          : `Passou para "${processStages.find((s) => s.key === to)?.label}".`
        : undefined,
    );
  }

  function applyEdit(process: TaskRow, input: TaskEditInput): TaskRow {
    return {
      ...process,
      title: input.title?.trim() || process.title,
      description:
        input.description !== undefined
          ? input.description
          : process.description,
      priority: input.priority ?? process.priority,
      assigned_user_id: input.assignedUserId ?? process.assigned_user_id,
    };
  }

  function handleSave(
    process: TaskRow,
    base: TaskEditInput,
    patch: ProcessPatch,
  ) {
    replace(applyProcessPatch(applyEdit(process, base), patch));

    run(
      process,
      async () => {
        await updateTask(process.id, base);
        await updateProcess(process.id, patch);
      },
      "Processo guardado.",
    );
  }

  function handleNotIssued(
    process: TaskRow,
    reason: NotIssuedReason,
    note: string | null,
  ) {
    replace({
      ...process,
      status: "CANCELLED",
      not_issued_reason: reason,
      not_issued_note: note,
      not_issued_at: new Date().toISOString(),
    });

    run(
      process,
      () => markProcessNotIssued(process.id, { reason, note }),
      "Processo marcado como não emitida.",
    );
  }

  // Reabrir um processo "não emitida": volta à fase que os passos
  // já marcados indicam e o motivo é apagado.
  function handleReopen(process: TaskRow) {
    const nextStatus = processStatusFor(process, "PENDING");

    replace({
      ...process,
      status: nextStatus,
      not_issued_reason: null,
      not_issued_note: null,
      not_issued_at: null,
    });

    run(
      process,
      () => updateTaskStatus(process.id, nextStatus),
      "Processo reaberto.",
    );
  }

  function handleDelete(process: TaskRow) {
    setProcesses((prev) => prev.filter((p) => p.id !== process.id));
    run(process, () => deleteTask(process.id), "Processo apagado.");
  }

  // ----------------------------------------
  // RENDER
  // ----------------------------------------

  function renderCard(process: TaskRow) {
    return (
      <ProcessCard
        key={process.id}
        process={process}
        lineName={
          process.insurance_line_id
            ? lineMap.get(process.insurance_line_id) ?? null
            : null
        }
        assignedName={
          process.assigned_user_id
            ? profileMap.get(process.assigned_user_id) ?? null
            : null
        }
        onOpen={(p) => setOpenId(p.id)}
        onPatch={handlePatch}
        onNotIssued={(p) => setNotIssuedId(p.id)}
        onReopen={handleReopen}
        onDelete={handleDelete}
      />
    );
  }

  // Filtros rápidos (com contadores) em vez de cartões grandes.
  const quickFilters: {
    key: string;
    label: string;
    count: number;
    active: boolean;
    alert?: boolean;
    onClick: () => void;
  }[] = [
    {
      key: "open",
      label: "Em curso",
      count: counts.open,
      active: view === "ACTIVE" && focus === "ALL",
      onClick: () => {
        setView("ACTIVE");
        setFocus("ALL");
      },
    },
    {
      key: "next7",
      label: "Começam esta semana",
      count: counts.next7,
      active: view === "ACTIVE" && focus === "NEXT7",
      onClick: () => {
        setView("ACTIVE");
        setFocus("NEXT7");
      },
    },
    {
      key: "overdue",
      label: "Atrasados",
      count: counts.overdue,
      alert: counts.overdue > 0,
      active: view === "ACTIVE" && focus === "OVERDUE",
      onClick: () => {
        setView("ACTIVE");
        setFocus("OVERDUE");
      },
    },
    {
      key: "notIssued",
      label: "Não emitidas",
      count: counts.notIssued,
      active: view === "NOT_ISSUED",
      onClick: () => setView("NOT_ISSUED"),
    },
  ];

  return (
    <div className="space-y-5">
      {/* TOOLBAR */}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#a0a5ac]" />

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar cliente, NIF ou título..."
              className="h-10 w-full rounded-xl border border-[#e4e6e9] bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[#ff4b0a]"
            />
          </div>

          {profiles.length > 1 && (
            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              className="h-10 rounded-xl border border-[#e4e6e9] bg-white px-3 text-sm text-[#59616d] outline-none transition focus:border-[#ff4b0a]"
            >
              <option value="ALL">Toda a equipa</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === currentProfileId
                    ? `Os meus (${p.full_name})`
                    : p.full_name}
                </option>
              ))}
            </select>
          )}
        </div>

        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#ff5a1f] to-[#ff4b0a] px-4 text-sm font-semibold text-white shadow-[0_2px_10px_rgba(255,75,10,0.28)] transition hover:shadow-[0_6px_18px_rgba(255,75,10,0.36)] active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Novo processo
        </button>
      </div>

      {/* FILTROS RÁPIDOS */}

      <div className="flex flex-wrap items-center gap-2">
        {quickFilters.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={filter.onClick}
            aria-pressed={filter.active}
            className={[
              "inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition",
              filter.active
                ? "border-[#ff4b0a] bg-[#fff7f3] text-[#20242a] ring-2 ring-[#ff4b0a]/10"
                : "border-[#e4e6e9] bg-white text-[#59616d] hover:border-[#ffb899]",
            ].join(" ")}
          >
            {filter.label}
            <span
              className={[
                "rounded-full px-1.5 text-xs font-semibold tabular-nums",
                filter.alert
                  ? "bg-red-50 text-red-700"
                  : "bg-[#f4f5f7] text-[#59616d]",
              ].join(" ")}
            >
              {filter.count}
            </span>
          </button>
        ))}
      </div>

      {view === "ACTIVE" ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {processStages.map((stage, stageIndex) => {
              const items = visibleActive
                .filter((p) => processStage(p) === stage.key)
                .sort(byAgenda);

              const isExpanded = expanded[stage.key] ?? false;
              const visible = isExpanded ? items : items.slice(0, COLUMN_PAGE);

              return (
                <div
                  key={stage.key}
                  className={`flex flex-col overflow-hidden rounded-2xl border border-t-[3px] border-[#e5e8ec] bg-[#f7f8f9] ${stage.bar}`}
                >
                  <div className="flex items-start justify-between gap-2 border-b border-[#eceef1] bg-white px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ${stage.dot}`}
                        >
                          {stageIndex + 1}
                        </span>
                        <h3 className="truncate text-sm font-semibold text-[#20242a]">
                          {stage.label}
                        </h3>
                      </div>
                      <p className="mt-0.5 pl-7 text-[11px] leading-snug text-[#8a9099]">
                        {stage.hint}
                      </p>
                    </div>

                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${stage.soft} ${stage.text}`}
                    >
                      {items.length}
                    </span>
                  </div>

                  <div className="flex min-h-[140px] flex-1 flex-col gap-2.5 p-2.5">
                    {items.length === 0 ? (
                      <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-[#dfe2e6] py-10">
                        <p className="px-3 text-center text-xs text-[#a0a5ac]">
                          {stage.empty}
                        </p>
                      </div>
                    ) : (
                      visible.map(renderCard)
                    )}

                    {items.length > COLUMN_PAGE && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((prev) => ({
                            ...prev,
                            [stage.key]: !isExpanded,
                          }))
                        }
                        className="rounded-lg py-1.5 text-xs font-medium text-[#7d848e] transition hover:bg-white hover:text-[#40464f]"
                      >
                        {isExpanded
                          ? "Mostrar menos"
                          : `Ver mais ${items.length - COLUMN_PAGE}`}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="space-y-4">
          {reasonCounts.length > 0 && (
            <div className="rounded-2xl border border-[#e5e8ec] bg-white p-4 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-[#40464f]">
                  Porque não foram emitidas
                </p>

                {issueRate !== null && (
                  <p className="inline-flex items-center gap-1 text-[11px] font-medium text-[#59616d]">
                    <TrendingUp className="h-3 w-3 text-green-600" />
                    {issueRate}% dos processos fechados acabaram em apólice
                  </p>
                )}
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {reasonCounts
                  .sort((a, b) => b.count - a.count)
                  .map((reason) => (
                    <span
                      key={reason.value}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#f4f5f7] px-2.5 py-1 text-xs text-[#40464f]"
                    >
                      {reason.label}
                      <span className="rounded-full bg-white px-1.5 text-[11px] font-semibold text-[#20242a]">
                        {reason.count}
                      </span>
                    </span>
                  ))}
              </div>
            </div>
          )}

          {notIssued.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#dfe2e6] bg-white py-14 text-center">
              <p className="text-sm font-medium text-[#40464f]">
                Sem processos não emitidos
              </p>
              <p className="mt-1 text-xs text-[#8a9099]">
                Os processos que marcares como &quot;Não emitida&quot;
                aparecem aqui, com o motivo.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {notIssued.map(renderCard)}
            </div>
          )}
        </div>
      )}

      {/* MODAIS */}

      {creating && (
        <CreateTaskModal
          profiles={profiles}
          insuranceLines={insuranceLines}
          privileged={privileged}
          currentProfileId={currentProfileId}
          initialKind="PROCESS"
          onCreated={() => push("success", "Processo criado.")}
          onClose={() => setCreating(false)}
        />
      )}

      {openProcess && (
        <ProcessModal
          key={openProcess.id}
          task={openProcess}
          lineName={
            openProcess.insurance_line_id
              ? lineMap.get(openProcess.insurance_line_id) ?? null
              : null
          }
          insuranceLines={insuranceLines}
          profiles={profiles}
          privileged={privileged}
          canModify
          onSave={(base, patch) => handleSave(openProcess, base, patch)}
          onNotIssued={
            openProcess.status !== "CANCELLED" && !openProcess.receipt_paid
              ? () => {
                  setOpenId(null);
                  setNotIssuedId(openProcess.id);
                }
              : undefined
          }
          onClose={() => setOpenId(null)}
        />
      )}

      {notIssuedProcess && (
        <NotIssuedModal
          key={notIssuedProcess.id}
          task={notIssuedProcess}
          onConfirm={(reason, note) =>
            handleNotIssued(notIssuedProcess, reason, note)
          }
          onClose={() => setNotIssuedId(null)}
        />
      )}

      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
