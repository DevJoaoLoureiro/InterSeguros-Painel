"use client";

import { useState } from "react";
import {
  ArrowRight,
  Ban,
  Calendar,
  Check,
  GripVertical,
  Lock,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";

import type {
  ProcessPatch,
  TaskRow,
  TaskStatus,
} from "@/app/(dashboard)/tarefas/action";

import {
  avatarColor,
  columns,
  daysToAgenda,
  agendaDate,
  formatShortDate,
  initials,
  isOpen,
  nextStepLabel,
  priorityConfig,
  processSteps,
  receiptStatusLabel,
  relativeDayLabel,
  type ProcessStep,
} from "./utils";

type Props = {
  task: TaskRow;
  lineName: string | null;
  assignedName: string | null;
  canModify: boolean;
  onOpen: (task: TaskRow) => void;
  onMove: (task: TaskRow, status: TaskStatus) => void;
  onProcessPatch: (task: TaskRow, patch: ProcessPatch) => void;
  onDelete: (task: TaskRow) => void;
  onDragStart: (task: TaskRow) => void;
  onDragEnd: () => void;
};

export function TaskCard({
  task,
  lineName,
  assignedName,
  canModify,
  onOpen,
  onMove,
  onProcessPatch,
  onDelete,
  onDragStart,
  onDragEnd,
}: Props) {
  const isProcess = task.kind === "PROCESS";
  const priority = priorityConfig[task.priority];
  const open = isOpen(task);

  const days = daysToAgenda(task);
  const dateLabel = relativeDayLabel(agendaDate(task));
  const overdue = open && days !== null && days < 0;
  const soon = open && days !== null && days >= 0 && days <= 1;

  return (
    <div
      draggable={canModify}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", task.id);
        onDragStart(task);
      }}
      onDragEnd={onDragEnd}
      className={[
        "group relative rounded-xl border border-l-[3px] border-[#e5e8ec] bg-white p-3.5 shadow-[0_1px_4px_rgba(20,25,35,0.05)] transition hover:shadow-[0_4px_14px_rgba(20,25,35,0.08)]",
        priority.border,
        open ? "" : "opacity-75",
      ].join(" ")}
    >
      {/* CABEÇALHO */}

      <div className="flex items-start gap-2">
        {!isProcess && canModify && (
          <button
            type="button"
            role="checkbox"
            aria-checked={task.status === "COMPLETED"}
            onClick={() =>
              onMove(
                task,
                task.status === "COMPLETED" ? "PENDING" : "COMPLETED",
              )
            }
            title={
              task.status === "COMPLETED"
                ? "Marcar como por fazer"
                : "Marcar como concluída"
            }
            className={[
              "mt-0.5 flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-full border-2 transition",
              task.status === "COMPLETED"
                ? "border-green-500 bg-green-500 text-white"
                : "border-[#c0c4c9] bg-white text-transparent hover:border-green-500 hover:text-green-500",
            ].join(" ")}
          >
            <Check className="h-3 w-3" strokeWidth={3} />
          </button>
        )}

        <div className="min-w-0 flex-1">
          {isProcess && (
            <div className="mb-1.5 flex flex-wrap items-center gap-1">
              <span
                className={[
                  "rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                  task.is_new_policy === false
                    ? "bg-violet-50 text-violet-700"
                    : "bg-sky-50 text-sky-700",
                ].join(" ")}
              >
                {task.is_new_policy === false ? "Renegociação" : "Apólice nova"}
              </span>

              {lineName && (
                <span className="rounded-md bg-[#f4f5f7] px-1.5 py-0.5 text-[10px] font-medium text-[#59616d]">
                  {lineName}
                </span>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => onOpen(task)}
            className={[
              "block w-full cursor-pointer text-left text-sm font-medium leading-snug transition hover:text-[#ff4b0a]",
              task.status === "COMPLETED" && !isProcess
                ? "text-[#8a9099] line-through"
                : "text-[#20242a]",
            ].join(" ")}
          >
            {task.title}
          </button>

          {isProcess && (task.client_name || task.client_nif) && (
            <p className="mt-0.5 truncate text-xs text-[#8a9099]">
              {task.client_name}
              {task.client_nif ? ` · NIF ${task.client_nif}` : ""}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center">
          {canModify && (
            <GripVertical
              className="h-4 w-4 cursor-grab text-[#d5d8dc] opacity-0 transition group-hover:opacity-100"
              aria-hidden
            />
          )}

          {canModify && (
            <CardMenu
              task={task}
              onOpen={onOpen}
              onMove={onMove}
              onDelete={onDelete}
            />
          )}
        </div>
      </div>

      {task.description && (
        <p className="mt-1.5 line-clamp-2 text-xs text-[#8a9099]">
          {task.description}
        </p>
      )}

      {/* CHECKLIST DO PROCESSO */}

      {isProcess && (
        <ProcessChecklist
          task={task}
          canModify={canModify}
          onToggle={(step) => {
            if (step.key === "simulation") {
              onProcessPatch(task, {
                simulationPresented: !task.simulation_presented,
              });
            } else if (step.key === "issued") {
              onProcessPatch(task, { issued: !task.issued });
            } else {
              onProcessPatch(task, { receiptPaid: !task.receipt_paid });
            }
          }}
        />
      )}

      {/* RODAPÉ */}

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
          <span className="text-[11px] text-[#c0c4c9]">Sem responsável</span>
        )}

        <div className="flex shrink-0 items-center gap-1">
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${priority.badge}`}
          >
            {priority.label}
          </span>

          {dateLabel && (
            <span
              title={
                isProcess ? "Data de início do seguro" : "Prazo da tarefa"
              }
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
              {isProcess ? `Início ${dateLabel.toLowerCase()}` : dateLabel}
            </span>
          )}
        </div>
      </div>

      {isProcess && (
        <p className="mt-2 text-[10px] text-[#b0b5bb]">
          Criado a {formatShortDate(task.created_at)}
        </p>
      )}
    </div>
  );
}

// ============================================================
// CHECKLIST
// ============================================================

function ProcessChecklist({
  task,
  canModify,
  onToggle,
}: {
  task: TaskRow;
  canModify: boolean;
  onToggle: (step: ProcessStep) => void;
}) {
  const steps = processSteps(task);
  const doneCount = steps.filter((s) => s.done).length;
  const nextStep = nextStepLabel(task);
  const fromCompany = task.receipt_source === "WEBSERVICE";

  return (
    <div className="mt-3 rounded-lg border border-[#eef0f3] bg-[#fafbfc] p-2">
      <div className="flex items-center justify-between px-1 text-[10px] font-medium text-[#7d848e]">
        <span>Progresso</span>
        <span>
          {doneCount}/{steps.length}
        </span>
      </div>

      <div className="mx-1 mt-1 h-1.5 overflow-hidden rounded-full bg-[#e9ecef]">
        <div
          className="h-full rounded-full bg-green-500 transition-all duration-300"
          style={{ width: `${(doneCount / steps.length) * 100}%` }}
        />
      </div>

      <ul className="mt-1.5 space-y-0.5">
        {steps.map((step) => {
          const locked =
            (step.key === "receipt" && fromCompany) ||
            (step.key === "issued" && task.receipt_paid);

          const lockReason =
            step.key === "receipt"
              ? "Estado vindo do webservice da companhia"
              : "Com recibo pago a apólice está emitida";

          const disabled = !canModify || locked;

          return (
            <li key={step.key}>
              <button
                type="button"
                role="checkbox"
                aria-checked={step.done}
                disabled={disabled}
                onClick={() => onToggle(step)}
                title={
                  locked
                    ? lockReason
                    : step.done
                      ? `Clique para desmarcar "${step.label}"`
                      : `Clique para marcar "${step.label}"`
                }
                className="group/step flex w-full cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-left text-xs transition hover:bg-white disabled:cursor-default disabled:hover:bg-transparent"
              >
                <span
                  className={[
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition",
                    step.done
                      ? "border-green-500 bg-green-500 text-white"
                      : "border-[#c0c4c9] bg-white text-transparent",
                    !disabled && !step.done
                      ? "group-hover/step:border-[#ff4b0a]"
                      : "",
                    locked && step.done ? "opacity-70" : "",
                  ].join(" ")}
                >
                  <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
                </span>

                <span
                  className={
                    step.done
                      ? "font-medium text-[#20242a]"
                      : "text-[#59616d]"
                  }
                >
                  {step.label}
                </span>

                {step.key === "receipt" && fromCompany && (
                  <span className="ml-auto inline-flex items-center gap-0.5 rounded bg-blue-50 px-1 py-0.5 text-[9px] font-semibold text-blue-700">
                    <Lock className="h-2 w-2" />
                    {task.receipt
                      ? receiptStatusLabel[task.receipt.status] ??
                        task.receipt.status
                      : "Companhia"}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {nextStep && (
        <p className="mt-1 flex items-center gap-1 px-1 text-[11px] font-medium text-[#ff4b0a]">
          <ArrowRight className="h-3 w-3" />
          {nextStep}
        </p>
      )}
    </div>
  );
}

// ============================================================
// MENU
// ============================================================

function CardMenu({
  task,
  onOpen,
  onMove,
  onDelete,
}: {
  task: TaskRow;
  onOpen: (task: TaskRow) => void;
  onMove: (task: TaskRow, status: TaskStatus) => void;
  onDelete: (task: TaskRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isProcess = task.kind === "PROCESS";

  function close() {
    setOpen(false);
    setConfirmDelete(false);
  }

  const itemClass =
    "flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[#40464f] transition hover:bg-[#f4f5f7]";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md p-1 text-[#a0a5ac] transition hover:bg-[#f4f5f7] hover:text-[#40464f]"
        aria-label="Ações da tarefa"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={close} />

          <div className="absolute right-0 top-7 z-20 w-48 overflow-hidden rounded-lg border border-[#e5e8ec] bg-white py-1 shadow-lg">
            <button
              type="button"
              onClick={() => {
                close();
                onOpen(task);
              }}
              className={itemClass}
            >
              <Pencil className="h-3.5 w-3.5" />
              {isProcess ? "Abrir processo" : "Editar tarefa"}
            </button>

            {isProcess ? (
              task.status === "CANCELLED" ? (
                <button
                  type="button"
                  onClick={() => {
                    close();
                    onMove(task, "PENDING");
                  }}
                  className={itemClass}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reabrir processo
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    close();
                    onMove(task, "CANCELLED");
                  }}
                  className={itemClass}
                >
                  <Ban className="h-3.5 w-3.5" />
                  Cancelar processo
                </button>
              )
            ) : (
              <>
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[#a0a5ac]">
                  Mover para
                </p>
                {columns
                  .filter((c) => c.status !== task.status)
                  .map((c) => (
                    <button
                      key={c.status}
                      type="button"
                      onClick={() => {
                        close();
                        onMove(task, c.status);
                      }}
                      className={itemClass}
                    >
                      <span className={`h-2 w-2 rounded-full ${c.dot}`} />
                      {c.label}
                    </button>
                  ))}
              </>
            )}

            <div className="my-1 border-t border-[#f1f2f4]" />

            {confirmDelete ? (
              <button
                type="button"
                onClick={() => {
                  close();
                  onDelete(task);
                }}
                className="flex w-full items-center gap-2 bg-red-50 px-3 py-2 text-left text-xs font-semibold text-red-700 transition hover:bg-red-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Confirmar: apagar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-600 transition hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Apagar
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
