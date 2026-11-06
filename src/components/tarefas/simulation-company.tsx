"use client";

import { useState } from "react";
import { Check, Plus, Search } from "lucide-react";

import { avatarColor, initials } from "./utils";

/*
 * Escolha da companhia que simulou: usada na janela "Que companhia
 * simulou?" e no detalhe do processo (ambos em task-modals.tsx).
 * Escolhe-se uma companhia da lista ou escreve-se outra.
 * Não importa task-modals.tsx, para não haver importação circular.
 */

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/*
 * Picker: o campo serve para pesquisar e, se não houver nenhuma
 * igual, para usar o nome escrito.
 */
export function CompanyPicker({
  options = [],
  value,
  onChange,
  disabled = false,
  compact = false,
  autoFocus = false,
  onSubmit,
}: {
  options: string[];
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  compact?: boolean;
  autoFocus?: boolean;
  // Enter com uma escolha feita.
  onSubmit?: (value: string) => void;
}) {
  const [query, setQuery] = useState("");

  const q = normalize(query);
  // Só de leitura: mostra apenas a escolhida.
  const filtered = disabled
    ? value
      ? [value]
      : []
    : q
      ? options.filter((name) => normalize(name).includes(q))
      : options;
  const exact = options.find((name) => normalize(name) === q);
  const custom = query.trim() && !exact ? query.trim() : null;

  // Uma companhia escrita à mão (fora da lista) também aparece
  // como escolhida.
  const selectedIsCustom =
    !disabled && value !== null && !options.some((name) => name === value);

  function pick(name: string) {
    if (disabled) return;
    onChange(value === name ? null : name);
  }

  function handleEnter() {
    const choice =
      exact ?? (filtered.length === 1 ? filtered[0] : null) ?? custom;

    if (!choice) return;

    onChange(choice);
    setQuery("");
    onSubmit?.(choice);
  }

  return (
    <div className="space-y-2.5">
      {!disabled && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#a0a5ac]" />
          <input
            type="text"
            value={query}
            autoFocus={autoFocus}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleEnter();
              }
            }}
            placeholder="Pesquisar ou escrever outra companhia…"
            className="h-10 w-full rounded-xl border border-[#e4e6e9] bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[#ff4b0a] focus:ring-4 focus:ring-[#ff4b0a]/10"
          />
        </div>
      )}

      <div
        className={[
          "grid gap-2 overflow-y-auto pr-0.5",
          compact
            ? "max-h-40 grid-cols-2 sm:grid-cols-3"
            : "max-h-64 grid-cols-2",
        ].join(" ")}
      >
        {selectedIsCustom && value && !custom && (
          <CompanyTile
            name={value}
            selected
            compact={compact}
            disabled={disabled}
            onClick={() => pick(value)}
          />
        )}

        {filtered.map((name) => (
          <CompanyTile
            key={name}
            name={name}
            selected={value === name}
            compact={compact}
            disabled={disabled}
            onClick={() => pick(name)}
          />
        ))}

        {custom && !disabled && (
          <button
            type="button"
            onClick={() => {
              onChange(custom);
              setQuery("");
            }}
            className="col-span-full flex cursor-pointer items-center gap-2.5 rounded-xl border border-dashed border-[#ffb899] bg-[#fff7f3] px-3 py-2.5 text-left text-sm text-[#c2410c] transition hover:border-[#ff4b0a]"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white">
              <Plus className="h-4 w-4" />
            </span>
            <span className="min-w-0 truncate">
              Usar <strong className="font-semibold">“{custom}”</strong>
            </span>
          </button>
        )}

        {filtered.length === 0 && !custom && !selectedIsCustom && (
          <p className="col-span-full py-4 text-center text-xs text-[#a0a5ac]">
            {disabled
              ? "Sem companhia indicada."
              : "Sem companhias na lista — escreve o nome acima."}
          </p>
        )}
      </div>
    </div>
  );
}

function CompanyTile({
  name,
  selected,
  compact,
  disabled,
  onClick,
}: {
  name: string;
  selected: boolean;
  compact: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={[
        "group relative flex min-w-0 items-center gap-2.5 rounded-xl border text-left transition",
        compact ? "px-2 py-1.5" : "px-3 py-2.5",
        disabled ? "cursor-default" : "cursor-pointer",
        selected
          ? "border-[#ff4b0a] bg-[#fff7f3] shadow-[0_0_0_3px_rgba(255,75,10,0.12)]"
          : disabled
            ? "border-[#edf0f2] bg-[#fafbfc] opacity-60"
            : "border-[#e4e6e9] bg-white hover:-translate-y-0.5 hover:border-[#ffb899] hover:shadow-[0_6px_16px_rgba(20,25,35,0.08)]",
      ].join(" ")}
    >
      <span
        className={[
          "flex shrink-0 items-center justify-center rounded-lg font-semibold text-white",
          compact ? "h-6 w-6 text-[9px]" : "h-8 w-8 text-[11px]",
          avatarColor(name),
        ].join(" ")}
      >
        {initials(name)}
      </span>

      <span
        className={[
          "min-w-0 flex-1 truncate font-medium text-[#20242a]",
          compact ? "text-xs" : "text-sm",
        ].join(" ")}
      >
        {name}
      </span>

      {selected && (
        <span className="flex h-5 w-5 shrink-0 animate-pop-in items-center justify-center rounded-full bg-[#ff4b0a] text-white">
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      )}
    </button>
  );
}
