"use client";

import { useEffect, useRef, useState } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { Car, Check, Info, Search, UserRound, X } from "lucide-react";

import { searchSimulatorClients } from "@/app/(dashboard)/simulador/actions";

import { ChoiceGroup } from "./fields";
import type { SimulatorClient } from "./types";

export type ClientMode = "existing" | "new";

type ClientPickerProps = {
  mode: ClientMode;
  client: SimulatorClient | null;
  disabled: boolean;
  onModeChange: (mode: ClientMode) => void;
  onSelect: (client: SimulatorClient) => void;
  onClear: () => void;
};

type SearchStatus = "idle" | "loading" | "done" | "error";

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

const MODE_OPTIONS: { value: ClientMode; label: string }[] = [
  { value: "existing", label: "Cliente existente" },
  { value: "new", label: "Novo cliente" },
];

/** O que o CRM já sabe deste cliente e vai ser aproveitado no formulário. */
function describeAppliedData(client: SimulatorClient): string[] {
  const applied: string[] = [];

  if (client.birthDate) applied.push("data de nascimento");
  if (client.postalCode) applied.push("código postal");
  if (client.vehicles.length > 0) {
    applied.push(client.vehicles.length === 1 ? "matrícula" : "matrículas");
  }

  return applied;
}

export function ClientPicker({
  mode,
  client,
  disabled,
  onModeChange,
  onSelect,
  onClear,
}: ClientPickerProps) {
  const [results, setResults] = useState<SimulatorClient[]>([]);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [query, setQuery] = useState("");

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Só a resposta do último pedido conta; as anteriores chegam tarde e são ignoradas.
  const requestIdRef = useRef(0);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  function handleInputChange(next: string) {
    setQuery(next);

    if (timerRef.current) clearTimeout(timerRef.current);

    const term = next.trim();
    const requestId = ++requestIdRef.current;

    if (term.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setStatus("idle");
      return;
    }

    setStatus("loading");

    timerRef.current = setTimeout(async () => {
      try {
        const response = await searchSimulatorClients(term);

        if (requestId !== requestIdRef.current) return;

        if (response.ok) {
          setResults(response.clients);
          setStatus("done");
        } else {
          setResults([]);
          setStatus("error");
        }
      } catch {
        if (requestId !== requestIdRef.current) return;

        setResults([]);
        setStatus("error");
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  function handleSelect(selected: SimulatorClient) {
    requestIdRef.current += 1;
    setQuery("");
    setResults([]);
    setStatus("idle");
    onSelect(selected);
  }

  function statusMessage(): string | null {
    if (status === "loading") return "A pesquisar…";
    if (status === "error") return "Não foi possível pesquisar. Tente de novo.";
    if (query.trim().length < MIN_QUERY_LENGTH) {
      return "Escreva pelo menos 2 letras do nome, ou o NIF.";
    }

    return null;
  }

  const message = statusMessage();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[#20242a]">Cliente</h3>
          <span className="text-xs text-[#8a9099]">opcional</span>
        </div>

        <ChoiceGroup
          name="sim-client-mode"
          label="Tipo de cliente"
          value={mode}
          options={MODE_OPTIONS}
          disabled={disabled}
          onChange={onModeChange}
        />
      </div>

      {mode === "new" && (
        <p className="flex items-start gap-2 rounded-xl bg-[#f4f6f9] px-3.5 py-3 text-sm text-[#525963]">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#7a818b]" />
          Simulação sem cliente associado. Os dados introduzidos não são
          guardados no CRM.
        </p>
      )}

      {mode === "existing" && client && (
        <SelectedClient
          client={client}
          disabled={disabled}
          onClear={onClear}
        />
      )}

      {mode === "existing" && !client && (
        <Combobox.Root
          items={results}
          itemToStringLabel={(item: SimulatorClient) => item.name}
          filter={null}
          value={null}
          disabled={disabled}
          onValueChange={(selected) => {
            if (selected) handleSelect(selected);
          }}
          onInputValueChange={(next) => handleInputChange(next)}
        >
          <Combobox.InputGroup className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a9099]" />

            <Combobox.Input
              aria-label="Pesquisar cliente por nome ou NIF"
              placeholder="Pesquisar por nome ou NIF…"
              autoComplete="off"
              className="h-11 w-full rounded-xl border border-[#e1e4e8] bg-white pl-10 pr-4 text-sm text-[#20242a] outline-none transition placeholder:text-[#a0a6ae] focus:border-[#ff4b0a] focus:ring-2 focus:ring-orange-100 disabled:cursor-not-allowed disabled:bg-[#f7f8fa]"
            />
          </Combobox.InputGroup>

          <Combobox.Portal>
            <Combobox.Positioner sideOffset={6} className="z-50 outline-none">
              <Combobox.Popup
                aria-busy={status === "loading" || undefined}
                className="w-[var(--anchor-width)] max-w-[var(--available-width)] origin-[var(--transform-origin)] overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-xl transition-[scale,opacity] data-[starting-style]:scale-95 data-[starting-style]:opacity-0"
              >
                <div className="max-h-[min(var(--available-height),20rem)] overflow-y-auto overscroll-contain py-1">
                  <Combobox.Status>
                    {message && (
                      <p className="px-4 py-3 text-sm text-[#7d848e]">
                        {message}
                      </p>
                    )}
                  </Combobox.Status>

                  <Combobox.Empty>
                    {status === "done" && (
                      <p className="px-4 py-3 text-sm text-[#7d848e]">
                        Nenhum cliente encontrado. Escolha “Novo cliente” para
                        continuar sem associar.
                      </p>
                    )}
                  </Combobox.Empty>

                  <Combobox.List>
                    {(item: SimulatorClient) => (
                      <Combobox.Item
                        key={item.id}
                        value={item}
                        className="flex cursor-default items-center gap-3 px-4 py-2.5 text-sm outline-none select-none data-[highlighted]:bg-[#f4f5f7]"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f0f2f5] text-[#525963]">
                          <UserRound className="h-4 w-4" />
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-[#20242a]">
                            {item.name}
                          </span>

                          <span className="block truncate text-xs text-[#7d848e]">
                            {[
                              item.nif && `NIF ${item.nif}`,
                              item.city,
                              item.vehicles.length > 0 &&
                                `${item.vehicles.length} ${item.vehicles.length === 1 ? "viatura" : "viaturas"}`,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "Sem mais dados"}
                          </span>
                        </span>
                      </Combobox.Item>
                    )}
                  </Combobox.List>
                </div>
              </Combobox.Popup>
            </Combobox.Positioner>
          </Combobox.Portal>
        </Combobox.Root>
      )}
    </div>
  );
}

function SelectedClient({
  client,
  disabled,
  onClear,
}: {
  client: SimulatorClient;
  disabled: boolean;
  onClear: () => void;
}) {
  const applied = describeAppliedData(client);

  return (
    <div className="flex items-start gap-3 rounded-xl border border-[#e1e4e8] bg-[#fafbfc] p-3.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#242a32] text-white">
        <UserRound className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[#20242a]">
          {client.name}
        </p>

        <p className="truncate text-xs text-[#7d848e]">
          {[client.nif && `NIF ${client.nif}`, client.city]
            .filter(Boolean)
            .join(" · ") || "Sem mais dados"}
        </p>

        <p className="mt-2 flex items-start gap-1.5 text-xs text-[#525963]">
          {applied.length > 0 ? (
            <>
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />

              <span>
                Aproveitado do CRM: {applied.join(", ")}. A data da carta não
                existe no CRM e tem de ser indicada.
              </span>
            </>
          ) : (
            <>
              <Car className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8a9099]" />

              <span>O CRM não tem dados úteis para o formulário.</span>
            </>
          )}
        </p>
      </div>

      <button
        type="button"
        onClick={onClear}
        disabled={disabled}
        aria-label="Remover cliente"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#737a84] transition hover:bg-[#eceef1] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
