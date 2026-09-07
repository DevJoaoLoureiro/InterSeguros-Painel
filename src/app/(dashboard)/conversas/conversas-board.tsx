"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Search,
  MessageCircle,
  Phone,
  Building2,
  Send,
  CheckCheck,
  Check,
  Clock3,
  UserRound,
} from "lucide-react";

type Account = {
  id: string;
  store_id: string;
  phone_number: string | null;
  display_name: string | null;
  is_active: boolean;
};

type Conversation = {
  id: string;
  whatsapp_account_id: string;
  store_id: string;
  client_id: string | null;
  customer_phone: string;
  customer_name: string | null;
  status: "OPEN" | "CLOSED";
  unread_count: number;
  last_message_at: string | null;
  created_at: string;
};

type Message = {
  id: string;
  conversation_id: string;
  direction: "INBOUND" | "OUTBOUND";
  message_type: string;
  body: string | null;
  status: string | null;
  sent_at: string | null;
  created_at: string;
};

type Props = {
  initialAccounts: Account[];
  initialConversations: Conversation[];
};

function formatTime(date?: string | null) {
  if (!date) return "";

  return new Date(date).toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatConversationDate(date?: string | null) {
  if (!date) return "";

  const value = new Date(date);
  const now = new Date();

  const sameDay =
    value.getDate() === now.getDate() &&
    value.getMonth() === now.getMonth() &&
    value.getFullYear() === now.getFullYear();

  if (sameDay) {
    return formatTime(date);
  }

  return value.toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
  });
}

