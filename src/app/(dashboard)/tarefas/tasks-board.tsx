"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Calendar,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

import {
  createTask,
  deleteTask,
  updateTaskStatus,
  type ProfileOption,
  type TaskPriority,
  type TaskRow,
  type TaskStatus,
} from "./action";

type Props = {
  initialTasks: TaskRow[];
  profiles: ProfileOption[];
  privileged: boolean;
  currentProfileId: string;
};

const columns: {
  status: TaskStatus;
  label: string;
  dot: string;
}[] = [
  { status: "PENDING", label: "Pendente", dot: "bg-[#9aa0a8]" },
  { status: "IN_PROGRESS", label: "Em Progresso", dot: "bg-blue-500" },
  { status: "COMPLETED", label: "Concluída", dot: "bg-green-500" },
  { status: "CANCELLED", label: "Cancelada", dot: "bg-[#c0c4c9]" },
];

const priorityConfig: Record<
  TaskPriority,
  { label: string; border: string; badge: string }
> = {
  LOW: {
    label: "Baixa",
    border: "border-l-[#c0c4c9]",
    badge: "bg-[#f4f5f7] text-[#59616d]",
  },
  MEDIUM: {
    label: "Média",
    border: "border-l-amber-400",
    badge: "bg-amber-50 text-amber-700",
  },
  HIGH: {
    label: "Alta",
    border: "border-l-red-500",
    badge: "bg-red-50 text-red-700",
  },
};

const avatarPalette = [
  "bg-[#ff4b0a]",
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-pink-500",
  "bg-cyan-600",
];

function avatarColor(seed: string) {
  let hash = 0;

  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }

  return avatarPalette[Math.abs(hash) % avatarPalette.length];
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function relativeDueLabel(value: string | null) {
  if (!value) {
    return null;
  }

  const due = new Date(value);
  const today = new Date();

  const dueDay = new Date(
    due.getFullYear(),
    due.getMonth(),
    due.getDate(),
  );

  const todayDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  const diffDays = Math.round(
    (dueDay.getTime() - todayDay.getTime()) / 86400000,
  );

  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Amanhã";
  if (diffDays === -1) return "Ontem";

  if (diffDays > 1 && diffDays <= 7) return `Em ${diffDays} dias`;
  if (diffDays < -1 && diffDays >= -7) return `Há ${Math.abs(diffDays)} dias`;

  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
  }).format(due);
}

function isOverdue(dueAt: string | null, status: TaskStatus) {
  if (!dueAt || status === "COMPLETED" || status === "CANCELLED") {
    return false;
  }

  return new Date(dueAt) < new Date();
}

