"use client";

import type { ProductLine } from "@/lib/quoting/domain/types";
import { cn } from "@/lib/utils";

import { SIMULATOR_LINES } from "./product-lines";

type LineSelectorProps = {
  value: ProductLine;
  disabled?: boolean;
  onChange: (line: ProductLine) => void;
};

/*
 * Ramo a simular. Radios nativos: teclado (setas) e leitores de ecrã
 * funcionam sem código extra. Ramos sem formulário ficam desativados e
 * marcados como "brevemente".
 */
export function LineSelector({ value, disabled, onChange }: LineSelectorProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Ramo"
      className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
    >
      {SIMULATOR_LINES.map((line) => {
        const Icon = line.icon;
        const unavailable = !line.available;

        return (
          <label key={line.id} className="relative block shrink-0">
            <input
              type="radio"
              name="sim-line"
              value={line.id}
              checked={value === line.id}
              disabled={disabled || unavailable}
              onChange={() => onChange(line.id)}
              className="peer sr-only"
            />

            <span
              className={cn(
                "inline-flex h-11 cursor-pointer whitespace-nowrap items-center gap-2 rounded-xl border border-[#e1e4e8] bg-white px-3.5 text-sm font-medium text-[#353b44] transition",
                "hover:border-[#c9ced5]",
                "peer-checked:border-[#ff4b0a] peer-checked:bg-orange-50 peer-checked:text-[#b83a06]",
                "peer-focus-visible:ring-2 peer-focus-visible:ring-orange-200",
                "peer-disabled:cursor-not-allowed peer-disabled:border-[#edf0f2] peer-disabled:bg-[#fafbfc] peer-disabled:text-[#a0a6ae] peer-disabled:hover:border-[#edf0f2]",
              )}
            >
              <Icon className="h-4 w-4" />

              {line.label}

              {unavailable && (
                <span className="rounded-md bg-[#eef0f4] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#7a818b]">
                  brevemente
                </span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}
