"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Briefcase,
  CalendarClock,
  CalendarRange,
  ChevronRight,
  ClipboardList,
  Coffee,
  ReceiptText,
} from "lucide-react";

import type { TaskRow } from "@/app/(dashboard)/tarefas/action";
import type { WeekEvent, WeekEventKind } from "@/lib/today/get-today";

/*
 * "A minha semana": os próximos 7 dias (hoje incluído), com o que
 * acontece em cada um — recibos a vencer, renovações, inícios de
 * seguro dos meus processos e tarefas com prazo. Carregar num dia
 * mostra a lista desse dia.
 */

const KIND: Record<
  WeekEventKind,
  {
    icon: typeof Briefcase;
    one: string;
    many: string;
    tone: string;
    dot: string;
  }
> = {
  process: {
    icon: Briefcase,
    one: "início de seguro",
    many: "inícios de seguro",
    tone: "bg-orange-50 text-[#ea5b0c]",
    dot: "bg-[#ff5a1f]",
  },
  renewal: {
    icon: CalendarClock,
    one: "renovação",
    many: "renovações",
    tone: "bg-violet-50 text-violet-700",
    dot: "bg-violet-500",
  },
  receipt: {
    icon: ReceiptText,
    one: "recibo",
    many: "recibos",
    tone: "bg-amber-50 text-amber-700",
    dot: "bg-amber-400",
  },
  task: {
    icon: ClipboardList,
    one: "tarefa",
    many: "tarefas",
    tone: "bg-slate-100 text-slate-600",
    dot: "bg-slate-400",
  },
};

const KIND_ORDER: WeekEventKind[] = ["process", "renewal", "receipt", "task"];

// Os dias são chaves YYYY-MM-DD; formatadas ao meio-dia UTC para o
// fuso não mudar o dia (servidor e browser dão o mesmo resultado).
function dayDate(key: string) {
  return new Date(`${key}T12:00:00Z`);
}

