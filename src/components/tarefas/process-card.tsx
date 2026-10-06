"use client";

import { useState } from "react";
import {
  ArrowRight,
  Calendar,
  Check,
  Clock,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
  Undo2,
} from "lucide-react";

import type { ProcessPatch, TaskRow } from "@/app/(dashboard)/tarefas/action";
import { notIssuedReasonLabel } from "@/lib/tasks/not-issued";

import {
  agendaDate,
  avatarColor,
  daysToAgenda,
  formatDate,
  initials,
  processStage,
  processStages,
  relativeDayLabel,
} from "./utils";

/*
 * Cartão de um processo — só o essencial:
 *   quem é, que seguro, quando começa, e UM botão com o próximo passo.
 * A fase já é dada pela coluna onde o cartão está, por isso o cartão
 * não a repete. O resto (detalhes, desfazer, apagar) está no menu.
 */

type Props = {
  process: TaskRow;
  lineName: string | null;
  assignedName: string | null;
  onOpen: (process: TaskRow) => void;
  onPatch: (process: TaskRow, patch: ProcessPatch) => void;
  onNotIssued: (process: TaskRow) => void;
  onReopen: (process: TaskRow) => void;
  onDelete: (process: TaskRow) => void;
};

/* O que o botão principal faz neste momento (null = nada a marcar). */
function nextAction(
  process: TaskRow,
): { label: string; patch: ProcessPatch } | null {
  if (!process.simulation_presented) {
    return {
      label: "Simulação apresentada",
      patch: { simulationPresented: true },
    };
  }

  if (!process.issued) {
    return { label: "Apólice emitida", patch: { issued: true } };
  }

  if (!process.receipt_paid && process.receipt_source !== "WEBSERVICE") {
    return { label: "Recibo pago", patch: { receiptPaid: true } };
  }

  return null;
}

/* Desfazer o último passo marcado (enganos acontecem). */
function undoAction(
  process: TaskRow,
): { label: string; patch: ProcessPatch } | null {
  const fromCompany = process.receipt_source === "WEBSERVICE";

  if (process.receipt_paid) {
    return fromCompany
      ? null
      : { label: "Desmarcar recibo pago", patch: { receiptPaid: false } };
  }

  if (process.issued) {
    return { label: "Desmarcar apólice emitida", patch: { issued: false } };
  }

  if (process.simulation_presented) {
    return {
      label: "Desmarcar simulação apresentada",
      patch: { simulationPresented: false },
    };
  }

  return null;
}

