"use client";

import { useMemo, useState, useTransition } from "react";

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
import type {
  MessageLineKind,
  MessageTemplate,
} from "@/lib/tasks/client-message";
import type { NotIssuedReason } from "@/lib/tasks/not-issued";

import { ClientMessageModal } from "./client-message-modal";
import {
  NotIssuedModal,
  ProcessModal,
  SimulationCompanyModal,
  type TaskEditInput,
} from "./task-modals";
import { Toaster, useToasts } from "./toasts";
import {
  applyProcessPatch,
  processStage,
  processStages,
  processStatusFor,
} from "./utils";

/*
 * Estado e ações dos processos, partilhados entre a página Processos
 * (quadro) e "O meu dia" (lista): as mesmas regras, os mesmos ecrãs
 * (detalhe, mensagem ao cliente, "Que companhia simulou?", "Não
 * avançou") e a mesma UI otimista com reversão em erro.
 */

const MIGRATION_WARNING =
  "Passo guardado, mas a companhia não: falta correr a migração 20261106130000_process_simulation_company.sql.";

export function useProcessWorkspace({
  initialProcesses,
  profiles,
  insuranceLines,
  companyNames,
  initialOpenId = null,
}: {
  initialProcesses: TaskRow[];
  profiles: ProfileOption[];
  insuranceLines: InsuranceLineOption[];
  companyNames: string[];
  initialOpenId?: string | null;
}) {
  const [processes, setProcesses] = useState(initialProcesses);
  const [synced, setSynced] = useState(initialProcesses);

  // Depois de cada ação o servidor (revalidatePath) devolve dados
  // novos: substituem o estado otimista local sem recarregar a página.
  if (initialProcesses !== synced) {
    setSynced(initialProcesses);
    setProcesses(initialProcesses);
  }

  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [notIssuedId, setNotIssuedId] = useState<string | null>(null);
  const [messageId, setMessageId] = useState<string | null>(null);
  const [simulatedId, setSimulatedId] = useState<string | null>(null);

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

  // Companhias da lista + as escritas à mão em processos anteriores,
  // as mais usadas primeiro.
  const companyOptions = useMemo(() => {
    const usage = new Map<string, number>();

    for (const name of companyNames) usage.set(name, 0);

    for (const p of processes) {
      const name = p.simulation_company?.trim();
      if (name) usage.set(name, (usage.get(name) ?? 0) + 1);
    }

    return [...usage.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt"))
      .map(([name]) => name);
  }, [companyNames, processes]);

  function lineName(process: TaskRow) {
    return process.insurance_line_id
      ? lineMap.get(process.insurance_line_id) ?? null
      : null;
  }

  function assignedName(process: TaskRow) {
    return process.assigned_user_id
      ? profileMap.get(process.assigned_user_id) ?? null
      : null;
  }

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
      async () => {
        const result = await updateProcess(process.id, patch);
        if (result.companySaved === false) push("error", MIGRATION_WARNING);
      },
      from !== to
        ? to === "DONE"
          ? "Recibo pago — negócio fechado."
          : `Passou para "${processStages.find((s) => s.key === to)?.label}"${
              patch.simulationCompany ? ` · ${patch.simulationCompany}` : ""
            }.`
        : undefined,
    );
  }

  // Fase 1 → 2, depois de responder "Que companhia simulou?".
  function handleSimulated(process: TaskRow, company: string | null) {
    handlePatch(process, {
      simulationPresented: true,
      ...(company ? { simulationCompany: company } : {}),
    });
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
        const result = await updateProcess(process.id, patch);
        if (result.companySaved === false) push("error", MIGRATION_WARNING);
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
      "Guardado em \"Não avançaram\".",
    );
  }

  // Reabrir um processo "não avançou": volta à fase que os passos
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

  return {
    processes,
    companyOptions,
    lineName,
    assignedName,
    profileName: (id: string) => profileMap.get(id) ?? null,
    toasts,
    push,
    dismiss,

    // Abrir os ecrãs
    open: (p: TaskRow) => setOpenId(p.id),
    openMessage: (p: TaskRow) => setMessageId(p.id),
    openSimulated: (p: TaskRow) => setSimulatedId(p.id),
    openNotIssued: (p: TaskRow) => setNotIssuedId(p.id),

    // Ações
    handlePatch,
    handleSimulated,
    handleSave,
    handleNotIssued,
    handleReopen,
    handleDelete,

    // Estado dos ecrãs (para ProcessDialogs)
    dialogs: {
      openId,
      setOpenId,
      notIssuedId,
      setNotIssuedId,
      messageId,
      setMessageId,
      simulatedId,
      setSimulatedId,
    },
  };
}

