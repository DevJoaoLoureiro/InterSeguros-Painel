"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  ClipboardList,
  ReceiptText,
  X,
} from "lucide-react";

import type { ExpiryAlert } from "@/lib/alerts/expiry-alerts";

const alertIcons = {
  renewal: CalendarClock,
  receipt: ReceiptText,
  process: ClipboardList,
};

function daysLeftLabel(daysLeft: number) {
  if (daysLeft <= 0) return "Hoje";
  if (daysLeft === 1) return "Amanhã";
  return `Em ${daysLeft} dias`;
}

function AlertList({
  alerts,
  onNavigate,
}: {
  alerts: ExpiryAlert[];
  onNavigate?: () => void;
}) {
  return (
    <ul className="divide-y divide-[#f1f2f4]">
      {alerts.map((alert) => {
        const Icon = alertIcons[alert.type];

        return (
          <li key={alert.id}>
            <Link
              href={alert.href}
              onClick={onNavigate}
              className="flex items-start gap-3 px-1 py-2.5 transition hover:bg-[#fafbfc]"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#8a9099]" />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[#20242a]">
                  {alert.title}
                </p>
                <p className="truncate text-xs text-[#8a9099]">
                  {alert.subtitle}
                </p>
              </div>

              <span
                className={[
                  "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                  alert.daysLeft <= 1
                    ? "bg-red-50 text-red-700"
                    : "bg-amber-50 text-amber-700",
                ].join(" ")}
              >
                {daysLeftLabel(alert.daysLeft)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function noopSubscribe() {
  return () => {};
}

/*
 * Pop-up que aparece ao entrar no painel, uma vez por dia por
 * utilizador, quando há vencimentos nos próximos 5 dias.
 */
export function ExpiryAlertsPopup({
  alerts,
  userId,
}: {
  alerts: ExpiryAlert[];
  userId: string;
}) {
  const [dismissed, setDismissed] = useState(false);

  const todayKey = new Date().toISOString().slice(0, 10);
  const storageKey = `expiry-alerts-seen:${userId}`;

  // No servidor assume "já visto" para não piscar; no cliente lê o
  // localStorage (sem storage disponível mostra na mesma).
  const seenToday = useSyncExternalStore(
    noopSubscribe,
    () => {
      try {
        return window.localStorage.getItem(storageKey) === todayKey;
      } catch {
        return false;
      }
    },
    () => true,
  );

  const open = alerts.length > 0 && !seenToday && !dismissed;

  function close() {
    setDismissed(true);

    try {
      window.localStorage.setItem(storageKey, todayKey);
    } catch {
      // ignorar
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]">
      <div className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[#edf0f2] px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
              <AlertTriangle className="h-5 w-5" />
            </div>

            <div>
              <h2 className="font-semibold text-[#20242a]">
                {alerts.length} vencimento{alerts.length === 1 ? "" : "s"} nos
                próximos 5 dias
              </h2>
              <p className="mt-0.5 text-xs text-[#8a9099]">
                Renovações, recibos por cobrar e inícios de seguro.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={close}
            className="rounded-lg p-1.5 text-[#a0a5ac] transition hover:bg-[#f4f5f7] hover:text-[#606771]"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-2">
          <AlertList alerts={alerts} onNavigate={close} />
        </div>

        <div className="flex justify-end border-t border-[#edf0f2] px-5 py-3">
          <button
            type="button"
            onClick={close}
            className="h-10 rounded-lg bg-[#ff4b0a] px-4 text-sm font-medium text-white shadow-sm transition hover:bg-[#e64409]"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}

/*
 * Banner fixo no dashboard (cockpit).
 */
export function ExpiryAlertsBanner({ alerts }: { alerts: ExpiryAlert[] }) {
  const [expanded, setExpanded] = useState(false);

  if (alerts.length === 0) return null;

  const visible = expanded ? alerts : alerts.slice(0, 5);

  return (
    <section className="rounded-2xl border border-red-200 bg-white p-4 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-red-600" />
        <h2 className="text-sm font-semibold text-[#20242a]">
          Alertas de vencimento — próximos 5 dias
        </h2>
        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
          {alerts.length}
        </span>
      </div>

      <div className="mt-2">
        <AlertList alerts={visible} />
      </div>

      {alerts.length > 5 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-medium text-[#ff4b0a] hover:underline"
        >
          {expanded ? "Mostrar menos" : `Ver todos (${alerts.length})`}
        </button>
      )}
    </section>
  );
}