export function ProcessCard({
  process,
  lineName,
  assignedName,
  onOpen,
  onPatch,
  onNotIssued,
  onReopen,
  onDelete,
}: Props) {
  const notIssued = process.status === "CANCELLED";
  const done = process.receipt_paid && !notIssued;
  const open = !notIssued && !done;

  const stage = processStages.find((s) => s.key === processStage(process));
  const action = open ? nextAction(process) : null;
  const waitingCompany =
    open &&
    process.issued &&
    !process.receipt_paid &&
    process.receipt_source === "WEBSERVICE";

  const days = daysToAgenda(process);
  const dateLabel = relativeDayLabel(agendaDate(process));
  const overdue = open && days !== null && days < 0;
  const soon = open && days !== null && days >= 0 && days <= 5;

  return (
    <div
      className={[
        "animate-fade-up rounded-xl border border-l-[3px] bg-white p-3 shadow-[0_1px_4px_rgba(20,25,35,0.05)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_22px_rgba(20,25,35,0.10)]",
        notIssued
          ? "border-[#e5e8ec] border-l-[#c0c4c9]"
          : overdue
            ? "border-red-200 border-l-red-500"
            : `border-[#e5e8ec] ${stage?.side ?? ""}`,
      ].join(" ")}
    >
      {/* QUEM / QUE SEGURO */}

      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => onOpen(process)}
          className="min-w-0 flex-1 cursor-pointer text-left"
          title="Abrir detalhes"
        >
          <p className="truncate text-sm font-semibold text-[#20242a] transition hover:text-[#ff4b0a]">
            {process.client_name || process.title}
          </p>

          <p className="mt-0.5 truncate text-xs text-[#8a9099]">
            {process.is_new_policy === false ? "Renegociação" : "Apólice nova"}
            {lineName ? ` · ${lineName}` : ""}
          </p>
        </button>

        {assignedName && (
          <div
            title={`Responsável: ${assignedName}`}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white ${avatarColor(assignedName)}`}
          >
            {initials(assignedName)}
          </div>
        )}

        <CardMenu
          process={process}
          undo={open || done ? undoAction(process) : null}
          onOpen={onOpen}
          onPatch={onPatch}
          onDelete={onDelete}
        />
      </div>

      {notIssued ? (
        <>
          <p className="mt-2 text-xs text-[#40464f]">
            <span className="font-semibold text-red-700">Não emitida: </span>
            {notIssuedReasonLabel(process.not_issued_reason) ??
              "sem motivo registado"}
            {process.not_issued_at
              ? ` · ${formatDate(process.not_issued_at)}`
              : ""}
          </p>

          {process.not_issued_note && (
            <p className="mt-0.5 line-clamp-2 text-[11px] text-[#737a84]">
              {process.not_issued_note}
            </p>
          )}

          <button
            type="button"
            onClick={() => onReopen(process)}
            className="mt-2 inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-[#59616d] transition hover:bg-[#f4f5f7] hover:text-[#20242a]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reabrir
          </button>
        </>
      ) : (
        <>
          {/* QUANDO */}

          {(dateLabel || (process.priority === "HIGH" && open)) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {dateLabel && (
                <span
                  className={[
                    "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                    overdue
                      ? "bg-red-50 text-red-700"
                      : soon
                        ? "bg-amber-50 text-amber-700"
                        : "bg-[#f4f5f7] text-[#7d848e]",
                  ].join(" ")}
                  title="Data de início do seguro"
                >
                  <Calendar className="h-3 w-3" />
                  {overdue ? "Início passou " : "Início "}
                  {dateLabel.toLowerCase()}
                </span>
              )}

              {process.priority === "HIGH" && open && (
                <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
                  Urgente
                </span>
              )}
            </div>
          )}

          {/* PRÓXIMO PASSO */}

          {action && (
            <button
              type="button"
              onClick={() => onPatch(process, action.patch)}
              className="group/next mt-2.5 inline-flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[#ff6a2b] to-[#ea5b0c] px-3 text-xs font-semibold text-white shadow-[0_2px_8px_rgba(234,91,12,0.28)] transition hover:shadow-[0_4px_14px_rgba(234,91,12,0.38)] active:scale-[0.98]"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
              {action.label}
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/next:translate-x-0.5" />
            </button>
          )}

          {waitingCompany && (
            <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-blue-700">
              <Clock className="h-3 w-3 shrink-0" />
              À espera do recibo pago (fecha sozinho)
            </p>
          )}

          {done && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-green-700">
              <Check className="h-3 w-3" strokeWidth={3} />
              Recibo pago
              {process.completed_at
                ? ` a ${formatDate(process.completed_at)}`
                : ""}
            </p>
          )}

          {open && (
            <button
              type="button"
              onClick={() => onNotIssued(process)}
              className="mt-1 inline-flex h-7 w-full cursor-pointer items-center justify-center rounded-lg text-[11px] font-medium text-[#a0a5ac] transition hover:bg-red-50 hover:text-red-700"
            >
              Cliente não avançou
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================
// MENU (ações menos frequentes)
// ============================================================

function CardMenu({
  process,
  undo,
  onOpen,
  onPatch,
  onDelete,
}: {
  process: TaskRow;
  undo: { label: string; patch: ProcessPatch } | null;
  onOpen: (process: TaskRow) => void;
  onPatch: (process: TaskRow, patch: ProcessPatch) => void;
  onDelete: (process: TaskRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function close() {
    setOpen(false);
    setConfirmDelete(false);
  }

  const itemClass =
    "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs text-[#40464f] transition hover:bg-[#f4f5f7]";

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md p-1 text-[#a0a5ac] transition hover:bg-[#f4f5f7] hover:text-[#40464f]"
        aria-label="Mais ações"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={close} />

          <div className="absolute right-0 top-7 z-20 w-56 overflow-hidden rounded-lg border border-[#e5e8ec] bg-white py-1 shadow-lg">
            <button
              type="button"
              onClick={() => {
                close();
                onOpen(process);
              }}
              className={itemClass}
            >
              <Pencil className="h-3.5 w-3.5" />
              Ver / editar detalhes
            </button>

            {undo && (
              <button
                type="button"
                onClick={() => {
                  close();
                  onPatch(process, undo.patch);
                }}
                className={itemClass}
              >
                <Undo2 className="h-3.5 w-3.5" />
                {undo.label}
              </button>
            )}

            <div className="my-1 border-t border-[#f1f2f4]" />

            {confirmDelete ? (
              <button
                type="button"
                onClick={() => {
                  close();
                  onDelete(process);
                }}
                className="flex w-full cursor-pointer items-center gap-2 bg-red-50 px-3 py-2 text-left text-xs font-semibold text-red-700 transition hover:bg-red-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Confirmar: apagar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs text-red-600 transition hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Apagar processo
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
