"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  Building2,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  Inbox,
  MessageCircle,
  MessageSquareText,
  MessagesSquare,
  PhoneCall,
  Plus,
  ReceiptText,
  Target,
} from "lucide-react";

import type {
  InsuranceLineOption,
  ProfileOption,
  TaskRow,
} from "@/app/(dashboard)/tarefas/action";
import {
  ProcessDialogs,
  useProcessWorkspace,
  type ProcessWorkspace,
} from "@/components/tarefas/process-workspace";
import { CreateTaskModal } from "@/components/tarefas/task-modals";
import {
  processAttention,
  processStage,
  processStages,
  type ProcessAttention,
  type ProcessStage,
} from "@/components/tarefas/utils";
import type {
  MessageLineKind,
  MessageTemplate,
} from "@/lib/tasks/client-message";
import type {
  TodayItem,
  TodayKind,
  TodaySection,
  WeekEvent,
} from "@/lib/today/get-today";

import { WeekStrip } from "./week-strip";

type Props = {
  greeting: string;
  dateLabel: string;
  firstName: string;
  storeName: string | null;
  items: TodayItem[];
  hidden: { kind: TodayKind; count: number; href: string }[];
  // "A minha semana": hoje (YYYY-MM-DD) e o que há em cada dia.
  todayKey: string;
  week: WeekEvent[];
  // Processos (todos os da equipa vêm do servidor; aqui só os meus).
  initialProcesses: TaskRow[];
  profiles: ProfileOption[];
  insuranceLines: InsuranceLineOption[];
  privileged: boolean;
  currentProfileId: string;
  messageTemplates: Record<MessageLineKind, MessageTemplate>;
  companyNames: string[];
};

// ============================================================
// ESTILOS
// ============================================================

const KIND_STYLE: Record<
  TodayKind,
  { icon: typeof Briefcase; label: string; tone: string }
> = {
  task: { icon: ClipboardList, label: "Tarefa", tone: "bg-slate-100 text-slate-600" },
  receipt: { icon: ReceiptText, label: "Recibo", tone: "bg-amber-50 text-amber-700" },
  renewal: { icon: CalendarClock, label: "Renovação", tone: "bg-violet-50 text-violet-700" },
  lead: { icon: MessageCircle, label: "Lead", tone: "bg-sky-50 text-sky-700" },
  opportunity: { icon: Target, label: "Oportunidade", tone: "bg-emerald-50 text-emerald-700" },
  conversation: { icon: MessagesSquare, label: "WhatsApp", tone: "bg-green-50 text-green-700" },
  partner: { icon: Inbox, label: "Parceiros", tone: "bg-blue-50 text-blue-700" },
};

const HIDDEN_LABEL: Record<TodayKind, [string, string]> = {
  task: ["tarefa", "tarefas"],
  receipt: ["recibo", "recibos"],
  renewal: ["renovação", "renovações"],
  lead: ["lead", "leads"],
  opportunity: ["oportunidade", "oportunidades"],
  conversation: ["conversa", "conversas"],
  partner: ["envio", "envios"],
};

const SECTIONS: {
  key: TodaySection;
  title: string;
  // Nome curto para os contadores de cima.
  short: string;
  hint: string;
  icon: typeof Briefcase;
  accent: string;
  chip: string;
}[] = [
  {
    key: "overdue",
    title: "Atrasado",
    short: "Atrasado",
    hint: "Já passou do prazo — tratar primeiro.",
    icon: AlertTriangle,
    accent: "bg-red-50 text-red-600",
    chip: "bg-red-50 text-red-700",
  },
  {
    key: "today",
    title: "Hoje e próximos dias",
    short: "Hoje",
    hint: "O que vence ou chega agora.",
    icon: CalendarDays,
    accent: "bg-orange-50 text-[#ea5b0c]",
    chip: "bg-amber-50 text-amber-700",
  },
  {
    key: "follow",
    title: "Para dar seguimento",
    short: "Seguimento",
    hint: "Parado há algum tempo — um contacto pode desbloquear.",
    icon: PhoneCall,
    accent: "bg-blue-50 text-blue-600",
    chip: "bg-[#f4f5f7] text-[#59616d]",
  },
];

const ATTENTION_STYLE: Record<
  ProcessAttention["level"],
  { chip: string; bar: string; section: TodaySection }
> = {
  overdue: { chip: "bg-red-50 text-red-700", bar: "before:bg-red-500", section: "overdue" },
  soon: { chip: "bg-amber-50 text-amber-700", bar: "before:bg-amber-400", section: "today" },
  stale: { chip: "bg-blue-50 text-blue-700", bar: "before:bg-blue-400", section: "follow" },
};

