"use client";

import { Fragment, useState, useTransition } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  FileText,
  Loader2,
  Lock,
  X,
} from "lucide-react";

import {
  createTask,
  type InsuranceLineOption,
  type ProcessPatch,
  type ProfileOption,
  type TaskKind,
  type TaskPriority,
  type TaskRow,
} from "@/app/(dashboard)/tarefas/action";

import {
  NOT_ISSUED_REASONS,
  notIssuedReasonLabel,
  type NotIssuedReason,
} from "@/lib/tasks/not-issued";

import { CompanyPicker } from "./simulation-company";
import {
  formatCurrency,
  formatDate,
  isValidDateKey,
  receiptStatusLabel,
  statusLabel,
  toDateInput,
} from "./utils";

export type TaskEditInput = {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  dueAt?: string | null;
  assignedUserId?: string | null;
};

// ============================================================
// PEÇAS PARTILHADAS
// ============================================================

const inputClass =
  "mt-1.5 h-10 w-full rounded-lg border border-[#e4e6e9] bg-white px-3 text-sm outline-none transition focus:border-[#ff4b0a] disabled:bg-[#f7f8f9] disabled:text-[#8a9099]";

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-xs font-medium text-[#7d848e]">{children}</label>
  );
}

function DateInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <input
      type="date"
      min="2000-01-01"
      max="2100-12-31"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={inputClass}
    />
  );
}

function YesNo({
  value,
  onChange,
  yesLabel = "Sim",
  noLabel = "Não",
  disabled = false,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  yesLabel?: string;
  noLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div className="mt-1.5 inline-flex w-full rounded-lg border border-[#e4e6e9] bg-white p-0.5">
      {[
        { v: true, label: yesLabel },
        { v: false, label: noLabel },
      ].map((option) => (
        <button
          key={option.label}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option.v)}
          className={[
            "h-8 flex-1 cursor-pointer rounded-md text-xs font-medium transition disabled:cursor-not-allowed",
            value === option.v
              ? option.v
                ? "bg-green-500 text-white"
                : "bg-[#59616d] text-white"
              : "text-[#59616d] hover:bg-[#f4f5f7]",
          ].join(" ")}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ModalShell({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide = false,
  icon,
}: {
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  wide?: boolean;
  // Ícone opcional ao lado do título (janelas de um só passo).
  icon?: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`flex max-h-[92dvh] w-full animate-pop-in flex-col rounded-2xl bg-white shadow-2xl ${wide ? "max-w-lg" : "max-w-md"}`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#edf0f2] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {icon && (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#ff6a2b] to-[#ea5b0c] text-white shadow-[0_4px_12px_rgba(234,91,12,0.30)]">
                {icon}
              </span>
            )}
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-[#20242a]">{title}</h2>
              {subtitle && (
                <p className="mt-0.5 text-xs text-[#8a9099]">{subtitle}</p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#a0a5ac] transition hover:bg-[#f4f5f7] hover:text-[#606771]"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3.5 overflow-y-auto px-5 py-4">{children}</div>

        <div className="flex justify-end gap-2 border-t border-[#edf0f2] px-5 py-3.5">
          {footer}
        </div>
      </div>
    </div>
  );
}

export function SecondaryButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-10 rounded-lg px-4 text-sm font-medium text-[#606771] transition hover:bg-[#f4f5f7]"
    >
      {children}
    </button>
  );
}

function PrimaryButton({
  onClick,
  pending = false,
  children,
}: {
  onClick: () => void;
  pending?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#ff4b0a] px-4 text-sm font-medium text-white shadow-sm transition hover:bg-[#e64409] disabled:opacity-50"
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

function PriorityField({
  value,
  onChange,
  disabled,
}: {
  value: TaskPriority;
  onChange: (value: TaskPriority) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <Label>Prioridade</Label>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as TaskPriority)}
        className={inputClass}
      >
        <option value="LOW">Baixa</option>
        <option value="MEDIUM">Média</option>
        <option value="HIGH">Alta</option>
      </select>
    </div>
  );
}

function AssigneeField({
  profiles,
  value,
  onChange,
}: {
  profiles: ProfileOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label>Responsável</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      >
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.full_name}
          </option>
        ))}
      </select>
    </div>
  );
}