export function TasksBoard({
  initialTasks,
  profiles,
  privileged,
  currentProfileId,
}: Props) {
  const [tasks, setTasks] = useState(initialTasks);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<
    TaskPriority | "ALL"
  >("ALL");
  const [isPending, startTransition] = useTransition();

  const profileMap = useMemo(
    () => new Map(profiles.map((p) => [p.id, p.full_name])),
    [profiles],
  );

  const filteredTasks = useMemo(() => {
    const query = search.trim().toLowerCase();

    return tasks.filter((task) => {
      const matchesSearch =
        !query ||
        task.title.toLowerCase().includes(query) ||
        (task.description ?? "").toLowerCase().includes(query);

      const matchesPriority =
        priorityFilter === "ALL" || task.priority === priorityFilter;

      return matchesSearch && matchesPriority;
    });
  }, [tasks, search, priorityFilter]);

  const overdueCount = tasks.filter((t) =>
    isOverdue(t.due_at, t.status),
  ).length;

  function handleStatusChange(taskId: string, status: TaskStatus) {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status } : t)),
    );

    startTransition(async () => {
      try {
        await updateTaskStatus(taskId, status);
      } catch (error) {
        alert(
          error instanceof Error
            ? error.message
            : "Erro ao atualizar tarefa.",
        );
      }
    });
  }

  function handleDelete(taskId: string) {
    if (!confirm("Apagar esta tarefa?")) {
      return;
    }

    setTasks((prev) => prev.filter((t) => t.id !== taskId));

    startTransition(async () => {
      try {
        await deleteTask(taskId);
      } catch (error) {
        alert(
          error instanceof Error
            ? error.message
            : "Erro ao apagar tarefa.",
        );
      }
    });
  }

  return (
    <div className="space-y-5">
      {/* RESUMO */}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {columns.map((column) => {
          const count = tasks.filter(
            (t) => t.status === column.status,
          ).length;

          return (
            <div
              key={column.status}
              className="rounded-2xl border border-[#e5e8ec] bg-white p-4 shadow-[0_2px_10px_rgba(20,25,35,0.04)]"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${column.dot}`}
                />
                <p className="text-xs font-medium text-[#7d848e]">
                  {column.label}
                </p>
              </div>

              <p className="mt-2 text-2xl font-semibold text-[#17191d]">
                {count}
              </p>
            </div>
          );
        })}
      </div>

      {/* TOOLBAR */}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#a0a5ac]" />

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar tarefas..."
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

          {overdueCount > 0 && (
            <span className="inline-flex h-10 items-center rounded-xl bg-red-50 px-3 text-xs font-medium text-red-700">
              {overdueCount} atrasada(s)
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#ff4b0a] px-4 text-sm font-medium text-white shadow-sm transition hover:bg-[#e64409]"
        >
          <Plus className="h-4 w-4" />
          Nova tarefa
        </button>
      </div>

      {/* BOARD */}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {columns.map((column) => {
          const columnTasks = filteredTasks.filter(
            (t) => t.status === column.status,
          );

          return (
            <div key={column.status} className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${column.dot}`}
                  />
                  <h3 className="text-sm font-semibold text-[#20242a]">
                    {column.label}
                  </h3>
                </div>

                <span className="rounded-full bg-[#f4f5f7] px-2 py-0.5 text-xs font-medium text-[#7d848e]">
                  {columnTasks.length}
                </span>
              </div>

              <div className="flex min-h-[120px] flex-col gap-2.5 rounded-2xl bg-[#f7f8f9] p-2.5">
                {columnTasks.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-[#dfe2e6] py-10">
                    <p className="text-xs text-[#a0a5ac]">
                      Sem tarefas
                    </p>
                  </div>
                ) : (
                  columnTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      assignedName={
                        task.assigned_user_id
                          ? profileMap.get(task.assigned_user_id) ?? null
                          : null
                      }
                      canModify={
                        privileged ||
                        task.assigned_user_id === currentProfileId
                      }
                      isPending={isPending}
                      onStatusChange={handleStatusChange}
                      onDelete={handleDelete}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showForm && (
        <TaskFormModal
          profiles={profiles}
          privileged={privileged}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

// ============================================================
// CARD
// ============================================================

function TaskCard({
  task,
  assignedName,
  canModify,
  isPending,
  onStatusChange,
  onDelete,
}: {
  task: TaskRow;
  assignedName: string | null;
  canModify: boolean;
  isPending: boolean;
  onStatusChange: (taskId: string, status: TaskStatus) => void;
  onDelete: (taskId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const overdue = isOverdue(task.due_at, task.status);
  const dueLabel = relativeDueLabel(task.due_at);
  const priority = priorityConfig[task.priority];

  return (
    <div
      className={`group relative rounded-xl border border-l-[3px] ${priority.border} border-[#e5e8ec] bg-white p-3.5 shadow-[0_1px_4px_rgba(20,25,35,0.05)] transition hover:shadow-[0_4px_14px_rgba(20,25,35,0.08)]`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug text-[#20242a]">
          {task.title}
        </p>

        {canModify && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-md p-1 text-[#c0c4c9] opacity-0 transition hover:bg-[#f4f5f7] hover:text-[#606771] group-hover:opacity-100"
              aria-label="Mais opções"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>

            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setMenuOpen(false)}
                />

                <div className="absolute right-0 top-7 z-20 w-36 overflow-hidden rounded-lg border border-[#e5e8ec] bg-white shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete(task.id);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-600 transition hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Apagar
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {task.description && (
        <p className="mt-1 line-clamp-2 text-xs text-[#8a9099]">
          {task.description}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span
          className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${priority.badge}`}
        >
          {priority.label}
        </span>

        {dueLabel && (
          <span
            className={[
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
              overdue
                ? "bg-red-50 text-red-700"
                : "bg-[#f4f5f7] text-[#7d848e]",
            ].join(" ")}
          >
            <Calendar className="h-2.5 w-2.5" />
            {dueLabel}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        {assignedName ? (
          <div className="flex min-w-0 items-center gap-1.5">
            <div
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white ${avatarColor(assignedName)}`}
            >
              {initials(assignedName)}
            </div>

            <span className="truncate text-[11px] text-[#8a9099]">
              {assignedName}
            </span>
          </div>
        ) : (
          <span className="text-[11px] text-[#c0c4c9]">
            Sem responsável
          </span>
        )}
      </div>

      {canModify && (
        <select
          value={task.status}
          onChange={(event) =>
            onStatusChange(task.id, event.target.value as TaskStatus)
          }
          disabled={isPending}
          className="mt-2.5 h-8 w-full rounded-lg border border-[#e4e6e9] bg-white px-2 text-xs text-[#59616d] outline-none transition focus:border-[#ff4b0a]"
        >
          {columns.map((c) => (
            <option key={c.status} value={c.status}>
              {c.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// ============================================================
// MODAL
// ============================================================

function TaskFormModal({
  profiles,
  privileged,
  onClose,
}: {
  profiles: ProfileOption[];
  privileged: boolean;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [dueAt, setDueAt] = useState("");
  const [assignedUserId, setAssignedUserId] = useState(
    profiles[0]?.id ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!title.trim()) {
      setError("O título é obrigatório.");
      return;
    }

    setError(null);

    startTransition(async () => {
      try {
        await createTask({
          title,
          description: description || null,
          priority,
          dueAt: dueAt || null,
          assignedUserId: privileged ? assignedUserId || null : null,
        });

        window.location.reload();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Erro ao criar tarefa.",
        );
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#edf0f2] px-5 py-4">
          <div>
            <h2 className="font-semibold text-[#20242a]">Nova tarefa</h2>
            <p className="mt-0.5 text-xs text-[#8a9099]">
              Cria um follow-up para a equipa.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#a0a5ac] transition hover:bg-[#f4f5f7] hover:text-[#606771]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5 px-5 py-4">
          <div>
            <label className="text-xs font-medium text-[#7d848e]">
              Título
            </label>

            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              className="mt-1.5 h-10 w-full rounded-lg border border-[#e4e6e9] px-3 text-sm outline-none transition focus:border-[#ff4b0a]"
              placeholder="Ex: Ligar ao cliente sobre renovação"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-[#7d848e]">
              Descrição (opcional)
            </label>

            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1.5 w-full rounded-lg border border-[#e4e6e9] px-3 py-2 text-sm outline-none transition focus:border-[#ff4b0a]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-[#7d848e]">
                Prioridade
              </label>

              <select
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as TaskPriority)
                }
                className="mt-1.5 h-10 w-full rounded-lg border border-[#e4e6e9] px-3 text-sm outline-none transition focus:border-[#ff4b0a]"
              >
                <option value="LOW">Baixa</option>
                <option value="MEDIUM">Média</option>
                <option value="HIGH">Alta</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-[#7d848e]">
                Prazo (opcional)
              </label>

              <input
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-lg border border-[#e4e6e9] px-3 text-sm outline-none transition focus:border-[#ff4b0a]"
              />
            </div>
          </div>

          {privileged && (
            <div>
              <label className="text-xs font-medium text-[#7d848e]">
                Responsável
              </label>

              <select
                value={assignedUserId}
                onChange={(e) => setAssignedUserId(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-lg border border-[#e4e6e9] px-3 text-sm outline-none transition focus:border-[#ff4b0a]"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 border-t border-[#edf0f2] pt-3.5">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-lg px-4 text-sm font-medium text-[#606771] transition hover:bg-[#f4f5f7]"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={isPending}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#ff4b0a] px-4 text-sm font-medium text-white shadow-sm transition hover:bg-[#e64409] disabled:opacity-50"
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Criar tarefa
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}