"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Copy,
  Lightbulb,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";

import {
  createProcessFromAdvice,
  dismissClientAdvice,
  getClientAiAdvice,
  type ClientAiAdviceResult,
} from "@/app/(dashboard)/clientes/client-advice-action";
import type {
  AdviceCategory,
  ClientAdvice,
} from "@/lib/opportunities/client-advice";

const CATEGORY_LABEL: Record<AdviceCategory, string> = {
  collection: "Cobrança",
  retention: "Renovação",
  recovery: "Recuperar",
  cross_sell: "Oportunidade",
  data: "Dados",
};

const PRIORITY_DOT = {
  high: "bg-red-500",
  medium: "bg-amber-400",
  low: "bg-[#c0c4c9]",
};

export type AdviceNavigation =
  | { type: "policy"; policyId: string }
  | { type: "receipts"; policyId: string | null }
  | { type: "client_data" };

export function ClientAdviceBulb({
  clientId,
  clientName,
  clientNif,
  clientPhone,
  advice,
  loading,
  onNavigate,
}: {
  clientId: string | null;
  clientName: string;
  clientNif: string | null;
  // Só para o link de WhatsApp (não vai para a IA).
  clientPhone: string | null;
  advice: ClientAdvice[] | null;
  loading: boolean;
  onNavigate: (target: AdviceNavigation) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [created, setCreated] = useState<Set<string>>(new Set());

  const [ai, setAi] = useState<ClientAiAdviceResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPending, startAi] = useTransition();

  function askAi(refresh = false) {
    if (!clientId) return;

    setAiError(null);

    startAi(async () => {
      try {
        setAi(await getClientAiAdvice(clientId, { refresh }));
      } catch (err) {
        setAiError(
          err instanceof Error ? err.message : "Não foi possível falar com a IA.",
        );
      }
    });
  }

  const rules = (advice ?? []).filter((item) => !hidden.has(item.key));

  // Com análise da IA: primeiro os que ela escolheu, pela ordem dela.
  const aiNotes = new Map(
    (ai?.analysis?.prioridades ?? []).map((p, index) => [p.key, { ...p, index }]),
  );

  const visible = aiNotes.size
    ? [...rules].sort(
        (a, b) =>
          (aiNotes.get(a.key)?.index ?? 99) - (aiNotes.get(b.key)?.index ?? 99),
      )
    : rules;
  const count = visible.length;
  const hasHigh = visible.some((item) => item.priority === "high");

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={loading && !advice}
        title={
          loading
            ? "A preparar conselhos..."
            : count > 0
              ? `${count} conselho${count === 1 ? "" : "s"} para este cliente`
              : "Sem conselhos para este cliente"
        }
        className={[
          "relative inline-flex h-10 w-10 items-center justify-center rounded-xl border transition",
          count > 0
            ? hasHigh
              ? "border-amber-300 bg-amber-50 text-amber-600 shadow-[0_0_0_3px_rgba(251,191,36,0.15)] hover:bg-amber-100"
              : "border-amber-200 bg-amber-50/60 text-amber-600 hover:bg-amber-50"
            : "border-[#e1e4e8] text-[#a0a5ac] hover:bg-[#f4f5f7]",
        ].join(" ")}
        aria-label="Conselhos para este cliente"
        aria-expanded={open}
      >
        {loading && !advice ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Lightbulb className={`h-5 w-5 ${count > 0 ? "fill-amber-200" : ""}`} />
        )}

        {count > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ff4b0a] px-1 text-[10px] font-bold text-white">
            {count}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-20"
            onClick={() => setOpen(false)}
          />

          <div className="absolute right-0 top-12 z-30 flex max-h-[75dvh] w-[min(460px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#edf0f2] px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-[#20242a]">
                <Lightbulb className="h-4 w-4 fill-amber-200 text-amber-600" />
                Conselhos para este cliente
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-[#a0a5ac] transition hover:bg-[#f4f5f7] hover:text-[#606771]"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-y-auto">
              {count > 0 && (
                <AiSection
                  result={ai}
                  error={aiError}
                  pending={aiPending}
                  clientPhone={clientPhone}
                  onAsk={() => askAi(false)}
                  onRefresh={() => askAi(true)}
                />
              )}

              {count === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-[#8a9099]">
                  Sem conselhos para já — está tudo em ordem com este
                  cliente.
                </p>
              ) : (
                <ul className="divide-y divide-[#f1f2f4]">
                  {visible.map((item) => (
                    <AdviceItem
                      key={item.key}
                      item={item}
                      aiNote={aiNotes.get(item.key) ?? null}
                      clientId={clientId}
                      clientName={clientName}
                      clientNif={clientNif}
                      created={created.has(item.key)}
                      onCreated={() =>
                        setCreated((prev) => new Set(prev).add(item.key))
                      }
                      onDismissed={() =>
                        setHidden((prev) => new Set(prev).add(item.key))
                      }
                      onUndoDismiss={() =>
                        setHidden((prev) => {
                          const next = new Set(prev);
                          next.delete(item.key);
                          return next;
                        })
                      }
                      onNavigate={(target) => {
                        setOpen(false);
                        onNavigate(target);
                      }}
                    />
                  ))}
                </ul>
              )}
            </div>

            <p className="border-t border-[#edf0f2] bg-[#fafbfc] px-4 py-2 text-[11px] text-[#a0a5ac]">
              &quot;Não tem connosco&quot; não quer dizer que não tenha — pode
              estar noutro mediador. Pergunta antes de propor.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function AdviceItem({
  item,
  aiNote,
  clientId,
  clientName,
  clientNif,
  created,
  onCreated,
  onDismissed,
  onUndoDismiss,
  onNavigate,
}: {
  item: ClientAdvice;
  aiNote: { porque: string; abordagem: string; index: number } | null;
  clientId: string | null;
  clientName: string;
  clientNif: string | null;
  created: boolean;
  onCreated: () => void;
  onDismissed: () => void;
  onUndoDismiss: () => void;
  onNavigate: (target: AdviceNavigation) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { action } = item;

  function createProcess() {
    setError(null);

    startTransition(async () => {
      try {
        await createProcessFromAdvice({ clientName, clientNif, advice: item });
        onCreated();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao criar processo.");
      }
    });
  }

  function dismiss() {
    if (!clientId) return;

    // Otimista: some logo; volta se o servidor falhar.
    onDismissed();

    startTransition(async () => {
      try {
        await dismissClientAdvice(clientId, item.key);
      } catch (err) {
        onUndoDismiss();
        setError(err instanceof Error ? err.message : "Erro ao dispensar.");
      }
    });
  }

  const primaryClass =
    "inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#ff4b0a] px-3 text-xs font-semibold text-white transition hover:bg-[#e64409] disabled:opacity-50";
  const secondaryClass =
    "inline-flex h-8 items-center gap-1 rounded-lg border border-[#e4e6e9] px-3 text-xs font-semibold text-[#40464f] transition hover:bg-[#f4f5f7]";

  return (
    <li className="px-4 py-3.5">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[item.priority]}`} />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#a0a5ac]">
          {CATEGORY_LABEL[item.category]}
        </span>
        {aiNote && (
          <span className="inline-flex items-center gap-0.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
            <Sparkles className="h-2.5 w-2.5" />
            Prioridade {aiNote.index + 1}
          </span>
        )}
      </div>

      <p className="mt-1 text-sm font-semibold leading-snug text-[#20242a]">
        {item.title}
      </p>
      {aiNote ? (
        <div className="mt-1.5 space-y-1 rounded-lg bg-violet-50/70 px-2.5 py-2 text-xs leading-relaxed text-violet-950">
          <p>
            <span className="font-semibold">Porquê: </span>
            {aiNote.porque}
          </p>
          <p>
            <span className="font-semibold">Como abordar: </span>
            {aiNote.abordagem}
          </p>
        </div>
      ) : (
        <p className="mt-1 text-xs leading-relaxed text-[#6f7680]">
          {item.reason}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {action.type === "create_process" &&
          (created || item.processAlreadyOpen ? (
            <Link
              href="/processos"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-green-50 px-3 text-xs font-semibold text-green-700 transition hover:bg-green-100"
            >
              <Check className="h-3.5 w-3.5" />
              {created ? "Processo criado" : "Processo já aberto"} · ver
            </Link>
          ) : (
            <button
              type="button"
              onClick={createProcess}
              disabled={pending}
              className={primaryClass}
            >
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              {action.isNewPolicy ? "Criar processo" : "Criar renegociação"}
            </button>
          ))}

        {action.type === "open_policy" && (
          <button
            type="button"
            onClick={() => onNavigate({ type: "policy", policyId: action.policyId })}
            className={secondaryClass}
          >
            Ver apólice <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}

        {action.type === "open_receipts" && (
          <button
            type="button"
            onClick={() =>
              onNavigate({ type: "receipts", policyId: action.policyId })
            }
            className={secondaryClass}
          >
            Ver recibos <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}

        {action.type === "open_client_data" && (
          <button
            type="button"
            onClick={() => onNavigate({ type: "client_data" })}
            className={secondaryClass}
          >
            Ver dados do cliente <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}

        <button
          type="button"
          onClick={dismiss}
          disabled={pending || !clientId}
          className="ml-auto text-[11px] font-medium text-[#a0a5ac] transition hover:text-[#40464f]"
          title="Deixa de aparecer a toda a equipa durante 90 dias"
        >
          Dispensar
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </li>
  );
}

// ============================================================
// IA
// ============================================================

/* Número português → link wa.me (9 dígitos começados por 9 → +351). */
function whatsappLink(phone: string | null, message: string) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;

  const international =
    digits.length === 9 && digits.startsWith("9") ? `351${digits}` : digits;

  // Só telemóveis: fixos não têm WhatsApp.
  if (!/^3519\d{8}$/.test(international) && digits.length === 9) return null;

  return `https://wa.me/${international}?text=${encodeURIComponent(message)}`;
}

function formatTime(value: string | null) {
  if (!value) return "";

  return new Intl.DateTimeFormat("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function AiSection({
  result,
  error,
  pending,
  clientPhone,
  onAsk,
  onRefresh,
}: {
  result: ClientAiAdviceResult | null;
  error: string | null;
  pending: boolean;
  clientPhone: string | null;
  onAsk: () => void;
  onRefresh: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const analysis = result?.analysis ?? null;

  async function copy(message: string) {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sem acesso à área de transferência: o texto continua visível.
    }
  }

  return (
    <div className="border-b border-[#edf0f2] bg-gradient-to-b from-violet-50/80 to-white px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-violet-800">
          <Sparkles className="h-3.5 w-3.5" />
          Análise da IA
        </p>

        {analysis && !pending && (
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-600 hover:text-violet-800"
            title="Gerar uma nova análise"
          >
            <RefreshCw className="h-3 w-3" />
            {result?.cached ? `Gerada às ${formatTime(result.generatedAt)} · ` : ""}
            Regenerar
          </button>
        )}
      </div>

      {!analysis && !pending && (
        <>
          <p className="mt-1 text-xs text-[#6f7680]">
            A IA escolhe os conselhos mais importantes, explica porquê,
            sugere como abordar e escreve uma mensagem para o cliente.
          </p>
          <button
            type="button"
            onClick={onAsk}
            className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white transition hover:bg-violet-700"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Pedir conselho à IA
          </button>
        </>
      )}

      {pending && (
        <p className="mt-2 flex items-center gap-2 text-xs text-violet-700">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />A analisar o cliente…
          pode demorar uns segundos.
        </p>
      )}

      {error && !pending && (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      )}

      {analysis && !pending && (
        <div className="mt-2 space-y-2.5">
          {analysis.resumo && (
            <p className="text-xs italic leading-relaxed text-[#40464f]">
              {analysis.resumo}
            </p>
          )}

          {analysis.mensagem && (
            <div className="rounded-xl border border-violet-200 bg-white p-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                Mensagem sugerida
              </p>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[#20242a]">
                {analysis.mensagem}
              </p>

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => copy(analysis.mensagem)}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#e4e6e9] px-2.5 text-[11px] font-semibold text-[#40464f] transition hover:bg-[#f4f5f7]"
                >
                  {copied ? (
                    <Check className="h-3 w-3 text-green-600" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  {copied ? "Copiada" : "Copiar"}
                </button>

                {whatsappLink(clientPhone, analysis.mensagem) && (
                  <a
                    href={whatsappLink(clientPhone, analysis.mensagem)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-7 items-center gap-1 rounded-lg bg-[#25d366] px-2.5 text-[11px] font-semibold text-white transition hover:bg-[#1ebe5b]"
                  >
                    <MessageCircle className="h-3 w-3" />
                    Abrir no WhatsApp
                  </a>
                )}
              </div>
            </div>
          )}

          <p className="text-[10px] text-[#a0a5ac]">
            Revê sempre antes de enviar — a IA pode enganar-se.
          </p>
        </div>
      )}
    </div>
  );
}
