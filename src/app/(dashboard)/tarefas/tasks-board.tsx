"use client";

import { useMemo, useState, useTransition } from "react";
import {
  AlertCircle,
  Briefcase,
  CalendarDays,
  Plus,
  Search,
  Sun,
} from "lucide-react";

import { TaskCard } from "@/components/tarefas/task-card";
import {
  CreateTaskModal,
  EditTaskModal,
  ProcessModal,
  type TaskEditInput,
} from "@/components/tarefas/task-modals";
import { Toaster, useToasts } from "@/components/tarefas/toasts";
import {
  applyProcessPatch,
  columns,
  isInNextDays,
  isOpen,
  isOverdue,
  isToday,
  processStatusFor,
  statusLabel,
} from "@/components/tarefas/utils";

import {
  deleteTask,
  updateProcess,
  updateTask,
  updateTaskStatus,
  type InsuranceLineOption,
  type ProcessPatch,
  type ProfileOption,
  type TaskKind,
  type TaskPriority,
  type TaskRow,
  type TaskStatus,
} from "./action";

type Props = {
  initialTasks: TaskRow[];
  profiles: ProfileOption[];
  insuranceLines: InsuranceLineOption[];
  privileged: boolean;
  currentProfileId: string;
};

type KindFilter = "ALL" | TaskKind;
type FocusFilter = "ALL" | "TODAY" | "OVERDUE" | "NEXT7" | "OPEN_PROCESSES";

const COLUMN_PAGE = 12;

