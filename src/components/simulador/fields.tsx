"use client";

import type { ReactNode } from "react";
import { Minus, Plus } from "lucide-react";

import { cn } from "@/lib/utils";

/*
 * Primitivas de formulário do simulador. A app não tem componentes de
 * input partilhados (cada form usa as suas classes), por isso aqui
 * concentram-se as classes já usadas nos forms existentes para que o
 * simulador fique visualmente igual a eles.
 */

export const inputClass = cn(
  "h-11 w-full rounded-xl border border-[#e1e4e8] bg-white px-3.5 text-sm text-[#20242a] outline-none transition",
  "placeholder:text-[#a0a6ae]",
  "focus:border-[#ff4b0a] focus:ring-2 focus:ring-orange-100",
  "aria-invalid:border-red-400 aria-invalid:focus:ring-red-100",
  "disabled:cursor-not-allowed disabled:bg-[#f7f8fa] disabled:text-[#8a9099]",
);

type FieldProps = {
  id: string;
  label: string;
  /** Mostra a etiqueta "CRM" (dado pré-preenchido a partir do cliente). */
  fromCrm?: boolean;
  optional?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
};

export function Field({
  id,
  label,
  fromCrm,
  optional,
  hint,
  error,
  children,
  className,
}: FieldProps) {
  return (
    <div className={className}>
      <div className="mb-1.5 flex min-h-5 items-center gap-2">
        <label
          htmlFor={id}
          className="flex items-center gap-2 text-sm font-medium text-[#353b44]"
        >
          {label}

          {optional && (
            <span className="text-xs font-normal text-[#8a9099]">
              opcional
            </span>
          )}

          {fromCrm && <CrmTag />}
        </label>

      </div>

      {children}

      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="mt-1.5 text-xs font-medium text-red-600"
        >
          {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-[#8a9099]">{hint}</p>
      )}
    </div>
  );
}

export function CrmTag() {
  return (
    <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
      CRM
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Escolha única (radios nativos, com teclado e leitores de ecrã grátis)
 * ------------------------------------------------------------------ */

type ChoiceOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
};

type ChoiceGroupProps<T extends string> = {
  name: string;
  label: string;
  value: T | null;
  options: ChoiceOption<T>[];
  onChange: (value: T) => void;
  variant?: "chip" | "card";
  disabled?: boolean;
  className?: string;
};

export function ChoiceGroup<T extends string>({
  name,
  label,
  value,
  options,
  onChange,
  variant = "chip",
  disabled,
  className,
}: ChoiceGroupProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        variant === "chip"
          ? "flex flex-wrap gap-2"
          : "grid gap-2 @xl:grid-cols-3",
        className,
      )}
    >
      {options.map((option) => (
        <label key={option.value} className="relative block">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
            className="peer sr-only"
          />

          <span
            className={cn(
              "block cursor-pointer rounded-xl border border-[#e1e4e8] bg-white text-sm font-medium text-[#353b44] transition",
              "hover:border-[#c9ced5]",
              "peer-checked:border-[#ff4b0a] peer-checked:bg-orange-50 peer-checked:text-[#b83a06]",
              "peer-focus-visible:ring-2 peer-focus-visible:ring-orange-200",
              "peer-disabled:cursor-not-allowed peer-disabled:opacity-60",
              variant === "chip"
                ? "inline-flex h-10 items-center px-3.5"
                : "h-full p-3",
            )}
          >
            {variant === "chip" ? (
              option.label
            ) : (
              <>
                <span className="block leading-snug">{option.label}</span>

                {option.description && (
                  <span className="mt-1 block text-xs font-normal leading-snug text-[#7d848e]">
                    {option.description}
                  </span>
                )}
              </>
            )}
          </span>
        </label>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Checkbox em linha (coberturas individuais)
 * ------------------------------------------------------------------ */

export function CheckRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-[#e1e4e8] bg-white px-3.5 text-sm text-[#353b44] transition hover:border-[#c9ced5]",
        "has-[:checked]:border-[#ff4b0a] has-[:checked]:bg-orange-50",
        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-orange-200",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 shrink-0 accent-[#ff4b0a]"
      />

      {label}
    </label>
  );
}

/* ------------------------------------------------------------------ *
 * Contador (nº de sinistros)
 * ------------------------------------------------------------------ */

export function Stepper({
  id,
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const buttonClass =
    "flex h-11 w-11 items-center justify-center text-[#525963] transition hover:bg-[#f4f5f7] disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="inline-flex items-center overflow-hidden rounded-xl border border-[#e1e4e8] bg-white">
      <button
        type="button"
        aria-label="Diminuir"
        disabled={disabled || value <= min}
        onClick={() => onChange(value - 1)}
        className={buttonClass}
      >
        <Minus className="h-4 w-4" />
      </button>

      <output
        id={id}
        aria-live="polite"
        className="w-10 text-center text-sm font-semibold text-[#20242a]"
      >
        {value}
      </output>

      <button
        type="button"
        aria-label="Aumentar"
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
        className={buttonClass}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
