"use client";

import { useState, useTransition } from "react";
import { Loader2, RotateCcw } from "lucide-react";

import { PlansEditor } from "@/components/tarefas/plans-editor";
import { Toaster, useToasts } from "@/components/tarefas/toasts";
import {
  MESSAGE_LINE_KINDS,
  MESSAGE_LINE_KIND_LABELS,
  MESSAGE_VARIABLES,
  buildClientMessage,
  type MessageLineKind,
  type MessagePlan,
} from "@/lib/tasks/client-message";
import type { StoredMessageTemplates } from "@/lib/tasks/message-templates";

import { resetMessageTemplate, saveMessageTemplate } from "./actions";

const PREVIEW_LINE_NAMES: Record<MessageLineKind, string> = {
  AUTO: "Automóvel",
  HABITACAO: "Multirriscos Habitação",
  SAUDE: "Saúde",
  VIDA: "Vida",
  OTHER: "Acidentes Pessoais",
};

export function TemplatesEditor({
  templates,
}: {
  templates: StoredMessageTemplates;
}) {
  const [kind, setKind] = useState<MessageLineKind>("AUTO");
  const { toasts, push, dismiss } = useToasts();
  const template = templates[kind];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {MESSAGE_LINE_KINDS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setKind(option)}
            aria-pressed={kind === option}
            className={[
              "inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition",
              kind === option
                ? "border-[#ff4b0a] bg-[#fff7f3] text-[#20242a] ring-2 ring-[#ff4b0a]/10"
                : "border-[#e4e6e9] bg-white text-[#59616d] hover:border-[#ffb899]",
            ].join(" ")}
          >
            {MESSAGE_LINE_KIND_LABELS[option]}
            {templates[option].customized && (
              <span className="h-1.5 w-1.5 rounded-full bg-[#ff4b0a]" title="Personalizado" />
            )}
          </button>
        ))}
      </div>

      <KindEditor
        // Volta a ler o gravado depois de guardar/repor.
        key={`${kind}:${template.customized}:${template.newBody}:${template.renewalBody}:${JSON.stringify(template.plans)}`}
        kind={kind}
        initial={template}
        onNotify={push}
      />

      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function KindEditor({
  kind,
  initial,
  onNotify,
}: {
  kind: MessageLineKind;
  initial: StoredMessageTemplates[MessageLineKind];
  onNotify: (kind: "success" | "error", message: string) => void;
}) {
  const [newBody, setNewBody] = useState(initial.newBody);
  const [renewalBody, setRenewalBody] = useState(initial.renewalBody);
  const [plans, setPlans] = useState<MessagePlan[]>(initial.plans);
  const [previewNew, setPreviewNew] = useState(true);
  const [pending, startTransition] = useTransition();

  const dirty =
    newBody !== initial.newBody ||
    renewalBody !== initial.renewalBody ||
    JSON.stringify(plans) !== JSON.stringify(initial.plans);

  const preview = buildClientMessage({
    template: { lineKind: kind, newBody, renewalBody, plans },
    lineKind: kind,
    lineName: PREVIEW_LINE_NAMES[kind],
    isNewPolicy: previewNew,
    salutation: "Sr.",
    clientName: "Gary",
    senderName: "Paulo Carvalho",
    seller: kind === "AUTO" ? "Sr. Mário" : "",
    insuredItem: "",
    plans,
    // Hora fixa: servidor e browser dão o mesmo texto (sem erro de hidratação).
    now: new Date(2026, 0, 1, 15),
  });

  function run(action: () => Promise<void>, message: string) {
    startTransition(async () => {
      try {
        await action();
        onNotify("success", message);
      } catch (error) {
        onNotify(
          "error",
          error instanceof Error ? error.message : "Não foi possível guardar.",
        );
      }
    });
  }

  const textareaClass =
    "mt-1.5 w-full rounded-lg border border-[#e4e6e9] bg-white px-3 py-2 font-mono text-[13px] leading-relaxed outline-none transition focus:border-[#ff4b0a]";

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="space-y-4 rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        <div>
          <p className="text-xs font-medium text-[#7d848e]">Variáveis</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {MESSAGE_VARIABLES.map((variable) => (
              <span
                key={variable.key}
                title={variable.hint}
                className="rounded-md bg-[#f4f5f7] px-2 py-0.5 font-mono text-[11px] text-[#40464f]"
              >
                {variable.key}
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-[#8a9099]">
            Passa o rato por cima de cada variável para ver o que ela
            preenche. Se não houver planos, {"{planos}"} fica vazio e a
            vírgula antes dele desaparece.
          </p>
        </div>

        <div>
          <label className="text-xs font-medium text-[#7d848e]">
            Apólice nova
          </label>
          <textarea
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            rows={9}
            className={textareaClass}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-[#7d848e]">
            Renegociação
          </label>
          <textarea
            value={renewalBody}
            onChange={(e) => setRenewalBody(e.target.value)}
            rows={9}
            className={textareaClass}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-[#7d848e]">
            Planos standard
          </label>
          <div className="mt-1.5">
            <PlansEditor plans={plans} onChange={setPlans} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#edf0f2] pt-4">
          {initial.customized && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  () => resetMessageTemplate(kind),
                  "Modelo reposto para o de defeito.",
                )
              }
              className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-[#606771] transition hover:bg-[#f4f5f7] disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              Repor o de defeito
            </button>
          )}

          <button
            type="button"
            disabled={pending || !dirty}
            onClick={() =>
              run(
                () =>
                  saveMessageTemplate({
                    lineKind: kind,
                    newBody,
                    renewalBody,
                    plans,
                  }),
                "Modelo guardado.",
              )
            }
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#ff4b0a] px-4 text-sm font-medium text-white shadow-sm transition hover:bg-[#e64409] disabled:opacity-50"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </button>
        </div>
      </div>

      <div className="h-fit rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)] xl:sticky xl:top-6">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-[#20242a]">Pré-visualização</p>

          <div className="inline-flex rounded-lg border border-[#e4e6e9] bg-white p-0.5">
            {[
              { value: true, label: "Nova" },
              { value: false, label: "Renegociação" },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => setPreviewNew(option.value)}
                className={[
                  "h-7 cursor-pointer rounded-md px-2.5 text-xs font-medium transition",
                  previewNew === option.value
                    ? "bg-[#ff4b0a] text-white"
                    : "text-[#59616d] hover:bg-[#f4f5f7]",
                ].join(" ")}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-3 whitespace-pre-wrap rounded-xl bg-[#fafbfc] p-4 text-sm leading-relaxed text-[#30353c]">
          {preview}
        </p>

        <p className="mt-2 text-[11px] text-[#8a9099]">
          Exemplo com dados fictícios. No processo, a saudação depende da hora
          e o colaborador pode ajustar tudo antes de enviar.
        </p>
      </div>
    </div>
  );
}