type ProcessTab = "ATTENTION" | "ALL" | Exclude<ProcessStage, "DONE">;

const PROCESS_PAGE = 8;

// ============================================================
// PÁGINA
// ============================================================

export function TodayBoard({
  greeting,
  dateLabel,
  firstName,
  storeName,
  items,
  hidden,
  todayKey,
  week,
  initialProcesses,
  profiles,
  insuranceLines,
  privileged,
  currentProfileId,
  messageTemplates,
  companyNames,
}: Props) {
  const ws = useProcessWorkspace({
    initialProcesses,
    profiles,
    insuranceLines,
    companyNames,
  });

  const [creating, setCreating] = useState(false);

  // Os meus processos em curso (os fechados e "não avançou" saem).
  const myProcesses = ws.processes
    .filter(
      (p) =>
        p.assigned_user_id === currentProfileId &&
        p.status !== "CANCELLED" &&
        !p.receipt_paid,
    )
    .map((process) => ({ process, attention: processAttention(process) }));

  // Contadores de cima: lembretes + processos que pedem atenção.
  const counts: Record<TodaySection, number> = {
    overdue: 0,
    today: 0,
    follow: 0,
  };

  for (const item of items) counts[item.section] += 1;
  for (const { attention } of myProcesses) {
    if (attention) counts[ATTENTION_STYLE[attention.level].section] += 1;
  }

  const totalToDo = counts.overdue + counts.today + counts.follow;

  const summary =
    totalToDo === 0
      ? myProcesses.length > 0
        ? `Nada atrasado. Tens ${myProcesses.length} ${myProcesses.length === 1 ? "processo" : "processos"} em curso.`
        : "Não tens nada pendente. Bom trabalho!"
      : [
          counts.overdue > 0 &&
            `${counts.overdue} ${counts.overdue === 1 ? "coisa atrasada" : "coisas atrasadas"}`,
          counts.today > 0 && `${counts.today} para hoje`,
          counts.follow > 0 && `${counts.follow} para dar seguimento`,
        ]
          .filter(Boolean)
          .join(", ")
          .replace(/, ([^,]*)$/, " e $1") + ".";

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* CABEÇALHO */}

      <div className="relative overflow-hidden rounded-2xl border border-[#ece7e2] bg-gradient-to-br from-white via-white to-[#fff4ee] p-5 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-gradient-to-br from-[#ff6a2b]/20 to-transparent blur-2xl"
        />

        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-[#ff4b0a]">{dateLabel}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
              {greeting}
              {firstName ? `, ${firstName}` : ""}
            </h1>
            <p className="mt-1 text-sm text-[#59616d]">
              {totalToDo > 0 ? `Tens ${summary}` : summary}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile
              href="#processos"
              icon={Briefcase}
              label="Processos"
              value={myProcesses.length}
              tone="bg-orange-50 text-[#ea5b0c]"
            />
            {SECTIONS.map((section) => (
              <StatTile
                key={section.key}
                href={`#${section.key}`}
                icon={section.icon}
                label={section.short}
                value={counts[section.key]}
                tone={section.accent}
                alert={section.key === "overdue" && counts.overdue > 0}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        {/* OS MEUS PROCESSOS */}

        <div className="space-y-5">
          <MyProcesses
            ws={ws}
            entries={myProcesses}
            onCreate={() => setCreating(true)}
          />

          {/* A MINHA SEMANA */}

          <WeekStrip
            todayKey={todayKey}
            events={week}
            processes={myProcesses.map((entry) => entry.process)}
            lineName={ws.lineName}
            onOpenProcess={ws.open}
          />
        </div>

        {/* LEMBRETES */}

        <Reminders items={items} hidden={hidden} storeName={storeName} />
      </div>

      {creating && (
        <CreateTaskModal
          profiles={profiles}
          insuranceLines={insuranceLines}
          privileged={privileged}
          currentProfileId={currentProfileId}
          initialKind="PROCESS"
          onCreated={() => ws.push("success", "Processo criado.")}
          onClose={() => setCreating(false)}
        />
      )}

      <ProcessDialogs
        workspace={ws}
        profiles={profiles}
        insuranceLines={insuranceLines}
        privileged={privileged}
        currentProfileId={currentProfileId}
        messageTemplates={messageTemplates}
      />
    </div>
  );
}

function StatTile({
  href,
  icon: Icon,
  label,
  value,
  tone,
  alert = false,
}: {
  href: string;
  icon: typeof Briefcase;
  label: string;
  value: number;
  tone: string;
  alert?: boolean;
}) {
  return (
    <a
      href={href}
      className={[
        "group flex min-w-[118px] items-center gap-2.5 rounded-xl border bg-white px-3 py-2.5 transition hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(20,25,35,0.08)]",
        alert ? "border-red-200" : "border-[#ece7e2] hover:border-[#ffb899]",
        value === 0 ? "opacity-60" : "",
      ].join(" ")}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone}`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-lg font-semibold leading-none tabular-nums text-[#20242a]">
          {value}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-[#8a9099]">
          {label}
        </span>
      </span>
    </a>
  );
}

// ============================================================
// PROCESSOS
// ============================================================

function MyProcesses({
  ws,
  entries,
  onCreate,
}: {
  ws: ProcessWorkspace;
  entries: { process: TaskRow; attention: ProcessAttention | null }[];
  onCreate: () => void;
}) {
  const needAttention = entries.filter((e) => e.attention).length;

  const [tab, setTab] = useState<ProcessTab>(
    needAttention > 0 ? "ATTENTION" : "ALL",
  );
  const [showAll, setShowAll] = useState(false);

  const stageCount = (key: ProcessStage) =>
    entries.filter((e) => processStage(e.process) === key).length;

  const tabs: { key: ProcessTab; label: string; count: number }[] = [
    { key: "ATTENTION", label: "Precisam de atenção", count: needAttention },
    { key: "ALL", label: "Todos", count: entries.length },
    ...processStages
      .filter((s) => s.key !== "DONE")
      .map((s) => ({
        key: s.key as ProcessTab,
        label: s.label,
        count: stageCount(s.key),
      })),
  ];

  const filtered = entries
    .filter((e) =>
      tab === "ATTENTION"
        ? e.attention !== null
        : tab === "ALL"
          ? true
          : processStage(e.process) === tab,
    )
    // Os que pedem atenção primeiro; depois os mais recentes.
    .sort(
      (a, b) =>
        (a.attention?.rank ?? 0) - (b.attention?.rank ?? 0) ||
        b.process.created_at.localeCompare(a.process.created_at),
    );

  const visible = showAll ? filtered : filtered.slice(0, PROCESS_PAGE);

  return (
    <section
      id="processos"
      className="scroll-mt-24 overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[#f1f2f4] px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange-50 text-[#ea5b0c]">
            <Briefcase className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-[#20242a]">
              Os meus processos
              <span className="ml-1.5 text-[#a0a5ac]">{entries.length}</span>
            </h2>
            <p className="text-[11px] text-[#8a9099]">
              Avança cada processo daqui — o botão mostra o próximo passo.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onCreate}
          className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#ff5a1f] to-[#ff4b0a] px-3 text-xs font-semibold text-white shadow-[0_2px_10px_rgba(255,75,10,0.28)] transition hover:shadow-[0_6px_18px_rgba(255,75,10,0.36)] active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Novo processo</span>
        </button>
      </div>

      {entries.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto border-b border-[#f1f2f4] px-4 py-2.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTab(t.key);
                setShowAll(false);
              }}
              aria-pressed={tab === t.key}
              className={[
                "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition",
                tab === t.key
                  ? "bg-[#20242a] text-white"
                  : "text-[#59616d] hover:bg-[#f4f5f7]",
              ].join(" ")}
            >
              {t.label}
              <span
                className={[
                  "rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                  tab === t.key
                    ? "bg-white/20 text-white"
                    : t.key === "ATTENTION" && t.count > 0
                      ? "bg-red-50 text-red-700"
                      : "bg-[#f4f5f7] text-[#7d848e]",
                ].join(" ")}
              >
                {t.count}
              </span>
            </button>
          ))}
        </div>
      )}

      {entries.length === 0 ? (
        <EmptyState
          title="Sem processos em curso"
          text="Quando criares um processo (uma simulação ou renegociação), ele aparece aqui com o próximo passo."
          action={{ label: "Criar processo", onClick: onCreate }}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={tab === "ATTENTION" ? "Nenhum processo parado" : "Nada nesta fase"}
          text={
            tab === "ATTENTION"
              ? "Todos os teus processos estão a andar. Bom trabalho!"
              : "Não tens processos nesta fase neste momento."
          }
        />
      ) : (
        <ul className="divide-y divide-[#f1f2f4]">
          {visible.map(({ process, attention }) => (
            <ProcessRow
              key={process.id}
              process={process}
              attention={attention}
              ws={ws}
            />
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-[#f1f2f4] bg-[#fafbfc] px-4 py-2.5">
        {filtered.length > PROCESS_PAGE ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="cursor-pointer text-xs font-medium text-[#59616d] transition hover:text-[#ff4b0a]"
          >
            {showAll ? "Mostrar menos" : `Ver mais ${filtered.length - PROCESS_PAGE}`}
          </button>
        ) : (
          <span />
        )}

        <Link
          href="/processos"
          className="inline-flex items-center gap-1 text-xs font-medium text-[#59616d] transition hover:text-[#ff4b0a]"
        >
          Abrir quadro de processos
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </section>
  );
}

function ProcessRow({
  process,
  attention,
  ws,
}: {
  process: TaskRow;
  attention: ProcessAttention | null;
  ws: ProcessWorkspace;
}) {
  const stageKey = processStage(process);
  const stageIndex = processStages.findIndex((s) => s.key === stageKey);
  const stage = processStages[stageIndex];
  const lineName = ws.lineName(process);
  const style = attention ? ATTENTION_STYLE[attention.level] : null;

  const waitingCompany =
    stageKey === "ISSUED" && process.receipt_source === "WEBSERVICE";

  return (
    <li
      className={[
        "relative flex flex-col gap-3 px-4 py-3 transition hover:bg-[#fffaf7] sm:flex-row sm:items-center",
        // Barra à esquerda com a cor da urgência.
        style
          ? `before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r-full ${style.bar}`
          : "",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={() => ws.open(process)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
        title="Abrir detalhes"
      >
        {/* Fase: número + progresso */}
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
          <svg viewBox="0 0 36 36" className="absolute inset-0 h-9 w-9 -rotate-90">
            <circle cx="18" cy="18" r="15" fill="none" stroke="#eceef1" strokeWidth="3" />
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              stroke="#ff5a1f"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={`${(stageIndex / 3) * 94.25} 94.25`}
            />
          </svg>
          <span className="text-[11px] font-semibold text-[#40464f]">
            {stageIndex + 1}/3
          </span>
        </span>

        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[#20242a] transition hover:text-[#ff4b0a]">
            {process.client_name || process.title}
          </span>
          <span className="mt-0.5 block truncate text-xs text-[#8a9099]">
            <span className={`font-medium ${stage?.text ?? ""}`}>
              {stage?.label}
            </span>
            {lineName ? ` · ${lineName}` : ""}
            {process.is_new_policy === false ? " · Renegociação" : ""}
          </span>

          {(attention || (process.simulation_company && process.simulation_presented)) && (
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {attention && style && (
                <span
                  className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${style.chip}`}
                >
                  <Clock className="h-3 w-3" />
                  {attention.label}
                </span>
              )}
              {process.simulation_company && process.simulation_presented && (
                <span className="inline-flex max-w-[180px] items-center gap-1 rounded-md bg-[#f4f5f7] px-1.5 py-0.5 text-[11px] font-medium text-[#59616d]">
                  <Building2 className="h-3 w-3 shrink-0" />
                  <span className="truncate">{process.simulation_company}</span>
                </span>
              )}
            </span>
          )}
        </span>
      </button>

      {/* PRÓXIMO PASSO */}

      <div className="flex shrink-0 items-center gap-1.5 pl-12 sm:pl-0">
        {stageKey === "TO_SIMULATE" && (
          <>
            <button
              type="button"
              onClick={() => ws.openSimulated(process)}
              className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-[#e4e6e9] bg-white px-2.5 text-xs font-medium text-[#59616d] transition hover:border-[#ffb899] hover:text-[#c2410c]"
              title="Já enviei a simulação ao cliente"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
              Já enviei
            </button>
            <PrimaryAction
              icon={MessageSquareText}
              label="Enviar simulação"
              onClick={() => ws.openMessage(process)}
            />
          </>
        )}

        {stageKey === "SIMULATED" && (
          <PrimaryAction
            icon={Check}
            label="Cliente aceitou"
            onClick={() => ws.handlePatch(process, { issued: true })}
          />
        )}

        {stageKey === "ISSUED" &&
          (waitingCompany ? (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 text-xs font-medium text-blue-700">
              <Clock className="h-3.5 w-3.5" />
              Fecha sozinho
            </span>
          ) : (
            <PrimaryAction
              icon={Check}
              label="Recibo pago"
              onClick={() => ws.handlePatch(process, { receiptPaid: true })}
            />
          ))}

        <button
          type="button"
          onClick={() => ws.open(process)}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[#a0a5ac] transition hover:bg-[#f4f5f7] hover:text-[#40464f]"
          aria-label="Abrir detalhes"
          title="Detalhes"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

function PrimaryAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Check;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group/next inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#ff6a2b] to-[#ea5b0c] px-3 text-xs font-semibold text-white shadow-[0_2px_8px_rgba(234,91,12,0.28)] transition hover:shadow-[0_4px_14px_rgba(234,91,12,0.38)] active:scale-[0.98]"
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
      {label}
    </button>
  );
}