function LineField({
  insuranceLines,
  value,
  onChange,
  disabled,
}: {
  insuranceLines: InsuranceLineOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <Label>Tipo de seguro</Label>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      >
        <option value="">—</option>
        {insuranceLines.map((line) => (
          <option key={line.id} value={line.id}>
            {line.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// ============================================================
// CRIAR
// ============================================================

export function CreateTaskModal({
  profiles,
  insuranceLines,
  privileged,
  currentProfileId,
  initialKind,
  onCreated,
  onClose,
}: {
  profiles: ProfileOption[];
  insuranceLines: InsuranceLineOption[];
  privileged: boolean;
  currentProfileId: string;
  // Cada página cria o seu tipo: Tarefas → TASK, Processos → PROCESS.
  initialKind: TaskKind;
  onCreated: (kind: TaskKind) => void;
  onClose: () => void;
}) {
  const kind = initialKind;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [dueAt, setDueAt] = useState("");
  const [assignedUserId, setAssignedUserId] = useState(
    profiles.some((p) => p.id === currentProfileId)
      ? currentProfileId
      : profiles[0]?.id ?? "",
  );

  const [clientName, setClientName] = useState("");
  const [clientNif, setClientNif] = useState("");
  const [insuranceLineId, setInsuranceLineId] = useState("");
  const [policyStartDate, setPolicyStartDate] = useState("");
  const [isNewPolicy, setIsNewPolicy] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isProcess = kind === "PROCESS";

  function handleSubmit() {
    if (isProcess && !clientName.trim()) {
      setError("O nome do cliente é obrigatório.");
      return;
    }

    if (!isProcess && !title.trim()) {
      setError("O título é obrigatório.");
      return;
    }

    const date = isProcess ? policyStartDate : dueAt;

    if (date && !isValidDateKey(date)) {
      setError("Data inválida. Confirma o ano.");
      return;
    }

    setError(null);

    startTransition(async () => {
      try {
        await createTask({
          kind,
          title,
          description: description || null,
          priority,
          dueAt: dueAt || null,
          assignedUserId: privileged ? assignedUserId || null : null,
          process: isProcess
            ? {
                clientName,
                clientNif: clientNif || null,
                insuranceLineId: insuranceLineId || null,
                policyStartDate: policyStartDate || null,
                isNewPolicy,
              }
            : undefined,
        });

        onCreated(kind);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao criar tarefa.");
      }
    });
  }

  return (
    <ModalShell
      title={isProcess ? "Novo processo" : "Nova tarefa"}
      subtitle={
        isProcess
          ? "Simulação ou renegociação — fecha quando o recibo for pago."
          : "Um lembrete ou follow-up, para ti ou para a equipa."
      }
      onClose={onClose}
      footer={
        <>
          <SecondaryButton onClick={onClose}>Cancelar</SecondaryButton>
          <PrimaryButton onClick={handleSubmit} pending={isPending}>
            {isProcess ? "Criar processo" : "Criar tarefa"}
          </PrimaryButton>
        </>
      }
    >
      {isProcess && (
        <>
          <div>
            <Label>Nome do cliente</Label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              autoFocus
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>NIF</Label>
              <input
                type="text"
                inputMode="numeric"
                value={clientNif}
                onChange={(e) => setClientNif(e.target.value)}
                className={inputClass}
                placeholder="9 dígitos"
              />
            </div>

            <LineField
              insuranceLines={insuranceLines}
              value={insuranceLineId}
              onChange={setInsuranceLineId}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Data início do seguro</Label>
              <DateInput value={policyStartDate} onChange={setPolicyStartDate} />
            </div>

            <div>
              <Label>Apólice nova?</Label>
              <YesNo
                value={isNewPolicy}
                onChange={setIsNewPolicy}
                noLabel="Não (reneg.)"
              />
            </div>
          </div>

          <p className="rounded-lg bg-[#fafbfc] px-3 py-2 text-[11px] text-[#8a9099]">
            A data de início fica como lembrete e entra nos alertas de 5
            dias. Com o NIF, o recibo da companhia liga-se sozinho quando
            chegar.
          </p>
        </>
      )}

      <div>
        <Label>{isProcess ? "Título (opcional)" : "Título"}</Label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus={!isProcess}
          className={inputClass}
          placeholder={
            isProcess
              ? "Gerado a partir do cliente se vazio"
              : "Ex: Ligar ao cliente sobre renovação"
          }
        />
      </div>

      <div>
        <Label>Descrição (opcional)</Label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="mt-1.5 w-full rounded-lg border border-[#e4e6e9] px-3 py-2 text-sm outline-none transition focus:border-[#ff4b0a]"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <PriorityField value={priority} onChange={setPriority} />

        {!isProcess && (
          <div>
            <Label>Prazo (opcional)</Label>
            <DateInput value={dueAt} onChange={setDueAt} />
          </div>
        )}
      </div>

      {privileged && (
        <AssigneeField
          profiles={profiles}
          value={assignedUserId}
          onChange={setAssignedUserId}
        />
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </ModalShell>
  );
}

// ============================================================
// EDITAR TAREFA
// ============================================================

export function EditTaskModal({
  task,
  profiles,
  privileged,
  canModify,
  onSave,
  onClose,
}: {
  task: TaskRow;
  profiles: ProfileOption[];
  privileged: boolean;
  canModify: boolean;
  onSave: (input: TaskEditInput) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [dueAt, setDueAt] = useState(toDateInput(task.due_at));
  const [assignedUserId, setAssignedUserId] = useState(
    task.assigned_user_id ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    if (!title.trim()) {
      setError("O título é obrigatório.");
      return;
    }

    if (dueAt && !isValidDateKey(dueAt)) {
      setError("Data inválida. Confirma o ano.");
      return;
    }

    onSave({
      title,
      description: description || null,
      priority,
      dueAt: dueAt || null,
      assignedUserId: privileged ? assignedUserId || null : undefined,
    });
    onClose();
  }

  return (
    <ModalShell
      title={canModify ? "Editar tarefa" : task.title}
      subtitle={`${statusLabel[task.status]} · criada a ${formatDate(task.created_at)}`}
      onClose={onClose}
      footer={
        <>
          <SecondaryButton onClick={onClose}>
            {canModify ? "Cancelar" : "Fechar"}
          </SecondaryButton>
          {canModify && (
            <PrimaryButton onClick={handleSave}>Guardar</PrimaryButton>
          )}
        </>
      }
    >
      <div>
        <Label>Título</Label>
        <input
          type="text"
          value={title}
          disabled={!canModify}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <Label>Descrição</Label>
        <textarea
          value={description}
          disabled={!canModify}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="mt-1.5 w-full rounded-lg border border-[#e4e6e9] px-3 py-2 text-sm outline-none transition focus:border-[#ff4b0a] disabled:bg-[#f7f8f9]"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <PriorityField
          value={priority}
          onChange={setPriority}
          disabled={!canModify}
        />

        <div>
          <Label>Prazo</Label>
          <DateInput value={dueAt} onChange={setDueAt} disabled={!canModify} />
        </div>
      </div>

      {privileged && (
        <AssigneeField
          profiles={profiles}
          value={assignedUserId}
          onChange={setAssignedUserId}
        />
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </ModalShell>
  );
}

// ============================================================
// PROCESSO
// ============================================================

export const PROCESS_STEPS = [
  { step: 1, label: "Simulação enviada" },
  { step: 2, label: "Apólice emitida" },
  { step: 3, label: "Recibo pago" },
] as const;

/*
 * Linha de progresso dos passos: carregar num passo marca-o (e os
 * anteriores); carregar no último feito desfaz esse passo.
 */
function ProcessStepper({
  progress,
  onStep,
  disabled,
  receiptLocked,
}: {
  progress: number;
  onStep: (step: number) => void;
  disabled: (step: number) => boolean;
  receiptLocked: boolean;
}) {
  return (
    <div>
      <div className="flex items-start">
        {PROCESS_STEPS.map(({ step, label }, index) => {
          const done = progress >= step;
          const current = progress + 1 === step;
          const isDisabled = disabled(step);

          return (
            <Fragment key={step}>
              {index > 0 && (
                <div
                  className={[
                    "mt-[15px] h-0.5 flex-1 rounded-full transition-colors duration-300",
                    progress >= step ? "bg-[#ff4b0a]" : "bg-[#e4e6e9]",
                  ].join(" ")}
                />
              )}

              <button
                type="button"
                onClick={() => onStep(step)}
                disabled={isDisabled}
                title={
                  done && progress === step
                    ? `Desfazer "${label}"`
                    : `Marcar "${label}"`
                }
                className="group flex w-20 shrink-0 cursor-pointer flex-col items-center gap-1.5 disabled:cursor-not-allowed"
              >
                <span
                  className={[
                    "flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold transition duration-200",
                    done
                      ? "border-[#ff4b0a] bg-gradient-to-br from-[#ff6a2b] to-[#ea5b0c] text-white shadow-[0_3px_10px_rgba(234,91,12,0.32)]"
                      : current
                        ? "border-[#ff4b0a] bg-white text-[#ff4b0a] ring-4 ring-[#ff4b0a]/10"
                        : "border-[#dfe2e6] bg-white text-[#a0a5ac]",
                    isDisabled ? "" : "group-hover:scale-110",
                  ].join(" ")}
                >
                  {done ? <Check className="h-4 w-4" strokeWidth={3} /> : step}
                </span>

                <span
                  className={[
                    "text-center text-[11px] leading-tight",
                    done
                      ? "font-semibold text-[#20242a]"
                      : current
                        ? "font-medium text-[#c2410c]"
                        : "text-[#8a9099]",
                  ].join(" ")}
                >
                  {label}
                </span>
              </button>
            </Fragment>
          );
        })}
      </div>

      <p className="mt-3 text-center text-[11px] text-[#a0a5ac]">
        {receiptLocked
          ? "O recibo vem do webservice da companhia e fecha o processo sozinho."
          : "Carrega num passo para o marcar. Carregar no último desfaz."}
      </p>
    </div>
  );
}

export function ProcessModal({
  task,
  lineName,
  insuranceLines,
  profiles,
  companyOptions = [],
  privileged,
  canModify,
  onSave,
  onNotIssued,
  onClose,
}: {
  task: TaskRow;
  lineName: string | null;
  insuranceLines: InsuranceLineOption[];
  profiles: ProfileOption[];
  // Companhias para "Que companhia simulou?".
  companyOptions: string[];
  privileged: boolean;
  canModify: boolean;
  onSave: (base: TaskEditInput, process: ProcessPatch) => void;
  // Presente só quando o processo ainda pode ser fechado como
  // "não emitida" (aberto e sem recibo pago).
  onNotIssued?: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [assignedUserId, setAssignedUserId] = useState(
    task.assigned_user_id ?? "",
  );

  const [clientName, setClientName] = useState(task.client_name ?? "");
  const [clientNif, setClientNif] = useState(task.client_nif ?? "");
  const [insuranceLineId, setInsuranceLineId] = useState(
    task.insurance_line_id ?? "",
  );
  const [policyStartDate, setPolicyStartDate] = useState(
    task.policy_start_date ?? "",
  );
  const [isNewPolicy, setIsNewPolicy] = useState(task.is_new_policy !== false);
  const [simulationPresented, setSimulationPresented] = useState(
    task.simulation_presented,
  );
  const [simulationCompany, setSimulationCompany] = useState<string | null>(
    task.simulation_company,
  );
  const [issued, setIssued] = useState(task.issued);
  const [receiptPaid, setReceiptPaid] = useState(task.receipt_paid);

  const [error, setError] = useState<string | null>(null);

  const fromCompany = task.receipt_source === "WEBSERVICE";
  const receipt = task.receipt;

  // Passos como uma linha de progresso: 0 = nada, 3 = recibo pago.
  const progress = receiptPaid ? 3 : issued ? 2 : simulationPresented ? 1 : 0;

  function setProgress(step: number) {
    // Carregar no último passo feito desfaz esse passo.
    const target = step === progress ? step - 1 : step;

    setSimulationPresented(target >= 1);
    setIssued(target >= 2);
    if (!fromCompany) setReceiptPaid(target >= 3);
  }

  function stepDisabled(step: number) {
    if (!canModify) return true;
    // O recibo do webservice manda: nada abaixo dele se mexe.
    if (fromCompany && receiptPaid) return true;
    return fromCompany && step === 3;
  }

  function handleSave() {
    if (!clientName.trim()) {
      setError("O nome do cliente é obrigatório.");
      return;
    }

    if (!title.trim()) {
      setError("O título é obrigatório.");
      return;
    }

    if (policyStartDate && !isValidDateKey(policyStartDate)) {
      setError("Data de início inválida. Confirma o ano.");
      return;
    }

    const processPatch: ProcessPatch = {
      clientName,
      clientNif: clientNif || null,
      insuranceLineId: insuranceLineId || null,
      policyStartDate: policyStartDate || null,
      isNewPolicy,
      simulationPresented,
      issued,
    };

    // Só envia a companhia se mudou (a coluna pode ainda não existir).
    if ((simulationCompany ?? null) !== (task.simulation_company ?? null)) {
      processPatch.simulationCompany = simulationCompany;
    }

    if (!fromCompany && receiptPaid !== task.receipt_paid) {
      processPatch.receiptPaid = receiptPaid;
    }

    onSave(
      {
        title,
        description: description || null,
        priority,
        assignedUserId: privileged ? assignedUserId || null : undefined,
      },
      processPatch,
    );
    onClose();
  }

  return (
    <ModalShell
      wide
      title={task.client_name || task.title}
      subtitle={
        <>
          {task.is_new_policy === false ? "Renegociação" : "Apólice nova"}
          {task.status === "CANCELLED" ? " · Não avançou" : ""} · criado a{" "}
          {formatDate(task.created_at)}
          {lineName ? ` · ${lineName}` : ""}
          {task.status === "COMPLETED" && task.completed_at
            ? ` · fechado a ${formatDate(task.completed_at)}`
            : ""}
        </>
      }
      onClose={onClose}
      footer={
        <>
          {canModify && onNotIssued && (
            <button
              type="button"
              onClick={onNotIssued}
              className="mr-auto h-10 rounded-lg px-3 text-sm font-medium text-red-600 transition hover:bg-red-50"
            >
              Cliente não avançou…
            </button>
          )}
          <SecondaryButton onClick={onClose}>
            {canModify ? "Cancelar" : "Fechar"}
          </SecondaryButton>
          {canModify && (
            <PrimaryButton onClick={handleSave}>Guardar</PrimaryButton>
          )}
        </>
      }
    >
      {task.status === "CANCELLED" && (
        <div className="rounded-xl border border-red-100 bg-red-50/60 p-3">
          <p className="text-xs font-semibold text-red-700">
            Não avançou
            {task.not_issued_at
              ? ` · ${formatDate(task.not_issued_at)}`
              : ""}
          </p>
          <p className="mt-1 text-sm text-[#40464f]">
            {notIssuedReasonLabel(task.not_issued_reason) ??
              "Sem motivo registado."}
          </p>
          {task.not_issued_note && (
            <p className="mt-1 text-xs text-[#737a84]">
              {task.not_issued_note}
            </p>
          )}
        </div>
      )}

      {/* PASSOS */}

      <div className="rounded-2xl border border-[#edf0f2] bg-gradient-to-b from-[#fafbfc] to-white p-4">
        <ProcessStepper
          progress={progress}
          onStep={setProgress}
          disabled={stepDisabled}
          receiptLocked={fromCompany}
        />

        {simulationPresented && (
          <div className="mt-4 animate-fade-up border-t border-[#edf0f2] pt-3.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <Label>Companhia que simulou</Label>
              {simulationCompany && canModify && (
                <button
                  type="button"
                  onClick={() => setSimulationCompany(null)}
                  className="cursor-pointer text-[11px] font-medium text-[#8a9099] transition hover:text-[#ff4b0a]"
                >
                  Limpar
                </button>
              )}
            </div>

            <CompanyPicker
              compact
              options={companyOptions}
              value={simulationCompany}
              onChange={setSimulationCompany}
              disabled={!canModify}
            />
          </div>
        )}
      </div>

      {/* CLIENTE */}

      <div>
        <Label>Nome do cliente</Label>
        <input
          type="text"
          value={clientName}
          disabled={!canModify}
          onChange={(e) => setClientName(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>NIF</Label>
          <input
            type="text"
            inputMode="numeric"
            value={clientNif}
            disabled={!canModify}
            onChange={(e) => setClientNif(e.target.value)}
            className={inputClass}
          />
        </div>

        <LineField
          insuranceLines={insuranceLines}
          value={insuranceLineId}
          onChange={setInsuranceLineId}
          disabled={!canModify}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Data início do seguro</Label>
          <DateInput
            value={policyStartDate}
            onChange={setPolicyStartDate}
            disabled={!canModify}
          />
        </div>

        <div>
          <Label>Apólice nova?</Label>
          <YesNo
            value={isNewPolicy}
            onChange={setIsNewPolicy}
            noLabel="Não (reneg.)"
            disabled={!canModify}
          />
        </div>
      </div>

      {/* RECIBO */}

      <div className="rounded-xl border border-[#edf0f2] p-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-[#8a9099]" />
          <p className="text-xs font-semibold text-[#40464f]">Recibo</p>

          {task.receipt_source && (
            <span
              className={[
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                fromCompany
                  ? "bg-blue-50 text-blue-700"
                  : "bg-amber-50 text-amber-700",
              ].join(" ")}
            >
              {fromCompany && <Lock className="h-2.5 w-2.5" />}
              {fromCompany ? "Webservice da companhia" : "Marcado manualmente"}
            </span>
          )}
        </div>

        {receipt ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-[#8a9099]">Nº recibo</dt>
            <dd className="text-[#20242a]">{receipt.receipt_number ?? "—"}</dd>

            <dt className="text-[#8a9099]">Companhia</dt>
            <dd className="text-[#20242a]">{receipt.company_name ?? "—"}</dd>

            <dt className="text-[#8a9099]">Apólice</dt>
            <dd className="text-[#20242a]">{receipt.policy_number ?? "—"}</dd>

            <dt className="text-[#8a9099]">Estado</dt>
            <dd
              className={
                receipt.status === "PAID"
                  ? "font-medium text-green-700"
                  : "font-medium text-amber-700"
              }
            >
              {receiptStatusLabel[receipt.status] ?? receipt.status}
            </dd>

            <dt className="text-[#8a9099]">Período</dt>
            <dd className="text-[#20242a]">
              {receipt.period_start ? formatDate(receipt.period_start) : "—"}
              {receipt.period_end ? ` → ${formatDate(receipt.period_end)}` : ""}
            </dd>

            <dt className="text-[#8a9099]">Vencimento</dt>
            <dd className="text-[#20242a]">
              {receipt.due_date ? formatDate(receipt.due_date) : "—"}
            </dd>

            <dt className="text-[#8a9099]">Prémio total</dt>
            <dd className="text-[#20242a]">
              {formatCurrency(receipt.total_premium)}
            </dd>

            {receipt.payment_date && (
              <>
                <dt className="text-[#8a9099]">Pago em</dt>
                <dd className="text-[#20242a]">
                  {formatDate(receipt.payment_date)}
                </dd>
              </>
            )}
          </dl>
        ) : (
          <p className="mt-2 text-xs text-[#8a9099]">
            {task.client_nif
              ? "Ainda não chegou recibo da companhia para este NIF e data de início. Quando chegar, liga-se sozinho e substitui a marcação manual."
              : "Indica o NIF para o recibo da companhia ser ligado automaticamente."}
          </p>
        )}
      </div>

      {/* DADOS DA TAREFA */}

      <div className="space-y-3.5 border-t border-[#edf0f2] pt-3.5">
        <div>
          <Label>Notas</Label>
          <textarea
            value={description}
            disabled={!canModify}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Ex.: prefere ser contactado por WhatsApp ao fim do dia"
            className="mt-1.5 w-full rounded-lg border border-[#e4e6e9] px-3 py-2 text-sm outline-none transition focus:border-[#ff4b0a] disabled:bg-[#f7f8f9]"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <PriorityField
            value={priority}
            onChange={setPriority}
            disabled={!canModify}
          />

          {privileged && (
            <AssigneeField
              profiles={profiles}
              value={assignedUserId}
              onChange={setAssignedUserId}
            />
          )}
        </div>

        {/* O título é gerado ao criar; quase nunca é preciso mexer. */}
        <details className="group rounded-lg">
          <summary className="cursor-pointer list-none text-[11px] font-medium text-[#8a9099] transition hover:text-[#40464f]">
            <span className="group-open:hidden">Mostrar título interno</span>
            <span className="hidden group-open:inline">Esconder título interno</span>
          </summary>
          <input
            type="text"
            value={title}
            disabled={!canModify}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
          />
        </details>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </ModalShell>
  );
}

// ============================================================
// NÃO EMITIDA
// ============================================================

export function NotIssuedModal({
  task,
  onConfirm,
  onClose,
}: {
  task: TaskRow;
  onConfirm: (reason: NotIssuedReason, note: string | null) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<NotIssuedReason | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleConfirm() {
    if (!reason) {
      setError("Escolhe o motivo.");
      return;
    }

    if (reason === "OTHER" && !note.trim()) {
      setError("Descreve o motivo.");
      return;
    }

    onConfirm(reason, note.trim() || null);
    onClose();
  }

  return (
    <ModalShell
      title="Porque é que o cliente não avançou?"
      subtitle={task.client_name ?? task.title}
      onClose={onClose}
      footer={
        <>
          <SecondaryButton onClick={onClose}>Cancelar</SecondaryButton>
          <PrimaryButton onClick={handleConfirm}>
            Confirmar
          </PrimaryButton>
        </>
      }
    >
      <div>
        <Label>Motivo</Label>

        <div className="mt-1.5 space-y-1.5">
          {NOT_ISSUED_REASONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={reason === option.value}
              onClick={() => {
                setReason(option.value);
                setError(null);
              }}
              className={[
                "flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition",
                reason === option.value
                  ? "border-[#ff4b0a] bg-[#fff7f3] font-medium text-[#20242a]"
                  : "border-[#e4e6e9] text-[#40464f] hover:bg-[#f7f8f9]",
              ].join(" ")}
            >
              <span
                className={[
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                  reason === option.value
                    ? "border-[#ff4b0a]"
                    : "border-[#c0c4c9]",
                ].join(" ")}
              >
                {reason === option.value && (
                  <span className="h-2 w-2 rounded-full bg-[#ff4b0a]" />
                )}
              </span>
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label>
          {reason === "OTHER" ? "Qual foi o motivo?" : "Nota (opcional)"}
        </Label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Ex.: tinha proposta 80 € mais barata noutra companhia"
          className="mt-1.5 w-full rounded-lg border border-[#e4e6e9] px-3 py-2 text-sm outline-none transition focus:border-[#ff4b0a]"
        />
      </div>

      <p className="rounded-lg bg-[#fafbfc] px-3 py-2 text-[11px] text-[#8a9099]">
        O processo sai do quadro e fica em &quot;Não avançaram&quot;. Podes
        reabri-lo mais tarde.
      </p>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </ModalShell>
  );
}

// ============================================================
// QUE COMPANHIA SIMULOU? (passagem à fase 2)
// ============================================================

/*
 * Janela da passagem à fase 2.
 */
export function SimulationCompanyModal({
  process,
  lineName,
  options,
  onConfirm,
  onClose,
}: {
  process: TaskRow;
  lineName: string | null;
  options: string[];
  // null = avançar sem indicar a companhia.
  onConfirm: (company: string | null) => void;
  onClose: () => void;
}) {
  const [company, setCompany] = useState<string | null>(
    process.simulation_company,
  );

  function confirm(value: string | null) {
    onConfirm(value);
    onClose();
  }

  return (
    <ModalShell
      icon={<Building2 className="h-5 w-5" />}
      title="Que companhia simulou?"
      subtitle={`${process.client_name ?? process.title}${lineName ? ` · ${lineName}` : ""}`}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={() => confirm(null)}
            className="mr-auto h-10 cursor-pointer rounded-lg px-3 text-xs font-medium text-[#8a9099] transition hover:bg-[#f4f5f7] hover:text-[#40464f]"
          >
            Avançar sem companhia
          </button>
          <SecondaryButton onClick={onClose}>Cancelar</SecondaryButton>
          <button
            type="button"
            disabled={!company}
            onClick={() => confirm(company)}
            className="group inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#ff6a2b] to-[#ea5b0c] px-4 text-sm font-semibold text-white shadow-[0_2px_8px_rgba(234,91,12,0.28)] transition hover:shadow-[0_4px_14px_rgba(234,91,12,0.38)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            Confirmar
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
        </>
      }
    >
      <p className="text-sm text-[#59616d]">
        O processo passa para{" "}
        <strong className="font-semibold text-blue-700">
          À espera do cliente
        </strong>
        . Indica a companhia da proposta enviada.
      </p>

      <CompanyPicker
        options={options}
        value={company}
        onChange={setCompany}
        autoFocus
        onSubmit={(value) => confirm(value)}
      />
    </ModalShell>
  );
}
