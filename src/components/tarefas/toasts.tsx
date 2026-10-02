"use client";

import { useCallback, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

export type ToastKind = "success" | "error" | "info";

type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
};

const TOAST_MS = 4000;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev.slice(-3), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), TOAST_MS);
    },
    [dismiss],
  );

  return { toasts, push, dismiss };
}

const toastStyles: Record<
  ToastKind,
  { icon: typeof Info; className: string }
> = {
  success: {
    icon: CheckCircle2,
    className: "border-green-200 text-green-800",
  },
  error: {
    icon: AlertCircle,
    className: "border-red-200 text-red-800",
  },
  info: {
    icon: Info,
    className: "border-[#e4e6e9] text-[#40464f]",
  },
};

export function Toaster({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 left-4 right-4 z-[70] flex flex-col items-end gap-2 sm:left-auto"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const style = toastStyles[toast.kind];
        const Icon = style.icon;

        return (
          <div
            key={toast.id}
            className={`flex w-full max-w-sm items-start gap-2.5 rounded-xl border bg-white px-3.5 py-3 text-sm shadow-lg ${style.className}`}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="flex-1">{toast.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="rounded p-0.5 text-[#a0a5ac] transition hover:text-[#606771]"
              aria-label="Fechar aviso"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
