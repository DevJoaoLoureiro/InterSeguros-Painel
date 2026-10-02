import type {
  ProcessPatch,
  TaskPriority,
  TaskRow,
  TaskStatus,
} from "@/app/(dashboard)/tarefas/action";
import {
  deriveProcessStatus,
  isValidDateKey,
} from "@/lib/tasks/process-status";

export { isValidDateKey };

// ============================================================
// CONFIG
// ============================================================

export const columns: {
  status: TaskStatus;
  label: string;
  dot: string;
  ring: string;
}[] = [
  {
    status: "PENDING",
    label: "Pendente",
    dot: "bg-[#9aa0a8]",
    ring: "ring-[#9aa0a8]",
  },
  {
    status: "IN_PROGRESS",
    label: "Em progresso",
    dot: "bg-blue-500",
    ring: "ring-blue-400",
  },
  {
    status: "COMPLETED",
    label: "Concluída",
    dot: "bg-green-500",
    ring: "ring-green-400",
  },
  {
    status: "CANCELLED",
    label: "Cancelada",
    dot: "bg-[#c0c4c9]",
    ring: "ring-[#c0c4c9]",
  },
];

export const statusLabel: Record<TaskStatus, string> = Object.fromEntries(
  columns.map((c) => [c.status, c.label]),
) as Record<TaskStatus, string>;

export const priorityConfig: Record<
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

export const receiptStatusLabel: Record<string, string> = {
  PAID: "Pago",
  PENDING: "Por cobrar",
  RETURNED: "Devolvido",
  CANCELLED: "Anulado",
};

// ============================================================
// AVATAR
// ============================================================

const avatarPalette = [
  "bg-[#ff4b0a]",
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-pink-500",
  "bg-cyan-600",
];

export function avatarColor(seed: string) {
  let hash = 0;

  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }

  return avatarPalette[Math.abs(hash) % avatarPalette.length];
}

export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// ============================================================
// DATAS
// ============================================================

function parseDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function diffDaysFromToday(value: string) {
  const due = parseDate(value);
  if (!due) return null;

  const today = new Date();

  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const todayDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  return Math.round((dueDay.getTime() - todayDay.getTime()) / 86400000);
}

// Datas inválidas (ex.: ano 20226 gravado por engano) mostram o valor
// em bruto em vez de rebentar a página.
export function formatShortDate(value: string) {
  const date = parseDate(value);
  if (!date) return value;

  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

export function formatDate(value: string) {
  const date = parseDate(value);
  if (!date) return value;

  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function formatCurrency(value: number | null) {
  if (value === null) return "—";

  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

export function relativeDayLabel(value: string | null) {
  if (!value) return null;

  const diffDays = diffDaysFromToday(value);

  if (diffDays === null) return `Data inválida (${value.slice(0, 10)})`;
  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Amanhã";
  if (diffDays === -1) return "Ontem";
  if (diffDays > 1 && diffDays <= 7) return `Em ${diffDays} dias`;
  if (diffDays < -1 && diffDays >= -7) return `Há ${Math.abs(diffDays)} dias`;

  return formatShortDate(value);
}

/* Valor para <input type="date"> a partir de uma data/timestamp. */
export function toDateInput(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

// ============================================================
// REGRAS DE TAREFA / PROCESSO
// ============================================================

export function isOpen(task: TaskRow) {
  return task.status !== "COMPLETED" && task.status !== "CANCELLED";
}

/*
 * Data que conta para agenda/alertas: num processo é a data de
 * início do seguro, numa tarefa normal é o prazo.
 */
export function agendaDate(task: TaskRow) {
  return task.kind === "PROCESS"
    ? task.policy_start_date ?? task.due_at
    : task.due_at;
}

export function daysToAgenda(task: TaskRow) {
  const date = agendaDate(task);
  return date ? diffDaysFromToday(date) : null;
}

export function isOverdue(task: TaskRow) {
  const days = daysToAgenda(task);
  return isOpen(task) && days !== null && days < 0;
}

export function isToday(task: TaskRow) {
  return isOpen(task) && daysToAgenda(task) === 0;
}

export function isInNextDays(task: TaskRow, days: number) {
  const diff = daysToAgenda(task);
  return isOpen(task) && diff !== null && diff >= 0 && diff <= days;
}

/*
 * Aplica localmente (otimista) as mesmas regras que o servidor
 * (deriveProcessStatus): marcar passos avança, desmarcar recua.
 */
export function applyProcessPatch(task: TaskRow, patch: ProcessPatch): TaskRow {
  const next: TaskRow = {
    ...task,
    client_name: patch.clientName ?? task.client_name,
    client_nif:
      patch.clientNif !== undefined ? patch.clientNif : task.client_nif,
    insurance_line_id:
      patch.insuranceLineId !== undefined
        ? patch.insuranceLineId
        : task.insurance_line_id,
    policy_start_date:
      patch.policyStartDate !== undefined
        ? patch.policyStartDate
        : task.policy_start_date,
    due_at:
      patch.policyStartDate !== undefined ? patch.policyStartDate : task.due_at,
    is_new_policy: patch.isNewPolicy ?? task.is_new_policy,
    simulation_presented:
      patch.simulationPresented ?? task.simulation_presented,
    issued: patch.issued ?? task.issued,
  };

  if (patch.receiptPaid !== undefined) {
    next.receipt_paid = patch.receiptPaid;
    next.receipt_source = patch.receiptPaid ? "MANUAL" : null;
    if (patch.receiptPaid) next.issued = true;
  }

  next.status = deriveProcessStatus(next);

  return next;
}

/*
 * Estado para onde um processo vai se for reaberto / movido: só
 * CANCELLED é manual; o resto vem dos passos.
 */
export function processStatusFor(task: TaskRow, target: TaskStatus) {
  return target === "CANCELLED"
    ? "CANCELLED"
    : deriveProcessStatus({ ...task, status: "PENDING" });
}

export type ProcessStep = {
  key: "simulation" | "issued" | "receipt";
  label: string;
  done: boolean;
};

export function processSteps(task: TaskRow): ProcessStep[] {
  return [
    {
      key: "simulation",
      label: "Simulação apresentada",
      done: task.simulation_presented,
    },
    { key: "issued", label: "Apólice emitida", done: task.issued },
    { key: "receipt", label: "Recibo cobrado", done: task.receipt_paid },
  ];
}

export function nextStepLabel(task: TaskRow) {
  if (task.status === "CANCELLED") return null;
  if (!task.simulation_presented) return "Apresentar simulação";
  if (!task.issued) return "Emitir apólice";
  if (!task.receipt_paid) {
    return task.receipt_source === "WEBSERVICE"
      ? "Aguardar pagamento do recibo"
      : "Cobrar recibo";
  }
  return null;
}