export type ProcessWorkspace = ReturnType<typeof useProcessWorkspace>;

/* Os ecrãs dos processos + avisos. */
export function ProcessDialogs({
  workspace: ws,
  profiles,
  insuranceLines,
  privileged,
  currentProfileId,
  messageTemplates,
}: {
  workspace: ProcessWorkspace;
  profiles: ProfileOption[];
  insuranceLines: InsuranceLineOption[];
  privileged: boolean;
  currentProfileId: string;
  messageTemplates: Record<MessageLineKind, MessageTemplate>;
}) {
  const { dialogs } = ws;
  const find = (id: string | null) =>
    id ? ws.processes.find((p) => p.id === id) ?? null : null;

  const openProcess = find(dialogs.openId);
  const notIssuedProcess = find(dialogs.notIssuedId);
  const messageProcess = find(dialogs.messageId);
  const simulatedProcess = find(dialogs.simulatedId);

  return (
    <>
      {openProcess && (
        <ProcessModal
          key={openProcess.id}
          task={openProcess}
          lineName={ws.lineName(openProcess)}
          insuranceLines={insuranceLines}
          profiles={profiles}
          companyOptions={ws.companyOptions}
          privileged={privileged}
          canModify
          onSave={(base, patch) => ws.handleSave(openProcess, base, patch)}
          onNotIssued={
            openProcess.status !== "CANCELLED" && !openProcess.receipt_paid
              ? () => {
                  dialogs.setOpenId(null);
                  dialogs.setNotIssuedId(openProcess.id);
                }
              : undefined
          }
          onClose={() => {
            dialogs.setOpenId(null);
            // Tira o ?abrir= do URL, para não reabrir ao atualizar.
            if (window.location.search.includes("abrir=")) {
              window.history.replaceState(null, "", window.location.pathname);
            }
          }}
        />
      )}

      {notIssuedProcess && (
        <NotIssuedModal
          key={notIssuedProcess.id}
          task={notIssuedProcess}
          onConfirm={(reason, note) =>
            ws.handleNotIssued(notIssuedProcess, reason, note)
          }
          onClose={() => dialogs.setNotIssuedId(null)}
        />
      )}

      {messageProcess && (
        <ClientMessageModal
          key={messageProcess.id}
          process={messageProcess}
          lineName={ws.lineName(messageProcess)}
          senderName={
            ws.profileName(messageProcess.assigned_user_id ?? currentProfileId) ??
            ws.profileName(currentProfileId) ??
            ""
          }
          templates={messageTemplates}
          // Enviada a simulação: pergunta logo a companhia.
          onPresented={() => {
            dialogs.setMessageId(null);
            dialogs.setSimulatedId(messageProcess.id);
          }}
          onNotify={ws.push}
          onClose={() => dialogs.setMessageId(null)}
        />
      )}

      {simulatedProcess && (
        <SimulationCompanyModal
          key={simulatedProcess.id}
          process={simulatedProcess}
          lineName={ws.lineName(simulatedProcess)}
          options={ws.companyOptions}
          onConfirm={(company) => ws.handleSimulated(simulatedProcess, company)}
          onClose={() => dialogs.setSimulatedId(null)}
        />
      )}

      <Toaster toasts={ws.toasts} onDismiss={ws.dismiss} />
    </>
  );
}
