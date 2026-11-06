"use client";

import { useMemo, useState } from "react";
import { Copy, Mail, MessageCircle, RotateCcw } from "lucide-react";

import type { TaskRow } from "@/app/(dashboard)/tarefas/action";
import {
  buildClientMessage,
  displayName,
  firstName,
  lineKindFromName,
  type MessageLineKind,
  type MessagePlan,
  type MessageTemplate,
} from "@/lib/tasks/client-message";

import { PlansEditor } from "./plans-editor";
import { Label, ModalShell, SecondaryButton } from "./task-modals";

const inputClass =
  "mt-1.5 h-10 w-full rounded-lg border border-[#e4e6e9] bg-white px-3 text-sm outline-none transition focus:border-[#ff4b0a]";

const SALUTATIONS = ["Sr.", "Sra.", ""] as const;

type Props = {
  process: TaskRow;
  lineName: string | null;
  senderName: string;
  templates: Record<MessageLineKind, MessageTemplate>;
  onPresented: () => void;
  onNotify: (kind: "success" | "error", message: string) => void;
  onClose: () => void;
};

export function ClientMessageModal({
  process,
  lineName,
  senderName,
  templates,
  onPresented,
  onNotify,
  onClose,
}: Props) {
  const lineKind = lineKindFromName(lineName);
  const template = templates[lineKind];

  const [salutation, setSalutation] = useState<string>("");
  const [clientName, setClientName] = useState(firstName(process.client_name));
  const [sender, setSender] = useState(displayName(senderName));
  const [seller, setSeller] = useState("");
  const [insuredItem, setInsuredItem] = useState("");
  const [plans, setPlans] = useState<MessagePlan[]>(template.plans);
  const [customText, setCustomText] = useState<string | null>(null);
  const [markPresented, setMarkPresented] = useState(
    !process.simulation_presented,
  );

  const isNewPolicy = process.is_new_policy !== false;

  const generated = useMemo(
    () =>
      buildClientMessage({
        template,
        lineKind,
        lineName,
        isNewPolicy,
        salutation,
        clientName,
        senderName: sender,
        seller,
        insuredItem,
        plans,
      }),
    [template, lineKind, lineName, isNewPolicy, salutation, clientName, sender, seller, insuredItem, plans],
  );

  const text = customText ?? generated;

  function afterSend(message: string) {
    if (markPresented && !process.simulation_presented) {
      onPresented();
      setMarkPresented(false);
    }
    onNotify("success", message);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      afterSend("Mensagem copiada.");
    } catch {
      onNotify("error", "Não foi possível copiar. Seleciona o texto e copia à mão.");
    }
  }

  function handleWhatsApp() {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer",
    );
    afterSend("Mensagem aberta no WhatsApp.");
  }

  function handleEmail() {
    const subject = `Cotação de seguro${lineName ? ` — ${lineName}` : ""}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
    afterSend("Mensagem aberta no email.");
  }

  const actionClass =
    "inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-[#e4e6e9] px-3 text-sm font-medium text-[#40464f] transition hover:border-[#ffb899] hover:bg-[#fff7f3]";

  return (
    <ModalShell
      wide
      title="Mensagem ao cliente"
      subtitle={`${process.client_name ?? process.title}${lineName ? ` · ${lineName}` : ""}`}
      onClose={onClose}
      footer={
        <>
          <SecondaryButton onClick={onClose}>Fechar</SecondaryButton>
          <button type="button" onClick={handleEmail} className={actionClass}>
            <Mail className="h-4 w-4" />
            Email
          </button>
          <button type="button" onClick={handleWhatsApp} className={actionClass}>
            <MessageCircle className="h-4 w-4" />
            WhatsApp
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-[#ff4b0a] px-4 text-sm font-medium text-white shadow-sm transition hover:bg-[#e64409]"
          >
            <Copy className="h-4 w-4" />
            Copiar
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr]">
        <div>
          <Label>Tratamento</Label>
          <div className="mt-1.5 inline-flex rounded-lg border border-[#e4e6e9] bg-white p-0.5">
            {SALUTATIONS.map((option) => (
              <button
                key={option || "none"}
                type="button"
                onClick={() => setSalutation(option)}
                className={[
                  "h-8 cursor-pointer rounded-md px-3 text-xs font-medium transition",
                  salutation === option
                    ? "bg-[#ff4b0a] text-white"
                    : "text-[#59616d] hover:bg-[#f4f5f7]",
                ].join(" ")}
              >
                {option || "Nenhum"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label>Nome do cliente</Label>
          <input
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>Assinado por</Label>
          <input
            value={sender}
            onChange={(e) => setSender(e.target.value)}
            className={inputClass}
          />
        </div>

        {lineKind === "AUTO" && isNewPolicy && (
          <div>
            <Label>Vendedor da viatura (opcional)</Label>
            <input
              value={seller}
              onChange={(e) => setSeller(e.target.value)}
              placeholder="Ex.: Sr. Mário"
              className={inputClass}
            />
          </div>
        )}

        <div>
          <Label>
            {lineKind === "AUTO"
              ? "Viatura (opcional)"
              : "Bem / detalhe (opcional)"}
          </Label>
          <input
            value={insuredItem}
            onChange={(e) => setInsuredItem(e.target.value)}
            placeholder={lineKind === "AUTO" ? "Ex.: Peugeot 208" : ""}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label>Planos</Label>
          {template.plans.length > 0 && (
            <button
              type="button"
              onClick={() => setPlans(template.plans)}
              className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-[#7d848e] transition hover:text-[#ff4b0a]"
            >
              <RotateCcw className="h-3 w-3" />
              Repor standard
            </button>
          )}
        </div>

        <div className="mt-1.5">
          <PlansEditor plans={plans} onChange={setPlans} />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label>Mensagem</Label>
          {customText !== null && (
            <button
              type="button"
              onClick={() => setCustomText(null)}
              className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-[#7d848e] transition hover:text-[#ff4b0a]"
            >
              <RotateCcw className="h-3 w-3" />
              Editada à mão — gerar de novo
            </button>
          )}
        </div>
        <textarea
          value={text}
          onChange={(e) => setCustomText(e.target.value)}
          rows={10}
          className="mt-1.5 w-full rounded-lg border border-[#e4e6e9] px-3 py-2 text-sm leading-relaxed outline-none transition focus:border-[#ff4b0a]"
        />
      </div>

      {!process.simulation_presented && (
        <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-[#fafbfc] px-3 py-2 text-xs text-[#59616d]">
          <input
            type="checkbox"
            checked={markPresented}
            onChange={(e) => setMarkPresented(e.target.checked)}
            className="h-4 w-4 accent-[#ff4b0a]"
          />
          Ao copiar/enviar, passar para &quot;À espera do cliente&quot; (a
          seguir pergunta que companhia simulou)
        </label>
      )}
    </ModalShell>
  );
}
