"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/*
 * Ditado por voz com o reconhecimento do próprio browser (Chrome, Edge,
 * Safari). Noutros browsers `supported` fica falso e o microfone não
 * aparece. O áudio é tratado pelo browser, não passa pelo CRM.
 */

type RecognitionEvent = {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};

type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type RecognitionConstructor = new () => Recognition;

function getRecognition(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;

  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };

  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const noopSubscribe = () => () => {};

export function useVoiceInput(onTranscript: (text: string) => void) {
  // Falso no servidor e na hidratação; o browser responde depois de montar.
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => getRecognition() !== null,
    () => false,
  );

  const [listening, setListening] = useState(false);

  const recognitionRef = useRef<Recognition | null>(null);
  const onTranscriptRef = useRef(onTranscript);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => () => recognitionRef.current?.abort(), []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Recognition = getRecognition();

    if (!Recognition || recognitionRef.current) return;

    const recognition = new Recognition();

    recognition.lang = "pt-PT";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) onTranscriptRef.current(transcript);
    };

    const finish = () => {
      recognitionRef.current = null;
      setListening(false);
    };

    recognition.onend = finish;
    recognition.onerror = finish;

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, []);

  return { supported, listening, start, stop };
}

/* Lê a resposta em voz alta (só quando a pergunta foi feita por voz). */
export function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "pt-PT";

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

  window.speechSynthesis.cancel();
}
