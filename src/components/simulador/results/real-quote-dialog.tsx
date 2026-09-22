"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { CheckCircle2, Loader2, X } from "lucide-react";

import {
  saveRealZurichQuote,
  type SaveRealZurichQuoteResult,
} from "@/app/(dashboard)/simulador/observation-actions";
import type { EstimatedQuote } from "@/lib/quoting/domain/types";
import { cn } from "@/lib/utils";

import { Field, inputClass } from "../fields";

/*
 * Diálogo "Guardar cotação real Zurich".
 *
 * Só pede o que o agente viu no portal da Zurich. Tudo o resto (dados do
 * pedido, previsão, versão do modelo) vem do snapshot assinado que o servidor
 * emitiu ao calcular: aqui não se reintroduz nada, e nada do pedido passa
 * pelo browser (só o token opaco).
 */

type Basis = "ANNUAL" | "TOTAL" | "INSTALLMENT" | "COMMERCIAL" | "UNKNOWN";

const BASIS_OPTIONS: { value: Basis; label: string }[] = [
  { value: "ANNUAL", label: "Anual" },
  { value: "TOTAL", label: "Total a pagar" },
  { value: "INSTALLMENT", label: "Por prestação" },
  { value: "COMMERCIAL", label: "Comercial (sem impostos)" },
  { value: "UNKNOWN", label: "Não sei / por confirmar" },
];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "VALID", label: "Válida" },
  { value: "INCOMPLETE", label: "Incompleta" },
  { value: "INVALID", label: "Inválida" },
  { value: "TEST", label: "Teste" },
  { value: "MANUAL_OVERRIDE", label: "Ajuste manual" },
  { value: "EXPIRED", label: "Expirada" },
];

const eur = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

type RealQuoteDialogProps = {
  snapshotToken: string;

  /** Só para mostrar contexto; o servidor usa a previsão assinada. */
  estimate: EstimatedQuote;

  onClose: () => void;
  onSaved: () => void;
};

type FormState = {
  amount: string;
  basis: Basis;
  productName: string;
  productCode: string;
  reference: string;
  status: string;
  notes: string;
};

const INITIAL: FormState = {
  amount: "",
  basis: "UNKNOWN",
  productName: "",
  productCode: "",
  reference: "",
  status: "VALID",
  notes: "",
};

type SavedResult = Extract<SaveRealZurichQuoteResult, { ok: true }>;