// ============================================================
// LEMBRETES (tudo o resto)
// ============================================================

function Reminders({
  items,
  hidden,
  storeName,
}: {
  items: TodayItem[];
  hidden: { kind: TodayKind; count: number; href: string }[];
  storeName: string | null;
}) {
  const sections = SECTIONS.map((section) => ({
    ...section,
    items: items.filter((item) => item.section === section.key),
  })).filter((section) => section.items.length > 0);

  return (
    <div className="space-y-4">
      {sections.length === 0 ? (
        <section className="rounded-2xl border border-[#e5e8ec] bg-white">
          <EmptyState
            icon
            title="Sem lembretes"
            text="Recibos, renovações, tarefas, leads e conversas que precisem de ti aparecem aqui."
          />
        </section>
      ) : (
        sections.map((section) => (
          <section
            key={section.key}
            id={section.key}
            className="scroll-mt-24 overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]"
          >
            <div className="flex items-center gap-2.5 border-b border-[#f1f2f4] px-4 py-3">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-xl ${section.accent}`}
              >
                <section.icon className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-[#20242a]">
                  {section.title}
                  <span className="ml-1.5 text-[#a0a5ac]">
                    {section.items.length}
                  </span>
                </h2>
                <p className="text-[11px] text-[#8a9099]">{section.hint}</p>
              </div>
            </div>

            <ul className="divide-y divide-[#f1f2f4]">
              {section.items.map((item) => (
                <ReminderRow key={item.id} item={item} chip={section.chip} />
              ))}
            </ul>
          </section>
        ))
      )}

      {(hidden.length > 0 || storeName) && (
        <div className="flex flex-wrap items-center gap-2 px-1 text-[11px] text-[#8a9099]">
          {hidden.length > 0 && <span>Há mais:</span>}
          {hidden.map((entry) => (
            <Link
              key={entry.kind}
              href={entry.href}
              className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 font-medium text-[#40464f] ring-1 ring-[#e5e8ec] transition hover:text-[#ff4b0a] hover:ring-[#ffb899]"
            >
              +{entry.count} {HIDDEN_LABEL[entry.kind][entry.count === 1 ? 0 : 1]}
              <ArrowRight className="h-3 w-3" />
            </Link>
          ))}
          {storeName && (
            <span className="ml-auto">
              Recibos, renovações e conversas da loja {storeName}.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ReminderRow({ item, chip }: { item: TodayItem; chip: string }) {
  const style = KIND_STYLE[item.kind];
  const Icon = style.icon;

  return (
    <li>
      <Link
        href={item.href}
        className="group flex items-center gap-3 px-4 py-2.5 transition hover:bg-[#fffaf7]"
        title={item.action}
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${style.tone}`}
          title={style.label}
        >
          <Icon className="h-4 w-4" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-[#20242a]">
            {item.title}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-[#8a9099]">
            {style.label} · {item.detail}
          </span>
        </span>

        <span
          className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${chip}`}
        >
          {item.when}
        </span>

        <ChevronRight className="h-4 w-4 shrink-0 text-[#c0c4c9] transition group-hover:translate-x-0.5 group-hover:text-[#ff4b0a]" />
      </Link>
    </li>
  );
}

function EmptyState({
  title,
  text,
  icon = false,
  action,
}: {
  title: string;
  text: string;
  icon?: boolean;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-green-50 text-green-600">
        {icon ? <CheckCircle2 className="h-6 w-6" /> : <Check className="h-6 w-6" />}
      </span>
      <p className="mt-3 text-sm font-semibold text-[#20242a]">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-[#8a9099]">{text}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-[#ffd4c2] bg-[#fff7f3] px-3 text-xs font-semibold text-[#c2410c] transition hover:border-[#ff4b0a]"
        >
          <Plus className="h-4 w-4" />
          {action.label}
        </button>
      )}
    </div>
  );
}
