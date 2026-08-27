"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
} from "react";

export type AiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type OpenAssistantOptions = {
  message?: string;
  resetConversation?: boolean;
};

type AssistantContextValue = {
  open: boolean;

  setOpen: (
    value: boolean,
  ) => void;

  messages: AiMessage[];

  setMessages: React.Dispatch<
    React.SetStateAction<
      AiMessage[]
    >
  >;

  previousResponseId:
    string | null;

  setPreviousResponseId:
    React.Dispatch<
      React.SetStateAction<
        string | null
      >
    >;

  pendingMessage:
    string | null;

  clearPendingMessage:
    () => void;

  openAssistant: (
    options?: OpenAssistantOptions,
  ) => void;

  resetConversation:
    () => void;
};

const AssistantContext =
  createContext<
    AssistantContextValue | undefined
  >(undefined);

export function AssistantProvider({
  children,
}: {
  children:
    React.ReactNode;
}) {
  const [
    open,
    setOpen,
  ] = useState(false);

  const [
    messages,
    setMessages,
  ] = useState<
    AiMessage[]
  >([]);

  const [
    previousResponseId,
    setPreviousResponseId,
  ] = useState<
    string | null
  >(null);

  const [
    pendingMessage,
    setPendingMessage,
  ] = useState<
    string | null
  >(null);

  function resetConversation() {
    setMessages([]);

    setPreviousResponseId(
      null,
    );

    setPendingMessage(
      null,
    );
  }

  function clearPendingMessage() {
    setPendingMessage(
      null,
    );
  }

  function openAssistant(
    options?: OpenAssistantOptions,
  ) {
    if (
      options?.resetConversation
    ) {
      resetConversation();
    }

    if (
      options?.message
    ) {
      setPendingMessage(
        options.message,
      );
    }

    setOpen(true);
  }

  const value =
    useMemo(
      () => ({
        open,
        setOpen,

        messages,
        setMessages,

        previousResponseId,
        setPreviousResponseId,

        pendingMessage,
        clearPendingMessage,

        openAssistant,

        resetConversation,
      }),
      [
        open,
        messages,
        previousResponseId,
        pendingMessage,
      ],
    );

  return (
    <AssistantContext.Provider
      value={value}
    >
      {children}
    </AssistantContext.Provider>
  );
}

export function useAssistant() {
  const context =
    useContext(
      AssistantContext,
    );

  if (!context) {
    throw new Error(
      "useAssistant deve ser usado dentro de AssistantProvider.",
    );
  }

  return context;
}