function addDays(key: string, days: number) {
  const date = dayDate(key);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const weekdayFormat = new Intl.DateTimeFormat("pt-PT", {
  weekday: "short",
  timeZone: "UTC",
});

const longFormat = new Intl.DateTimeFormat("pt-PT", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

function count(n: number, kind: WeekEventKind) {
  return `${n} ${n === 1 ? KIND[kind].one : KIND[kind].many}`;
}

type DayEvent = WeekEvent | (Omit<WeekEvent, "href"> & { process: TaskRow });

export function WeekStrip({
  todayKey,
  events,
  processes,
  lineName,
  onOpenProcess,
}: {
  todayKey: string;
  events: WeekEvent[];
  // Os meus processos em curso (os inícios de seguro vêm daqui).
  processes: TaskRow[];
  lineName: (process: TaskRow) => string | null;
  onOpenProcess: (process: TaskRow) => void;
}) {
  const [selected, setSelected] = useState(todayKey);

  const days = Array.from({ length: 7 }, (_, i) => addDays(todayKey, i));
  const lastDay = days[days.length - 1];

  const processEvents: DayEvent[] = processes
    .filter(
      (p) =>
        p.policy_start_date &&
        p.policy_start_date.slice(0, 10) >= todayKey &&
        p.policy_start_date.slice(0, 10) <= lastDay,
    )
    .map((p) => {
      const line = lineName(p);
      return {
        id: `process-${p.id}`,
        date: (p.policy_start_date as string).slice(0, 10),
        kind: "process" as const,
        title: p.client_name || p.title,
        detail: `Início do seguro${line ? ` · ${line}` : ""} — processo ainda por fechar`,
        process: p,
      };
    });

  const all: DayEvent[] = [...processEvents, ...events];

  const byDay = new Map<string, DayEvent[]>();
  for (const day of days) byDay.set(day, []);
  for (const event of all) byDay.get(event.date)?.push(event);

  const busiest = Math.max(1, ...days.map((d) => byDay.get(d)?.length ?? 0));

  const weekTotals = KIND_ORDER.map((kind) => ({
    kind,
    n: all.filter((e) => e.kind === kind).length,
  })).filter((t) => t.n > 0);

  const selectedEvents = (byDay.get(selected) ?? []).sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
      {/* CABEÇALHO */}

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#f1f2f4] px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <CalendarRange className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-[#20242a]">
              A minha semana
            </h2>
            <p className="text-[11px] text-[#8a9099]">
              {weekTotals.length === 0
                ? "Semana tranquila — nada marcado nos próximos 7 dias."
                : weekTotals.map((t) => count(t.n, t.kind)).join(" · ")}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-[10px] text-[#8a9099]">
          {KIND_ORDER.map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1">
              <span className={`h-1.5 w-1.5 rounded-full ${KIND[kind].dot}`} />
              {KIND[kind].many.charAt(0).toUpperCase() + KIND[kind].many.slice(1)}
            </span>
          ))}
        </div>
      </div>

      {/* OS 7 DIAS */}

      <div className="grid grid-cols-7 gap-1.5 px-3 py-3 sm:gap-2 sm:px-4">
        {days.map((day, index) => {
          const dayEvents = byDay.get(day) ?? [];
          const total = dayEvents.length;
          const isSelected = day === selected;
          const date = dayDate(day);
          const weekday = weekdayFormat.format(date).replace(".", "");

          return (
            <button
              key={day}
              type="button"
              onClick={() => setSelected(day)}
              aria-pressed={isSelected}
              className={[
                "group flex min-w-0 cursor-pointer flex-col items-center rounded-xl border px-1 pb-2 pt-1.5 transition",
                isSelected
                  ? "border-[#ff4b0a] bg-[#fff7f3] shadow-[0_0_0_3px_rgba(255,75,10,0.10)]"
                  : "border-[#eceef1] bg-white hover:-translate-y-0.5 hover:border-[#ffb899]",
              ].join(" ")}
            >
              <span
                className={[
                  "text-[10px] font-medium uppercase tracking-wide",
                  index === 0 ? "text-[#ff4b0a]" : "text-[#8a9099]",
                ].join(" ")}
              >
                {index === 0 ? "Hoje" : weekday}
              </span>

              <span
                className={[
                  "mt-0.5 text-lg font-semibold leading-none tabular-nums",
                  isSelected ? "text-[#20242a]" : "text-[#40464f]",
                ].join(" ")}
              >
                {date.getUTCDate()}
              </span>

              {/* Barra de "carga" do dia, por tipo */}
              <span className="mt-2 flex h-8 w-2.5 flex-col-reverse overflow-hidden rounded-full bg-[#f1f2f4] sm:w-3">
                {KIND_ORDER.map((kind) => {
                  const n = dayEvents.filter((e) => e.kind === kind).length;
                  if (n === 0) return null;
                  return (
                    <span
                      key={kind}
                      className={KIND[kind].dot}
                      style={{ height: `${(n / busiest) * 100}%` }}
                    />
                  );
                })}
              </span>

              <span
                className={[
                  "mt-1.5 text-[11px] font-semibold tabular-nums",
                  total === 0 ? "text-[#c0c4c9]" : "text-[#40464f]",
                ].join(" ")}
              >
                {total === 0 ? "—" : total}
              </span>
            </button>
          );
        })}
      </div>

      {/* O DIA ESCOLHIDO */}

      <div className="border-t border-[#f1f2f4]">
        <p className="px-4 pt-3 text-xs font-semibold text-[#40464f]">
          {selected === todayKey
            ? "Hoje"
            : longFormat.format(dayDate(selected)).replace(/^\w/, (c) => c.toUpperCase())}
          {selectedEvents.length > 0 && (
            <span className="ml-1.5 font-normal text-[#a0a5ac]">
              {selectedEvents.length}{" "}
              {selectedEvents.length === 1 ? "coisa" : "coisas"}
            </span>
          )}
        </p>

        {selectedEvents.length === 0 ? (
          <div className="flex items-center gap-2.5 px-4 pb-4 pt-2 text-xs text-[#8a9099]">
            <Coffee className="h-4 w-4 text-[#c0c4c9]" />
            Dia livre — nada marcado.
          </div>
        ) : (
          <ul className="max-h-72 divide-y divide-[#f1f2f4] overflow-y-auto pb-1">
            {selectedEvents.map((event) => (
              <WeekRow
                key={event.id}
                event={event}
                onOpenProcess={onOpenProcess}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function WeekRow({
  event,
  onOpenProcess,
}: {
  event: DayEvent;
  onOpenProcess: (process: TaskRow) => void;
}) {
  const style = KIND[event.kind];
  const Icon = style.icon;

  const content = (
    <>
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${style.tone}`}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-[#20242a]">
          {event.title}
        </span>
        <span className="block truncate text-[11px] text-[#8a9099]">
          {event.detail}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-[#c0c4c9] transition group-hover:translate-x-0.5 group-hover:text-[#ff4b0a]" />
    </>
  );

  const className =
    "group flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left transition hover:bg-[#fffaf7]";

  return (
    <li>
      {"process" in event ? (
        <button
          type="button"
          onClick={() => onOpenProcess(event.process)}
          className={className}
        >
          {content}
        </button>
      ) : (
        <Link href={event.href} className={className}>
          {content}
        </Link>
      )}
    </li>
  );
}
