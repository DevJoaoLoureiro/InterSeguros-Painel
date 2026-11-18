"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, Volume2, VolumeX, X } from "lucide-react";

import {
  getAssistantMessages,
  markAssistantMessagesRead,
  type AssistantMessage,
} from "@/lib/assistant/actions";

/*
 * Mensagens do assistente: botão no topo (com contador), caixa de
 * mensagens e avisos no canto do ecrã com som quando chega algo novo.
 *
 * - Verifica de minuto a minuto, só com o separador visível.
 * - Avisa só do que é novo desde a última vez (guardado no browser);
 *   com muitas novas de uma vez, um só aviso-resumo.
 * - Som gerado no browser (sem ficheiro). Os browsers só deixam tocar
 *   depois de a pessoa ter clicado na página pelo menos uma vez.
 */

const POLL_MS = 60_000;
const TOAST_MS = 9_000;
const MAX_TOASTS = 3;
const SOUND_KEY = "assistant-sound";
const SEEN_KEY = "assistant-seen";

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // sem localStorage (modo privado): segue sem guardar
  }
}

let audioContext: AudioContext | null = null;

function playChime() {
  try {
    audioContext ??= new AudioContext();
    const ctx = audioContext;
    if (ctx.state === "suspended") void ctx.resume();

    // Dois tons curtos e suaves (sol → dó).
    [784, 1047].forEach((frequency, index) => {
      const start = ctx.currentTime + index * 0.14;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  } catch {
    // sem áudio: o aviso visual chega
  }
}

function timeAgo(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.round(hours / 24)} d`;
}

const SEVERITY_STYLE: Record<AssistantMessage["severity"], string> = {
  high: "border-l-[#e5484d]",
  warning: "border-l-[#ff4b0a]",
  info: "border-l-[#4a6fd1]",
};

type Toast = { key: string; title: string; body: string; href: string | null; ids: string[] };

export function AssistantInbox() {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  // null até a caixa abrir: a preferência vive no browser (não existe
  // no servidor), por isso só se lê quando é precisa.
  const [soundPref, setSoundPref] = useState<boolean | null>(null);
  const soundOn = soundPref ?? true;
  const seenRef = useRef<Set<string> | null>(null);

  const notify = useCallback(
    (fresh: AssistantMessage[]) => {
      if (fresh.length === 0) return;

      const next: Toast[] =
        fresh.length > MAX_TOASTS
          ? [
              {
                key: `summary-${Date.now()}`,
                title: `Tens ${fresh.length} mensagens novas do assistente`,
                body: fresh.some((m) => m.kind === "PREMIUM_INCREASE")
                  ? "Há renovações com subida de prémio para rever."
                  : "Abre a caixa de mensagens para ver.",
                href: null,
                ids: [],
              },
            ]
          : fresh.map((m) => ({ key: m.id, title: m.title, body: m.body, href: m.href, ids: [m.id] }));

      setToasts((current) => [...next, ...current].slice(0, MAX_TOASTS));
      if (readStorage(SOUND_KEY) !== "off") playChime();

      next.forEach((toast) =>
        window.setTimeout(
          () => setToasts((current) => current.filter((t) => t.key !== toast.key)),
          TOAST_MS,
        ),
      );
    },
    [],
  );

  const refresh = useCallback(async () => {
    try {
      const result = await getAssistantMessages();
      setMessages(result.messages);
      setUnread(result.unread);

      // 1.ª carga: o que já foi visto noutras sessões fica guardado no
      // browser; o resto conta como novo.
      if (!seenRef.current) {
        seenRef.current = new Set((readStorage(SEEN_KEY) ?? "").split(",").filter(Boolean));
      }

      const seen = seenRef.current;
      const fresh = result.messages.filter((m) => !m.read && !seen.has(m.id));
      fresh.forEach((m) => seen.add(m.id));
      writeStorage(SEEN_KEY, result.messages.map((m) => m.id).filter((id) => seen.has(id)).join(","));

      notify(fresh);
    } catch {
      // falha pontual (rede, limite do Worker): tenta no próximo ciclo
    }
  }, [notify]);

  useEffect(() => {
    // 1.ª leitura logo a seguir à montagem (fora do corpo do efeito).
    const first = window.setTimeout(() => void refresh(), 0);

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  async function markRead(ids: string[]) {
    if (ids.length === 0) return;
    setMessages((current) => current.map((m) => (ids.includes(m.id) ? { ...m, read: true } : m)));
    setUnread((current) => Math.max(0, current - ids.length));
    try {
      await markAssistantMessagesRead(ids);
    } catch {
      void refresh();
    }
  }

  function toggleSound() {
    const next = !soundOn;
    setSoundPref(next);
    writeStorage(SOUND_KEY, next ? "on" : "off");
    if (next) playChime();
  }

  const unreadIds = messages.filter((m) => !m.read).map((m) => m.id);

  return (
    <>
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            if (soundPref === null) setSoundPref(readStorage(SOUND_KEY) !== "off");
            setOpen((value) => !value);
          }}
          className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-transparent text-[#525963] transition hover:border-[#e4e6e9] hover:bg-white"
          aria-label="Mensagens do assistente"
        >
          <Sparkles className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff4b0a] px-1 text-[9px] font-bold text-white ring-2 ring-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>

        {open && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setOpen(false)}
              aria-label="Fechar mensagens"
            />

            <div className="absolute right-0 top-12 z-50 flex max-h-[70vh] w-[min(24rem,calc(100vw-2rem))] animate-pop-in flex-col overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_20px_50px_rgba(20,22,27,0.18)]">
              <div className="flex items-center justify-between gap-2 border-b border-[#edf0f2] px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-[#20242a]">Assistente</p>
                  <p className="text-xs text-[#8a9099]">
                    {unread > 0 ? `${unread} por ler` : "Tudo lido"}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={toggleSound}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#6b727c] hover:bg-[#f4f5f7]"
                    aria-label={soundOn ? "Desligar som" : "Ligar som"}
                    title={soundOn ? "Desligar som" : "Ligar som"}
                  >
                    {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                  </button>

                  {unreadIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => void markRead(unreadIds)}
                      className="rounded-lg px-2 py-1 text-xs font-medium text-[#ff4b0a] hover:bg-[#fff1eb]"
                    >
                      Marcar tudo como lido
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-y-auto">
                {messages.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-[#8a9099]">
                    Sem mensagens. Quando houver algo a rever, aparece aqui.
                  </p>
                ) : (
                  <ul className="divide-y divide-[#f0f2f4]">
                    {messages.map((message) => (
                      <li
                        key={message.id}
                        className={`border-l-4 px-4 py-3 ${SEVERITY_STYLE[message.severity]} ${
                          message.read ? "bg-white" : "bg-[#fffaf7]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm ${message.read ? "font-medium text-[#3b4048]" : "font-semibold text-[#17191d]"}`}>
                            {message.title}
                          </p>
                          <span className="shrink-0 text-[11px] text-[#a0a6ae]">
                            {timeAgo(message.createdAt)}
                          </span>
                        </div>

                        <p className="mt-1 text-xs leading-5 text-[#5d646e]">{message.body}</p>

                        <div className="mt-2 flex items-center gap-3">
                          {message.href && (
                            <Link
                              href={message.href}
                              onClick={() => {
                                void markRead([message.id]);
                                setOpen(false);
                              }}
                              className="text-xs font-semibold text-[#ff4b0a] hover:underline"
                            >
                              Abrir cliente →
                            </Link>
                          )}
                          {!message.read && (
                            <button
                              type="button"
                              onClick={() => void markRead([message.id])}
                              className="text-xs text-[#8a9099] hover:text-[#3b4048]"
                            >
                              Marcar como lida
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {toasts.length > 0 && (
        <div
          className="fixed bottom-24 right-4 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
          style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          {toasts.map((toast) => (
            <div
              key={toast.key}
              className="animate-pop-in rounded-2xl border border-[#ffd9c7] bg-white p-4 shadow-[0_16px_40px_rgba(20,22,27,0.18)]"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#fff1eb] text-[#ff4b0a]">
                  <Sparkles className="h-4 w-4" />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#17191d]">{toast.title}</p>
                  <p className="mt-1 line-clamp-3 text-xs leading-5 text-[#5d646e]">{toast.body}</p>

                  <div className="mt-2 flex gap-3">
                    {toast.href ? (
                      <Link
                        href={toast.href}
                        onClick={() => {
                          void markRead(toast.ids);
                          setToasts((current) => current.filter((t) => t.key !== toast.key));
                        }}
                        className="text-xs font-semibold text-[#ff4b0a] hover:underline"
                      >
                        Abrir cliente →
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(true);
                          setToasts((current) => current.filter((t) => t.key !== toast.key));
                        }}
                        className="text-xs font-semibold text-[#ff4b0a] hover:underline"
                      >
                        Ver mensagens →
                      </button>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setToasts((current) => current.filter((t) => t.key !== toast.key))}
                  className="text-[#a0a6ae] hover:text-[#3b4048]"
                  aria-label="Fechar aviso"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