export function TasksBoard({
  initialTasks,
  profiles,
  insuranceLines,
  privileged,
  currentProfileId,
}: Props) {
  const [tasks, setTasks] = useState(initialTasks);
  const [syncedTasks, setSyncedTasks] = useState(initialTasks);

  // Depois de cada ação o servidor (revalidatePath) devolve dados
  // novos: substituem o estado otimista local sem recarregar a página.
  if (initialTasks !== syncedTasks) {
    setSyncedTasks(initialTasks);
    setTasks(initialTasks);
  }

  const [creating, setCreating] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("ALL");
  const [focus, setFocus] = useState<FocusFilter>("ALL");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "ALL">(
    "ALL",
  );
  const [assigneeFilter, setAssigneeFilter] = useState<string>("ALL");

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<TaskStatus | null>(null);
  const [expanded, setExpanded] = useState<Partial<Record<TaskStatus, boolean>>>(
    {},
  );

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

  const openTask = tasks.find((t) => t.id === openTaskId) ?? null;

  function canModify(task: TaskRow) {
    return privileged || task.assigned_user_id === currentProfileId;
  }

  // ----------------------------------------
  // CONTADORES / FILTROS
  // ----------------------------------------

  const counts = useMemo(
    () => ({
      today: tasks.filter(isToday).length,
      overdue: tasks.filter(isOverdue).length,
      next7: tasks.filter((t) => isInNextDays(t, 7)).length,
      openProcesses: tasks.filter((t) => t.kind === "PROCESS" && isOpen(t))
        .length,
    }),
    [tasks],
  );

  const filteredTasks = useMemo(() => {
    const query = search.trim().toLowerCase();

    return tasks.filter((task) => {
      if (
        query &&
        !task.title.toLowerCase().includes(query) &&
        !(task.description ?? "").toLowerCase().includes(query) &&
        !(task.client_name ?? "").toLowerCase().includes(query) &&
        !(task.client_nif ?? "").includes(query)
      ) {
        return false;
      }

      if (priorityFilter !== "ALL" && task.priority !== priorityFilter) {
        return false;
      }

      if (kindFilter !== "ALL" && task.kind !== kindFilter) return false;

      if (assigneeFilter !== "ALL" && task.assigned_user_id !== assigneeFilter) {
        return false;
      }

      switch (focus) {
        case "TODAY":
          return isToday(task);
        case "OVERDUE":
          return isOverdue(task);
        case "NEXT7":
          return isInNextDays(task, 7);
        case "OPEN_PROCESSES":
          return task.kind === "PROCESS" && isOpen(task);
        default:
          return true;
      }
    });
  }, [tasks, search, priorityFilter, kindFilter, assigneeFilter, focus]);

  const hasFilters =
    search.trim() !== "" ||
    priorityFilter !== "ALL" ||
    kindFilter !== "ALL" ||
    assigneeFilter !== "ALL" ||
    focus !== "ALL";

  function clearFilters() {
    setSearch("");
    setPriorityFilter("ALL");
    setKindFilter("ALL");
    setAssigneeFilter("ALL");
    setFocus("ALL");
  }

  // ----------------------------------------
  // AÇÕES (otimistas, com reversão em erro)
  // ----------------------------------------

  function replaceTask(next: TaskRow) {
    setTasks((prev) => prev.map((t) => (t.id === next.id ? next : t)));
  }

  function run(
    previous: TaskRow | null,
    action: () => Promise<unknown>,
    successMessage?: string,
  ) {
    startTransition(async () => {
      try {
        await action();
        if (successMessage) push("success", successMessage);
      } catch (error) {
        if (previous) {
          setTasks((prev) => {
            const exists = prev.some((t) => t.id === previous.id);
            return exists
              ? prev.map((t) => (t.id === previous.id ? previous : t))
              : [previous, ...prev];
          });
        }

        push(
          "error",
          error instanceof Error ? error.message : "Não foi possível guardar.",
        );
      }
    });
  }

  function handleMove(task: TaskRow, target: TaskStatus) {
    if (task.status === target || !canModify(task)) return;

    let nextStatus = target;

    if (task.kind === "PROCESS") {
      nextStatus = processStatusFor(task, target);

      if (nextStatus !== target && task.status !== "CANCELLED") {
        push(
          "info",
          target === "COMPLETED"
            ? "O processo fecha sozinho quando o recibo estiver pago."
            : "O estado de um processo segue os passos da checklist.",
        );
        return;
      }

      if (nextStatus === task.status) return;
    }

    replaceTask({ ...task, status: nextStatus });

    run(
      task,
      () => updateTaskStatus(task.id, nextStatus),
      task.kind === "PROCESS"
        ? nextStatus === "CANCELLED"
          ? "Processo cancelado."
          : `Processo reaberto (${statusLabel[nextStatus]}).`
        : nextStatus === "COMPLETED"
          ? "Tarefa concluída."
          : undefined,
    );
  }

  function handleProcessPatch(task: TaskRow, patch: ProcessPatch) {
    const next = applyProcessPatch(task, patch);
    replaceTask(next);

    run(
      task,
      () => updateProcess(task.id, patch),
      next.status !== task.status
        ? next.status === "COMPLETED"
          ? "Recibo pago — processo fechado."
          : `Processo passou para "${statusLabel[next.status]}".`
        : undefined,
    );
  }

  function applyEdit(task: TaskRow, input: TaskEditInput): TaskRow {
    return {
      ...task,
      title: input.title?.trim() || task.title,
      description:
        input.description !== undefined ? input.description : task.description,
      priority: input.priority ?? task.priority,
      due_at:
        input.dueAt !== undefined && task.kind === "TASK"
          ? input.dueAt
          : task.due_at,
      assigned_user_id: input.assignedUserId ?? task.assigned_user_id,
    };
  }

  function handleEditTask(task: TaskRow, input: TaskEditInput) {
    replaceTask(applyEdit(task, input));
    run(task, () => updateTask(task.id, input), "Tarefa atualizada.");
  }

  function handleSaveProcess(
    task: TaskRow,
    base: TaskEditInput,
    patch: ProcessPatch,
  ) {
    replaceTask(applyProcessPatch(applyEdit(task, base), patch));

    run(
      task,
      async () => {
        await updateTask(task.id, base);
        await updateProcess(task.id, patch);
      },
      "Processo guardado.",
    );
  }

  function handleDelete(task: TaskRow) {
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    run(task, () => deleteTask(task.id), "Tarefa apagada.");
  }

  // ----------------------------------------
  // DRAG & DROP
  // ----------------------------------------

  function handleDrop(target: TaskStatus) {
    const task = tasks.find((t) => t.id === draggingId);

    setDraggingId(null);
    setOverColumn(null);

    if (task) handleMove(task, target);
  }

  // ----------------------------------------
  // RENDER
  // ----------------------------------------

  const focusCards: {
    key: FocusFilter;
    label: string;
    value: number;
    icon: typeof Sun;
    tone: string;
  }[] = [
    {
      key: "TODAY",
      label: "Para hoje",
      value: counts.today,
      icon: Sun,
      tone: "text-amber-600 bg-amber-50",
    },
    {
      key: "OVERDUE",
      label: "Atrasadas",
      value: counts.overdue,
      icon: AlertCircle,
      tone: "text-red-600 bg-red-50",
    },
    {
      key: "NEXT7",
      label: "Próximos 7 dias",
      value: counts.next7,
      icon: CalendarDays,
      tone: "text-blue-600 bg-blue-50",
    },
    {
      key: "OPEN_PROCESSES",
      label: "Processos abertos",
      value: counts.openProcesses,
      icon: Briefcase,
      tone: "text-violet-600 bg-violet-50",
    },
  ];

  return (
    <div className="space-y-5">
      {/* FOCO — clicáveis como filtro */}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {focusCards.map((card) => {
          const active = focus === card.key;
          const Icon = card.icon;

          return (
            <button
              key={card.key}
              type="button"
              onClick={() => setFocus(active ? "ALL" : card.key)}
              aria-pressed={active}
              className={[
                "flex items-center gap-3 rounded-2xl border bg-white p-4 text-left shadow-[0_2px_10px_rgba(20,25,35,0.04)] transition hover:border-[#ffb899]",
                active
                  ? "border-[#ff4b0a] ring-2 ring-[#ff4b0a]/15"
                  : "border-[#e5e8ec]",
              ].join(" ")}
            >
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${card.tone}`}
              >
                <Icon className="h-5 w-5" />
              </span>

              <span className="min-w-0">
                <span className="block text-xs font-medium text-[#7d848e]">
                  {card.label}
                </span>
                <span className="block text-2xl font-semibold text-[#17191d]">
                  {card.value}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* TOOLBAR */}

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-[#e4e6e9] bg-white p-1">
            {(
              [
                { value: "ALL", label: "Todas" },
                { value: "TASK", label: "Tarefas" },
                { value: "PROCESS", label: "Processos" },
              ] as { value: KindFilter; label: string }[]
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setKindFilter(option.value)}
                className={[
                  "h-8 rounded-lg px-3 text-xs font-medium transition",
                  kindFilter === option.value
                    ? "bg-[#ff4b0a] text-white"
                    : "text-[#59616d] hover:bg-[#f4f5f7]",
                ].join(" ")}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#a0a5ac]" />

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar título, cliente ou NIF..."
              className="h-10 w-full rounded-xl border border-[#e4e6e9] bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[#ff4b0a]"
            />
          </div>

          <select
            value={priorityFilter}
            onChange={(e) =>
              setPriorityFilter(e.target.value as TaskPriority | "ALL")
            }
            className="h-10 rounded-xl border border-[#e4e6e9] bg-white px-3 text-sm text-[#59616d] outline-none transition focus:border-[#ff4b0a]"
          >
            <option value="ALL">Todas as prioridades</option>
            <option value="HIGH">Alta</option>
            <option value="MEDIUM">Média</option>
            <option value="LOW">Baixa</option>
          </select>

          {privileged && profiles.length > 1 && (
            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              className="h-10 rounded-xl border border-[#e4e6e9] bg-white px-3 text-sm text-[#59616d] outline-none transition focus:border-[#ff4b0a]"
            >
              <option value="ALL">Todos os responsáveis</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          )}

          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="h-10 rounded-xl px-3 text-xs font-medium text-[#ff4b0a] transition hover:bg-[#fff3ee]"
            >
              Limpar filtros
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#ff4b0a] px-4 text-sm font-medium text-white shadow-sm transition hover:bg-[#e64409]"
        >
          <Plus className="h-4 w-4" />
          {kindFilter === "PROCESS" ? "Novo processo" : "Nova tarefa"}
        </button>
      </div>

      <p className="hidden text-[11px] text-[#a0a5ac] md:block">
        Arrasta os cartões entre colunas. Nos processos, o estado segue a
        checklist — clica nos passos para marcar ou desmarcar.
      </p>

      {/* BOARD */}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {columns.map((column) => {
          const columnTasks = filteredTasks.filter(
            (t) => t.status === column.status,
          );

          const isExpanded = expanded[column.status] ?? false;
          const visible = isExpanded
            ? columnTasks
            : columnTasks.slice(0, COLUMN_PAGE);

          const isDropTarget = draggingId !== null && overColumn === column.status;

          return (
            <div key={column.status} className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${column.dot}`} />
                  <h3 className="text-sm font-semibold text-[#20242a]">
                    {column.label}
                  </h3>
                </div>

                <span className="rounded-full bg-[#f4f5f7] px-2 py-0.5 text-xs font-medium text-[#7d848e]">
                  {columnTasks.length}
                </span>
              </div>

              <div
                onDragOver={(event) => {
                  if (!draggingId) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (overColumn !== column.status) setOverColumn(column.status);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                    setOverColumn(null);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  handleDrop(column.status);
                }}
                className={[
                  "flex min-h-[140px] flex-col gap-2.5 rounded-2xl bg-[#f7f8f9] p-2.5 transition",
                  isDropTarget ? `ring-2 ${column.ring} bg-[#f1f3f5]` : "",
                ].join(" ")}
              >
                {columnTasks.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-[#dfe2e6] py-10">
                    <p className="text-xs text-[#a0a5ac]">
                      {draggingId ? "Largar aqui" : "Sem tarefas"}
                    </p>
                  </div>
                ) : (
                  visible.map((task) => (
                    <div
                      key={task.id}
                      className={draggingId === task.id ? "opacity-40" : ""}
                    >
                      <TaskCard
                        task={task}
                        lineName={
                          task.insurance_line_id
                            ? lineMap.get(task.insurance_line_id) ?? null
                            : null
                        }
                        assignedName={
                          task.assigned_user_id
                            ? profileMap.get(task.assigned_user_id) ?? null
                            : null
                        }
                        canModify={canModify(task)}
                        onOpen={(t) => setOpenTaskId(t.id)}
                        onMove={handleMove}
                        onProcessPatch={handleProcessPatch}
                        onDelete={handleDelete}
                        onDragStart={(t) => setDraggingId(t.id)}
                        onDragEnd={() => {
                          setDraggingId(null);
                          setOverColumn(null);
                        }}
                      />
                    </div>
                  ))
                )}

                {columnTasks.length > COLUMN_PAGE && (
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((prev) => ({
                        ...prev,
                        [column.status]: !isExpanded,
                      }))
                    }
                    className="rounded-lg py-1.5 text-xs font-medium text-[#7d848e] transition hover:bg-white hover:text-[#40464f]"
                  >
                    {isExpanded
                      ? "Mostrar menos"
                      : `Ver mais ${columnTasks.length - COLUMN_PAGE}`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* MODAIS */}

      {creating && (
        <CreateTaskModal
          profiles={profiles}
          insuranceLines={insuranceLines}
          privileged={privileged}
          currentProfileId={currentProfileId}
          initialKind={kindFilter === "PROCESS" ? "PROCESS" : "TASK"}
          onCreated={(kind) =>
            push(
              "success",
              kind === "PROCESS" ? "Processo criado." : "Tarefa criada.",
            )
          }
          onClose={() => setCreating(false)}
        />
      )}

      {openTask && openTask.kind === "PROCESS" && (
        <ProcessModal
          key={openTask.id}
          task={openTask}
          lineName={
            openTask.insurance_line_id
              ? lineMap.get(openTask.insurance_line_id) ?? null
              : null
          }
          insuranceLines={insuranceLines}
          profiles={profiles}
          privileged={privileged}
          canModify={canModify(openTask)}
          onSave={(base, patch) => handleSaveProcess(openTask, base, patch)}
          onClose={() => setOpenTaskId(null)}
        />
      )}

      {openTask && openTask.kind === "TASK" && (
        <EditTaskModal
          key={openTask.id}
          task={openTask}
          profiles={profiles}
          privileged={privileged}
          canModify={canModify(openTask)}
          onSave={(input) => handleEditTask(openTask, input)}
          onClose={() => setOpenTaskId(null)}
        />
      )}

      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
