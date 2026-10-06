"use client";

import { useState, useTransition } from "react";
import { FileText, Loader2, Lock, X } from "lucide-react";

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

function Label({ children }: { children: React.ReactNode }) {
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

function ModalShell({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  wide?: boolean;
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
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-[#20242a]">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-xs text-[#8a9099]">{subtitle}</p>
            )}
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

function SecondaryButton({
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

export function ProcessModal({
  task,
  lineName,
  insuranceLines,
  profiles,
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
  const [issued, setIssued] = useState(task.issued);
  const [receiptPaid, setReceiptPaid] = useState(task.receipt_paid);

  const [error, setError] = useState<string | null>(null);

  const fromCompany = task.receipt_source === "WEBSERVICE";
  const receipt = task.receipt;

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
      title={task.title}
      subtitle={
        <>
          {task.status === "CANCELLED"
            ? "Não emitida"
            : statusLabel[task.status]}{" "}
          · criado a {formatDate(task.created_at)}
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
              Não emitida…
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
            Não emitida
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

      <div className="rounded-xl border border-[#edf0f2] bg-[#fafbfc] p-3">
        <p className="text-xs font-semibold text-[#40464f]">Passos</p>

        <div className="mt-2 grid grid-cols-3 gap-3">
          <div>
            <Label>Simulação apresentada</Label>
            <YesNo
              value={simulationPresented}
              onChange={setSimulationPresented}
              disabled={!canModify}
            />
          </div>

          <div>
            <Label>Apólice emitida</Label>
            <YesNo
              value={issued || receiptPaid}
              onChange={setIssued}
              disabled={!canModify || receiptPaid}
            />
          </div>

          <div>
            <Label>Recibo pago</Label>
            <YesNo
              value={receiptPaid}
              onChange={setReceiptPaid}
              disabled={!canModify || fromCompany}
            />
          </div>
        </div>

        <p className="mt-2 text-[11px] text-[#a0a5ac]">
          O processo muda de coluna conforme os passos marcados. Com o
          recibo pago fica concluído.
        </p>
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
          <Label>Notas</Label>
          <textarea
            value={description}
            disabled={!canModify}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
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
      title="Não emitida"
      subtitle={`${task.client_name ?? task.title} — porque não avançou?`}
      onClose={onClose}
      footer={
        <>
          <SecondaryButton onClick={onClose}>Cancelar</SecondaryButton>
          <PrimaryButton onClick={handleConfirm}>
            Marcar como não emitida
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
        O processo sai do quadro e fica em &quot;Não emitidas&quot;. Podes
        reabri-lo mais tarde.
      </p>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </ModalShell>
  );
}
