"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Calendar,
  Check,
  ChevronDown,
  Loader2,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";

import {
  CreateTaskModal,
  EditTaskModal,
  type TaskEditInput,
} from "@/components/tarefas/task-modals";
import { Toaster, useToasts } from "@/components/tarefas/toasts";
import {
  avatarColor,
  diffDaysFromToday,
  initials,
  priorityConfig,
  relativeDayLabel,
} from "@/components/tarefas/utils";

import {
  createTask,
  deleteTask,
  updateTask,
  updateTaskStatus,
  type InsuranceLineOption,
  type ProfileOption,
  type TaskRow,
} from "./action";

type Props = {
  initialTasks: TaskRow[];
  profiles: ProfileOption[];
  insuranceLines: InsuranceLineOption[];
  privileged: boolean;
  currentProfileId: string;
};

/*
 * Lista de tarefas por prazo: o que está atrasado primeiro, depois
 * hoje, os próximos dias e o resto. Um clique na bola conclui.
 * (Os processos de simulação têm página própria: /processos.)
 */

type GroupKey = "OVERDUE" | "TODAY" | "WEEK" | "LATER" | "NO_DATE";

const GROUPS: {
  key: GroupKey;
  label: string;
  tone: string;
  dot: string;
}[] = [
  { key: "OVERDUE", label: "Atrasadas", tone: "text-red-600", dot: "bg-red-500" },
  { key: "TODAY", label: "Hoje", tone: "text-amber-600", dot: "bg-amber-500" },
  {
    key: "WEEK",
    label: "Próximos 7 dias",
    tone: "text-blue-600",
    dot: "bg-blue-500",
  },
  {
    key: "LATER",
    label: "Mais tarde",
    tone: "text-[#40464f]",
    dot: "bg-[#8a9099]",
  },
  {
    key: "NO_DATE",
    label: "Sem prazo",
    tone: "text-[#40464f]",
    dot: "bg-[#c0c4c9]",
  },
];

/* Prazos rápidos da caixa "Adicionar tarefa". */
const QUICK_DUE: { key: string; label: string; days: number | null }[] = [
  { key: "none", label: "Sem prazo", days: null },
  { key: "today", label: "Hoje", days: 0 },
  { key: "tomorrow", label: "Amanhã", days: 1 },
  { key: "week", label: "Daqui a 7 dias", days: 7 },
];

/* YYYY-MM-DD local, daqui a N dias. */
function dateKeyInDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
}

const DONE_PAGE = 10;

function isDone(task: TaskRow) {
  return task.status === "COMPLETED" || task.status === "CANCELLED";
}

