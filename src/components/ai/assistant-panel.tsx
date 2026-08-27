"use client";

import {
  Bot,
  Loader2,
  MessageCircle,
  RotateCcw,
  Send,
  X,
} from "lucide-react";

import {
  FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  useAssistant,
} from "@/components/ai/assistant-provider";

export default function AssistantPanel() {
  const {
    open,
    setOpen,

    messages,
    setMessages,

    previousResponseId,
    setPreviousResponseId,

    resetConversation,

    pendingMessage,
    clearPendingMessage,
  } = useAssistant();

  const [
    input,
    setInput,
  ] = useState("");

  const [
    loading,
    setLoading,
  ] = useState(false);

  const bottomRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [
    messages,
    loading,
  ]);

    useEffect(() => {
    if (!pendingMessage) {
        return;
    }

    setInput(
        pendingMessage,
    );

    clearPendingMessage();
    }, [
    pendingMessage,
    clearPendingMessage,
    ]);

  async function handleSubmit(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const message =
      input.trim();

    if (
      !message ||
      loading
    ) {
      return;
    }

    const userMessage = {
      id:
        crypto.randomUUID(),

      role:
        "user" as const,

      content:
        message,
    };

    setMessages(
      (current) => [
        ...current,
        userMessage,
      ],
    );

    setInput("");
    setLoading(true);

    try {
      const response =
        await fetch(
          "/api/ai",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                message,

                previousResponseId,
              }),
          },
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ??
          "Erro no assistente.",
        );
      }

      if (
        data.responseId
      ) {
        setPreviousResponseId(
          data.responseId,
        );
      }

      setMessages(
        (current) => [
          ...current,
          {
            id:
              crypto.randomUUID(),

            role:
              "assistant",

            content:
              data.answer ??
              "Não consegui responder.",
          },
        ],
      );
    } catch (error) {
      setMessages(
        (current) => [
          ...current,
          {
            id:
              crypto.randomUUID(),

            role:
              "assistant",

            content:
              error instanceof Error
                ? `Erro: ${error.message}`
                : "Ocorreu um erro no assistente.",
          },
        ],
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* BOTÃO FLUTUANTE */}

      {!open && (
        <button
          type="button"
          onClick={() =>
            setOpen(true)
          }
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#17191d] text-white shadow-lg transition hover:scale-105"
          aria-label="Abrir assistente"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}

      {/* PAINEL */}

      {open && (
        <div className="fixed bottom-6 right-6 z-50 flex h-[620px] w-[390px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl border border-[#e3e6ea] bg-white shadow-2xl">
          {/* HEADER */}

          <div className="flex items-center justify-between border-b border-[#eceef1] px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#17191d] text-white">
                <Bot className="h-5 w-5" />
              </div>

              <div>
                <p className="text-sm font-semibold text-[#1f2328]">
                  Assistente IA
                </p>

                <p className="text-xs text-[#7d848e]">
                  Carteira e produção
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={
                  resetConversation
                }
                className="rounded-lg p-2 text-[#7d848e] hover:bg-[#f3f4f6]"
                title="Nova conversa"
              >
                <RotateCcw className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() =>
                  setOpen(false)
                }
                className="rounded-lg p-2 text-[#7d848e] hover:bg-[#f3f4f6]"
                title="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* MENSAGENS */}

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {messages.length ===
            0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50">
                  <Bot className="h-6 w-6 text-[#ff4b0a]" />
                </div>

                <h3 className="mt-4 text-sm font-semibold text-[#20242a]">
                  Como posso ajudar?
                </h3>

                <p className="mt-1 max-w-[260px] text-xs leading-5 text-[#7d848e]">
                  Podes perguntar sobre clientes,
                  apólices, produção, companhias
                  e responsáveis.
                </p>

                <div className="mt-5 space-y-2 text-left">
                  <Suggestion
                    text="Quantas apólices foram emitidas hoje?"
                    onClick={
                      setInput
                    }
                  />

                  <Suggestion
                    text="Que apólices tem um determinado cliente?"
                    onClick={
                      setInput
                    }
                  />

                  <Suggestion
                    text="Quais são as renovações mais próximas?"
                    onClick={
                      setInput
                    }
                  />
                </div>
              </div>
            ) : (
              messages.map(
                (message) => (
                  <div
                    key={
                      message.id
                    }
                    className={`flex ${
                      message.role ===
                      "user"
                        ? "justify-end"
                        : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-6 ${
                        message.role ===
                        "user"
                          ? "rounded-br-md bg-[#17191d] text-white"
                          : "rounded-bl-md bg-[#f3f4f6] text-[#25292f]"
                      }`}
                    >
                      {
                        message.content
                      }
                    </div>
                  </div>
                ),
              )
            )}

            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-[#f3f4f6] px-3.5 py-2.5 text-sm text-[#6f7680]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  A analisar...
                </div>
              </div>
            )}

            <div
              ref={
                bottomRef
              }
            />
          </div>

          {/* INPUT */}

          <form
            onSubmit={
              handleSubmit
            }
            className="border-t border-[#eceef1] p-3"
          >
            <div className="flex items-end gap-2 rounded-xl border border-[#dfe2e6] bg-white p-2 focus-within:border-[#ff4b0a]">
              <textarea
                value={input}
                onChange={(
                  event,
                ) =>
                  setInput(
                    event.target.value,
                  )
                }
                onKeyDown={(
                  event,
                ) => {
                  if (
                    event.key ===
                      "Enter" &&
                    !event.shiftKey
                  ) {
                    event.preventDefault();

                    event.currentTarget
                      .form
                      ?.requestSubmit();
                  }
                }}
                rows={1}
                placeholder="Pergunta ao assistente..."
                className="max-h-32 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"
              />

              <button
                type="submit"
                disabled={
                  loading ||
                  !input.trim()
                }
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#17191d] text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>

            <p className="mt-2 text-center text-[10px] text-[#9aa0a8]">
              As respostas usam os dados disponíveis na tua carteira.
            </p>
          </form>
        </div>
      )}
    </>
  );
}

function Suggestion({
  text,
  onClick,
}: {
  text: string;

  onClick: (
    value: string,
  ) => void;
}) {
  return (
    <button
      type="button"
      onClick={() =>
        onClick(text)
      }
      className="block w-full rounded-xl border border-[#e5e8ec] bg-white px-3 py-2 text-left text-xs text-[#59616d] transition hover:border-[#ff4b0a] hover:bg-orange-50"
    >
      {text}
    </button>
  );
}