export function RealQuoteDialog({
  snapshotToken,
  estimate,
  onClose,
  onSaved,
}: RealQuoteDialogProps) {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [errors, setErrors] = useState<
    Partial<Record<keyof FormState, string>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedResult | null>(null);
  const [pending, startTransition] = useTransition();

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending) return;

    setFormError(null);

    startTransition(async () => {
      try {
        const result = await saveRealZurichQuote({ snapshotToken, form });

        if (result.ok) {
          setSaved(result);
          onSaved();

          return;
        }

        setErrors(result.fieldErrors ?? {});
        setFormError(result.error);
      } catch {
        setFormError("Sem ligação ao servidor. Tente novamente.");
      }
    });
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/30 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />

        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 max-h-[92vh] w-[min(94vw,540px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-xl outline-none">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-base font-semibold text-[#20242a]">
                Guardar cotação real Zurich
              </Dialog.Title>

              <Dialog.Description className="mt-1 text-sm text-[#7d848e]">
                Introduza só o que viu no portal da Zurich. Os dados do pedido
                e a estimativa ficam associados automaticamente.
              </Dialog.Description>
            </div>

            <Dialog.Close
              aria-label="Fechar"
              className="rounded-lg p-1.5 text-[#7d848e] transition hover:bg-[#f4f5f7] focus-visible:ring-2 focus-visible:ring-orange-200 focus-visible:outline-none"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <p className="mt-4 rounded-xl bg-[#f4f6f9] px-3.5 py-2.5 text-sm text-[#353b44]">
            {estimate.calibration?.headlineEstimate != null && (
              <>
                Calibração com cotações reais:{" "}
                <strong className="font-semibold">
                  {eur.format(estimate.calibration.headlineEstimate)}
                </strong>
                {" · "}
              </>
            )}
            Estimativa histórica:{" "}
            <strong className="font-semibold">
              {eur.format(estimate.pointEstimate)}
            </strong>{" "}
            <span className="text-[#7d848e]">
              ({eur.format(estimate.priceRange.min)} –{" "}
              {eur.format(estimate.priceRange.max)}, prémio anual total)
            </span>
          </p>

          {saved ? (
            <SavedPanel result={saved} onClose={onClose} />
          ) : (
            <form onSubmit={handleSubmit} className="mt-4 space-y-4" noValidate>
              <Field
                id="rq-amount"
                label="Valor real Zurich (€)"
                error={errors.amount}
              >
                <input
                  id="rq-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="ex.: 1264,40"
                  value={form.amount}
                  onChange={(event) => update("amount", event.target.value)}
                  aria-invalid={!!errors.amount}
                  aria-describedby={errors.amount ? "rq-amount-error" : undefined}
                  className={inputClass}
                />
              </Field>

              <Field
                id="rq-basis"
                label="Base do preço"
                error={errors.basis}
                hint="A estimativa é o prémio anual total. Se não tiver a certeza do que o valor da Zurich representa, escolha «Não sei»."
              >
                <select
                  id="rq-basis"
                  value={form.basis}
                  onChange={(event) => update("basis", event.target.value as Basis)}
                  className={inputClass}
                >
                  {BASIS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="rq-product-name"
                  label="Produto Zurich"
                  optional
                  error={errors.productName}
                >
                  <input
                    id="rq-product-name"
                    autoComplete="off"
                    placeholder="ex.: Zurich Auto"
                    value={form.productName}
                    onChange={(event) => update("productName", event.target.value)}
                    className={inputClass}
                  />
                </Field>

                <Field
                  id="rq-product-code"
                  label="Código do produto"
                  optional
                  error={errors.productCode}
                >
                  <input
                    id="rq-product-code"
                    autoComplete="off"
                    value={form.productCode}
                    onChange={(event) => update("productCode", event.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>

              <Field
                id="rq-reference"
                label="Referência da simulação"
                optional
                error={errors.reference}
              >
                <input
                  id="rq-reference"
                  autoComplete="off"
                  value={form.reference}
                  onChange={(event) => update("reference", event.target.value)}
                  className={inputClass}
                />
              </Field>

              <Field
                id="rq-status"
                label="Estado"
                error={errors.status}
                hint="Só as «Válidas» entram nas métricas."
              >
                <select
                  id="rq-status"
                  value={form.status}
                  onChange={(event) => update("status", event.target.value)}
                  className={inputClass}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field id="rq-notes" label="Notas" optional error={errors.notes}>
                <textarea
                  id="rq-notes"
                  rows={3}
                  value={form.notes}
                  onChange={(event) => update("notes", event.target.value)}
                  className={cn(inputClass, "h-auto min-h-[76px] py-2.5")}
                />
              </Field>

              {formError && (
                <p role="alert" className="text-sm font-medium text-red-600">
                  {formError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-10 items-center rounded-xl border border-[#d8dde4] bg-white px-4 text-sm font-medium text-[#353b44] transition hover:bg-[#f4f5f7] focus-visible:ring-2 focus-visible:ring-orange-200 focus-visible:outline-none"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={pending}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#ff4b0a] px-4 text-sm font-semibold text-white transition hover:bg-[#e64408] focus-visible:ring-2 focus-visible:ring-orange-200 focus-visible:outline-none disabled:opacity-60"
                >
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Guardar
                </button>
              </div>
            </form>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SavedPanel({
  result,
  onClose,
}: {
  result: SavedResult;
  onClose: () => void;
}) {
  const { signedError, relativeError } = result;

  let comparison: string | null = null;

  if (signedError !== null && relativeError !== null) {
    const amount = eur.format(Math.abs(signedError));
    const percent = `${(relativeError * 100).toFixed(1).replace(".", ",")}%`;

    comparison =
      signedError < 0
        ? `O simulador subestimou ${amount} (${percent} do valor real).`
        : signedError > 0
          ? `O simulador sobrestimou ${amount} (${percent} do valor real).`
          : "A estimativa coincidiu com o valor real.";
  }

  return (
    <div className="mt-4 space-y-4">
      <p className="flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 px-3.5 py-3 text-sm text-green-900">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />

        <span>
          <strong className="font-semibold">Cotação real guardada.</strong>{" "}
          {result.duplicateOf
            ? "Foi reconhecida como duplicado de uma observação anterior: fica registada mas não conta duas vezes nas métricas."
            : result.status === "VALID"
              ? "Conta para as métricas de precisão."
              : "Não conta para as métricas (só as «Válidas» contam)."}
        </span>
      </p>

      {comparison && <p className="text-sm text-[#353b44]">{comparison}</p>}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-10 items-center rounded-xl border border-[#d8dde4] bg-white px-4 text-sm font-medium text-[#353b44] transition hover:bg-[#f4f5f7] focus-visible:ring-2 focus-visible:ring-orange-200 focus-visible:outline-none"
        >
          Fechar
        </button>
      </div>
    </div>
  );
}