function groupOf(task: TaskRow): GroupKey {
  const days = task.due_at ? diffDaysFromToday(task.due_at) : null;

  if (days === null) return "NO_DATE";
  if (days < 0) return "OVERDUE";
  if (days === 0) return "TODAY";
  if (days <= 7) return "WEEK";
  return "LATER";
}

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
  // Todos veem as tarefas da equipa; funcionários abrem em "As minhas".
  const [assigneeFilter, setAssigneeFilter] = useState<string>(
    privileged ? "ALL" : currentProfileId,
  );
  const [showDone, setShowDone] = useState(false);
  const [showAllDone, setShowAllDone] = useState(false);
  const [groupFilter, setGroupFilter] = useState<GroupKey | "ALL">("ALL");

  // Caixa "Adicionar tarefa" (título + Enter).
  const [quickTitle, setQuickTitle] = useState("");
  const [quickDue, setQuickDue] = useState("none");
  const [isAdding, startAdding] = useTransition();

  const [, startTransition] = useTransition();
  const { toasts, push, dismiss } = useToasts();

  const profileMap = useMemo(
    () => new Map(profiles.map((p) => [p.id, p.full_name])),
    [profiles],
  );

  const openTask = tasks.find((t) => t.id === openTaskId) ?? null;

  // ----------------------------------------
  // FILTROS
  // ----------------------------------------

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return tasks.filter((task) => {
      if (assigneeFilter !== "ALL" && task.assigned_user_id !== assigneeFilter) {
        return false;
      }

      return (
        !query ||
        task.title.toLowerCase().includes(query) ||
        (task.description ?? "").toLowerCase().includes(query) ||
        (task.client_name ?? "").toLowerCase().includes(query)
      );
    });
  }, [tasks, search, assigneeFilter]);

  const openTasks = filtered.filter((t) => !isDone(t));

  const doneTasks = filtered
    .filter(isDone)
    .sort((a, b) =>
      (b.completed_at ?? b.created_at).localeCompare(
        a.completed_at ?? a.created_at,
      ),
    );

  const grouped = GROUPS.map((group) => ({
    ...group,
    items: openTasks
      .filter((t) => groupOf(t) === group.key)
      .sort(
        (a, b) =>
          (a.due_at ?? "").localeCompare(b.due_at ?? "") ||
          b.created_at.localeCompare(a.created_at),
      ),
  })).filter((group) => group.items.length > 0);

  const visibleGroups =
    groupFilter === "ALL"
      ? grouped
      : grouped.filter((group) => group.key === groupFilter);

  const countOf = (key: GroupKey) =>
    grouped.find((group) => group.key === key)?.items.length ?? 0;

  // ----------------------------------------
  // AÇÕES (otimistas, com reversão em erro)
  // ----------------------------------------

  function replaceTask(next: TaskRow) {
    setTasks((prev) => prev.map((t) => (t.id === next.id ? next : t)));
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
        setTasks((prev) => {
          const exists = prev.some((t) => t.id === previous.id);
          return exists
            ? prev.map((t) => (t.id === previous.id ? previous : t))
            : [previous, ...prev];
        });

        push(
          "error",
          error instanceof Error ? error.message : "Não foi possível guardar.",
        );
      }
    });
  }

  function handleQuickAdd() {
    const title = quickTitle.trim();
    if (!title || isAdding) return;

    const days = QUICK_DUE.find((d) => d.key === quickDue)?.days ?? null;

    startAdding(async () => {
      try {
        await createTask({
          kind: "TASK",
          title,
          description: null,
          priority: "MEDIUM",
          dueAt: days === null ? null : dateKeyInDays(days),
          assignedUserId: null,
        });

        setQuickTitle("");
        push("success", "Tarefa criada.");
      } catch (error) {
        push(
          "error",
          error instanceof Error ? error.message : "Erro ao criar tarefa.",
        );
      }
    });
  }

  function handleToggle(task: TaskRow) {
    const nextStatus = isDone(task) ? "PENDING" : "COMPLETED";

    replaceTask({
      ...task,
      status: nextStatus,
      completed_at:
        nextStatus === "COMPLETED" ? new Date().toISOString() : null,
    });

    run(
      task,
      () => updateTaskStatus(task.id, nextStatus),
      nextStatus === "COMPLETED" ? "Tarefa concluída." : "Tarefa reaberta.",
    );
  }

  function handleEdit(task: TaskRow, input: TaskEditInput) {
    replaceTask({
      ...task,
      title: input.title?.trim() || task.title,
      description:
        input.description !== undefined ? input.description : task.description,
      priority: input.priority ?? task.priority,
      due_at: input.dueAt !== undefined ? input.dueAt : task.due_at,
      assigned_user_id: input.assignedUserId ?? task.assigned_user_id,
    });

    run(task, () => updateTask(task.id, input), "Tarefa atualizada.");
  }

  function handleDelete(task: TaskRow) {
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    run(task, () => deleteTask(task.id), "Tarefa apagada.");
  }

  // ----------------------------------------
  // RENDER
  // ----------------------------------------

  function renderRow(task: TaskRow) {
    return (
      <TaskRowItem
        key={task.id}
        task={task}
        assignedName={
          task.assigned_user_id
            ? profileMap.get(task.assigned_user_id) ?? null
            : null
        }
        onToggle={handleToggle}
        onOpen={(t) => setOpenTaskId(t.id)}
        onDelete={handleDelete}
      />
    );
  }

  const visibleDone = showAllDone ? doneTasks : doneTasks.slice(0, DONE_PAGE);

  return (
    <div className="space-y-5">
      {/* ADICIONAR — escreve e carrega Enter */}

      <div className="rounded-2xl border border-[#e5e8ec] bg-white p-3 shadow-[0_2px_10px_rgba(20,25,35,0.04)] transition focus-within:border-[#ffb899] focus-within:shadow-[0_6px_20px_rgba(255,75,10,0.10)]">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-[#ff4b0a]">
            <Plus className="h-4 w-4" />
          </span>

          <input
            type="text"
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleQuickAdd();
            }}
            placeholder="Adicionar tarefa… ex.: Ligar ao cliente sobre a renovação"
            aria-label="Nova tarefa"
            className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#a0a5ac]"
          />

          <button
            type="button"
            onClick={() => setCreating(true)}
            title="Mais opções (descrição, prioridade, responsável)"
            aria-label="Mais opções"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[#8a9099] transition hover:bg-[#f4f5f7] hover:text-[#40464f]"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={handleQuickAdd}
            disabled={!quickTitle.trim() || isAdding}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#ff5a1f] to-[#ff4b0a] px-3.5 text-sm font-semibold text-white shadow-[0_2px_10px_rgba(255,75,10,0.28)] transition hover:shadow-[0_6px_18px_rgba(255,75,10,0.36)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            {isAdding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Adicionar
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-11">
          <span className="text-[11px] text-[#8a9099]">Prazo:</span>

          {QUICK_DUE.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setQuickDue(option.key)}
              aria-pressed={quickDue === option.key}
              className={[
                "h-6 rounded-full px-2.5 text-[11px] font-medium transition",
                quickDue === option.key
                  ? "bg-[#20242a] text-white"
                  : "bg-[#f4f5f7] text-[#59616d] hover:bg-[#e9ecef]",
              ].join(" ")}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* FILTROS RÁPIDOS */}

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            { key: "ALL", label: "Todas", count: openTasks.length, dot: "" },
            ...GROUPS.slice(0, 3).map((group) => ({
              key: group.key,
              label: group.label,
              count: countOf(group.key),
              dot: group.dot,
            })),
          ] as { key: GroupKey | "ALL"; label: string; count: number; dot: string }[]
        ).map((pill) => (
          <button
            key={pill.key}
            type="button"
            onClick={() =>
              setGroupFilter(groupFilter === pill.key ? "ALL" : pill.key)
            }
            aria-pressed={groupFilter === pill.key}
            className={[
              "inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition",
              groupFilter === pill.key
                ? "border-[#ff4b0a] bg-[#fff7f3] text-[#20242a] ring-2 ring-[#ff4b0a]/10"
                : "border-[#e4e6e9] bg-white text-[#59616d] hover:border-[#ffb899]",
            ].join(" ")}
          >
            {pill.dot && <span className={`h-2 w-2 rounded-full ${pill.dot}`} />}
            {pill.label}
            <span
              className={[
                "rounded-full px-1.5 text-xs font-semibold tabular-nums",
                pill.key === "OVERDUE" && pill.count > 0
                  ? "bg-red-50 text-red-700"
                  : "bg-[#f4f5f7] text-[#59616d]",
              ].join(" ")}
            >
              {pill.count}
            </span>
          </button>
        ))}
      </div>

      {/* PESQUISA */}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#a0a5ac]" />

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar tarefa ou cliente..."
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
                    ? `As minhas (${p.full_name})`
                    : p.full_name}
                </option>
              ))}
            </select>
          )}

        </div>
      </div>

      {/* POR FAZER */}

      {visibleGroups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#dfe2e6] bg-white py-14 text-center">
          <p className="text-sm font-medium text-[#40464f]">
            {search.trim()
              ? "Nenhuma tarefa por fazer com essa pesquisa"
              : groupFilter !== "ALL"
                ? "Nada neste grupo"
                : "Nada por fazer. 🎉"}
          </p>
          <p className="mt-1 text-xs text-[#8a9099]">
            Escreve na caixa de cima e carrega Enter para criar uma
            tarefa.
          </p>
        </div>
      ) : (
        visibleGroups.map((group) => (
          <section key={group.key}>
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className={`h-2 w-2 rounded-full ${group.dot}`} />
              <h2 className={`text-sm font-semibold ${group.tone}`}>
                {group.label}
              </h2>
              <span className="rounded-full bg-[#f4f5f7] px-2 py-0.5 text-xs font-medium text-[#7d848e]">
                {group.items.length}
              </span>
            </div>

            <div className="divide-y divide-[#eef0f2] overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
              {group.items.map(renderRow)}
            </div>
          </section>
        ))
      )}

      {/* CONCLUÍDAS */}

      {doneTasks.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            aria-expanded={showDone}
            className="mb-2 flex items-center gap-2 rounded-lg px-1 py-1 text-sm font-semibold text-[#7d848e] transition hover:text-[#40464f]"
          >
            <ChevronDown
              className={`h-4 w-4 transition ${showDone ? "" : "-rotate-90"}`}
            />
            Concluídas
            <span className="rounded-full bg-[#f4f5f7] px-2 py-0.5 text-xs font-medium">
              {doneTasks.length}
            </span>
          </button>

          {showDone && (
            <>
              <div className="divide-y divide-[#eef0f2] overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white">
                {visibleDone.map(renderRow)}
              </div>

              {doneTasks.length > DONE_PAGE && (
                <button
                  type="button"
                  onClick={() => setShowAllDone((v) => !v)}
                  className="mt-2 rounded-lg px-2 py-1.5 text-xs font-medium text-[#7d848e] transition hover:bg-white hover:text-[#40464f]"
                >
                  {showAllDone
                    ? "Mostrar menos"
                    : `Ver mais ${doneTasks.length - DONE_PAGE}`}
                </button>
              )}
            </>
          )}
        </section>
      )}

      {/* MODAIS */}

      {creating && (
        <CreateTaskModal
          profiles={profiles}
          insuranceLines={insuranceLines}
          privileged={privileged}
          currentProfileId={currentProfileId}
          initialKind="TASK"
          onCreated={() => push("success", "Tarefa criada.")}
          onClose={() => setCreating(false)}
        />
      )}

      {openTask && (
        <EditTaskModal
          key={openTask.id}
          task={openTask}
          profiles={profiles}
          privileged={privileged}
          canModify
          onSave={(input) => handleEdit(openTask, input)}
          onClose={() => setOpenTaskId(null)}
        />
      )}

      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