function getInitials(name?: string | null) {
  if (!name) return "?";

  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function MessageStatus({ status }: { status?: string | null }) {
  switch (status) {
    case "READ":
      return <CheckCheck className="h-3.5 w-3.5 text-sky-500" />;

    case "DELIVERED":
      return <CheckCheck className="h-3.5 w-3.5 text-zinc-400" />;

    case "SENT":
      return <Check className="h-3.5 w-3.5 text-zinc-400" />;

    default:
      return <Clock3 className="h-3.5 w-3.5 text-zinc-400" />;
  }
}

export default function ConversasBoard({
  initialAccounts,
  initialConversations,
}: Props) {
  const [conversations, setConversations] =
    useState<Conversation[]>(initialConversations);

  const [selectedConversationId, setSelectedConversationId] =
    useState<string | null>(initialConversations[0]?.id ?? null);

  const [selectedAccountId, setSelectedAccountId] =
    useState<string>("ALL");

  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState("");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);

  const selectedConversation =
    conversations.find(
      (conversation) => conversation.id === selectedConversationId
    ) ?? null;

  const selectedAccount = selectedConversation
    ? initialAccounts.find(
        (account) =>
          account.id === selectedConversation.whatsapp_account_id
      )
    : null;

  const filteredConversations = useMemo(() => {
    const term = search.trim().toLowerCase();

    return conversations.filter((conversation) => {
      if (
        selectedAccountId !== "ALL" &&
        conversation.whatsapp_account_id !== selectedAccountId
      ) {
        return false;
      }

      if (!term) return true;

      return [
        conversation.customer_name,
        conversation.customer_phone,
      ]
        .filter(Boolean)
        .some((value) =>
          String(value).toLowerCase().includes(term)
        );
    });
  }, [conversations, selectedAccountId, search]);

  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([]);
      return;
    }

    loadMessages(selectedConversationId);
  }, [selectedConversationId]);

  async function loadMessages(conversationId: string) {
    try {
      setLoadingMessages(true);

      const response = await fetch(
        `/api/whatsapp/conversation/${conversationId}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error || "Erro ao carregar mensagens."
        );
      }

      setMessages(data.messages ?? []);

      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                unread_count: 0,
              }
            : conversation
        )
      );
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingMessages(false);
    }
  }

  async function sendMessage() {
    if (!selectedConversationId || !messageText.trim() || sending) {
      return;
    }

    const text = messageText.trim();

    try {
      setSending(true);

      const response = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId: selectedConversationId,
          text,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error || "Erro ao enviar mensagem."
        );
      }

      setMessageText("");

      if (data.message) {
        setMessages((current) => [...current, data.message]);
      } else {
        await loadMessages(selectedConversationId);
      }
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Erro ao enviar mensagem."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="h-[calc(100vh-7rem)] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="grid h-full grid-cols-[360px_minmax(0,1fr)]">
        {/* SIDEBAR */}
        <aside className="flex min-h-0 flex-col border-r border-zinc-200 bg-white">
          <div className="border-b border-zinc-200 p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
                <MessageCircle className="h-5 w-5 text-emerald-600" />
              </div>

              <div>
                <h1 className="text-lg font-semibold text-zinc-900">
                  Conversas
                </h1>

                <p className="text-xs text-zinc-500">
                  Atendimento WhatsApp
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <select
                value={selectedAccountId}
                onChange={(e) =>
                  setSelectedAccountId(e.target.value)
                }
                className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-zinc-400"
              >
                <option value="ALL">
                  Todos os escritórios
                </option>

                {initialAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.display_name ||
                      account.phone_number ||
                      "WhatsApp"}
                  </option>
                ))}
              </select>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />

                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Pesquisar cliente ou telefone..."
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 pl-9 pr-3 text-sm outline-none transition focus:border-zinc-400 focus:bg-white"
                />
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredConversations.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100">
                  <MessageCircle className="h-5 w-5 text-zinc-400" />
                </div>

                <p className="text-sm font-medium text-zinc-700">
                  Sem conversas
                </p>

                <p className="mt-1 text-xs text-zinc-500">
                  As mensagens recebidas vão aparecer aqui.
                </p>
              </div>
            ) : (
              filteredConversations.map((conversation) => {
                const isSelected =
                  conversation.id === selectedConversationId;

                const account = initialAccounts.find(
                  (item) =>
                    item.id ===
                    conversation.whatsapp_account_id
                );

                return (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() =>
                      setSelectedConversationId(conversation.id)
                    }
                    className={`group flex w-full gap-3 border-b border-zinc-100 px-4 py-4 text-left transition ${
                      isSelected
                        ? "bg-emerald-50"
                        : "hover:bg-zinc-50"
                    }`}
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-semibold text-zinc-700">
                      {getInitials(
                        conversation.customer_name ||
                          conversation.customer_phone
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-zinc-900">
                          {conversation.customer_name ||
                            conversation.customer_phone}
                        </p>

                        <span className="shrink-0 text-[11px] text-zinc-400">
                          {formatConversationDate(
                            conversation.last_message_at
                          )}
                        </span>
                      </div>

                      <p className="mt-0.5 truncate text-xs text-zinc-500">
                        {conversation.customer_phone}
                      </p>

                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-400">
                          <Building2 className="h-3.5 w-3.5 shrink-0" />

                          <span className="truncate">
                            {account?.display_name ||
                              account?.phone_number ||
                              "WhatsApp"}
                          </span>
                        </div>

                        {conversation.unread_count > 0 && (
                          <span className="flex min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            {conversation.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* CONVERSA */}
        <main className="flex min-h-0 flex-col bg-[#f7f8f8]">
          {!selectedConversation ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-sm">
                <MessageCircle className="h-7 w-7 text-zinc-400" />
              </div>

              <h2 className="text-base font-semibold text-zinc-800">
                Seleciona uma conversa
              </h2>

              <p className="mt-1 max-w-sm text-sm text-zinc-500">
                Escolhe um cliente à esquerda para consultar o histórico
                e responder.
              </p>
            </div>
          ) : (
            <>
              {/* HEADER */}
              <header className="flex h-[74px] items-center justify-between border-b border-zinc-200 bg-white px-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-800">
                    {getInitials(
                      selectedConversation.customer_name ||
                        selectedConversation.customer_phone
                    )}
                  </div>

                  <div>
                    <div className="font-semibold text-zinc-900">
                      {selectedConversation.customer_name ||
                        selectedConversation.customer_phone}
                    </div>

                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
                      <Phone className="h-3.5 w-3.5" />
                      {selectedConversation.customer_phone}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-right">
                  <div className="text-xs font-medium text-zinc-700">
                    {selectedAccount?.display_name ||
                      "WhatsApp"}
                  </div>

                  <div className="mt-0.5 text-[11px] text-zinc-500">
                    {selectedAccount?.phone_number}
                  </div>
                </div>
              </header>

              {/* MENSAGENS */}
              <div className="flex-1 overflow-y-auto px-6 py-6">
                {loadingMessages ? (
                  <div className="flex h-full items-center justify-center">
                    <span className="text-sm text-zinc-500">
                      A carregar mensagens...
                    </span>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm">
                      <MessageCircle className="h-5 w-5 text-zinc-400" />
                    </div>

                    <p className="text-sm font-medium text-zinc-700">
                      Ainda não existem mensagens
                    </p>
                  </div>
                ) : (
                  <div className="mx-auto flex w-full max-w-4xl flex-col gap-2.5">
                    {messages.map((message) => {
                      const outbound =
                        message.direction === "OUTBOUND";

                      return (
                        <div
                          key={message.id}
                          className={`flex ${
                            outbound
                              ? "justify-end"
                              : "justify-start"
                          }`}
                        >
                          <div
                            className={`max-w-[70%] rounded-2xl px-4 py-2.5 shadow-sm ${
                              outbound
                                ? "rounded-br-md bg-emerald-100 text-zinc-900"
                                : "rounded-bl-md border border-zinc-200 bg-white text-zinc-900"
                            }`}
                          >
                            {message.body ? (
                              <p className="whitespace-pre-wrap break-words text-sm leading-5">
                                {message.body}
                              </p>
                            ) : (
                              <p className="text-sm italic text-zinc-500">
                                {message.message_type}
                              </p>
                            )}

                            <div className="mt-1.5 flex items-center justify-end gap-1 text-[10px] text-zinc-400">
                              <span>
                                {formatTime(
                                  message.sent_at ||
                                    message.created_at
                                )}
                              </span>

                              {outbound && (
                                <MessageStatus
                                  status={message.status}
                                />
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* COMPOSER */}
              <footer className="border-t border-zinc-200 bg-white p-4">
                <div className="mx-auto flex max-w-4xl items-end gap-3">
                  <div className="flex min-h-[48px] flex-1 items-end rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2 transition focus-within:border-zinc-400 focus-within:bg-white">
                    <textarea
                      value={messageText}
                      onChange={(e) =>
                        setMessageText(e.target.value)
                      }
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          !e.shiftKey
                        ) {
                          e.preventDefault();
                          sendMessage();
                        }
                      }}
                      placeholder="Escrever mensagem..."
                      rows={1}
                      className="max-h-32 min-h-[28px] flex-1 resize-none bg-transparent py-1 text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={!messageText.trim() || sending}
                    onClick={sendMessage}
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                    title="Enviar mensagem"
                  >
                    <Send className="h-4.5 w-4.5" />
                  </button>
                </div>
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  );
}