// ============================================================
// LINHA
// ============================================================

function TaskRowItem({
  task,
  assignedName,
  onToggle,
  onOpen,
  onDelete,
}: {
  task: TaskRow;
  assignedName: string | null;
  onToggle: (task: TaskRow) => void;
  onOpen: (task: TaskRow) => void;
  onDelete: (task: TaskRow) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const done = isDone(task);
  const priority = priorityConfig[task.priority];
  const days = task.due_at ? diffDaysFromToday(task.due_at) : null;
  const dateLabel = relativeDayLabel(task.due_at);
  const overdue = !done && days !== null && days < 0;
  const soon = !done && days !== null && days >= 0 && days <= 1;

  return (
    <div className="group flex animate-fade-up items-start gap-3 px-4 py-3 transition hover:bg-[#fafbfc]">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        onClick={() => onToggle(task)}
        title={done ? "Marcar como por fazer" : "Marcar como concluída"}
        className={[
          "mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 transition active:scale-90",
          done
            ? "animate-check-pop border-green-500 bg-green-500 text-white"
            : "border-[#c0c4c9] bg-white text-transparent hover:border-green-500 hover:text-green-500",
        ].join(" ")}
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </button>

      <button
        type="button"
        onClick={() => onOpen(task)}
        className="min-w-0 flex-1 cursor-pointer text-left"
      >
        <p
          className={[
            "text-sm font-medium leading-snug",
            done ? "text-[#8a9099] line-through" : "text-[#20242a]",
          ].join(" ")}
        >
          {task.title}
        </p>

        {task.description && (
          <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs text-[#8a9099]">
            {task.description}
          </p>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {task.status === "CANCELLED" && (
            <span className="rounded-md bg-[#f4f5f7] px-1.5 py-0.5 text-[10px] font-medium text-[#7d848e]">
              Cancelada
            </span>
          )}

          {dateLabel && (
            <span
              className={[
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                overdue
                  ? "bg-red-50 text-red-700"
                  : soon
                    ? "bg-amber-50 text-amber-700"
                    : "bg-[#f4f5f7] text-[#7d848e]",
              ].join(" ")}
            >
              <Calendar className="h-2.5 w-2.5" />
              {dateLabel}
            </span>
          )}

          {!done && task.priority !== "MEDIUM" && (
            <span
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${priority.badge}`}
            >
              Prioridade {priority.label.toLowerCase()}
            </span>
          )}

          {task.client_name && (
            <span className="truncate text-[11px] text-[#8a9099]">
              {task.client_name}
            </span>
          )}
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        {assignedName && (
          <div
            title={assignedName}
            className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white ${avatarColor(assignedName)}`}
          >
            {initials(assignedName)}
          </div>
        )}

        {confirmDelete ? (
          <button
            type="button"
            onClick={() => onDelete(task)}
            onBlur={() => setConfirmDelete(false)}
            autoFocus
            className="rounded-lg bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 transition hover:bg-red-100"
          >
            Apagar?
          </button>
        ) : (
          <div className="flex items-center opacity-100 transition lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
            <button
              type="button"
              onClick={() => onOpen(task)}
              aria-label="Editar tarefa"
              title="Editar"
              className="rounded-md p-1.5 text-[#a0a5ac] transition hover:bg-[#f4f5f7] hover:text-[#40464f]"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label="Apagar tarefa"
              title="Apagar"
              className="rounded-md p-1.5 text-[#a0a5ac] transition hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
