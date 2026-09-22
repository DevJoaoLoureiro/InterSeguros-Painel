"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";

import { runSimulation } from "@/app/(dashboard)/simulador/actions";
import type { ProductLine } from "@/lib/quoting/domain/types";

import { AutoForm } from "./auto-form";
import {
  createEmptyAutoValues,
  getMissingEssentials,
  validateAutoValues,
} from "./auto-values";
import { ClientPicker, type ClientMode } from "./client-picker";
import { applyClientToValues, clearPrefilledValues } from "./client-prefill";
import { LineSelector } from "./line-selector";
import { QuoteResults } from "./results/quote-results";
import { summarizeAutoRequest } from "./results/request-summary";
import type { RunState } from "./results/run-state";
import type {
  AutoFieldKey,
  AutoFormErrors,
  AutoFormValues,
  PrefilledFields,
  SimulatorClient,
} from "./types";

/*
 * Só carregado (e só existe no bundle) quando a página permite a
 * pré-visualização com dados fictícios, ou seja, fora de produção.
 */
const DemoSwitcher = dynamic(() =>
  import("./dev/demo-switcher").then((module) => module.DemoSwitcher),
);

/** Campos por ordem de aparição, para focar o primeiro com erro. */
const FIELD_ORDER: { key: AutoFieldKey; elementId: string }[] = [
  { key: "registration", elementId: "sim-registration" },
  { key: "birthDate", elementId: "sim-birth-date" },
  { key: "postalCode", elementId: "sim-postal-code" },
  { key: "drivingLicenceDate", elementId: "sim-licence-date" },
  { key: "vehicleValue", elementId: "sim-vehicle-value" },
];

const FIELD_KEYS = new Set<string>(FIELD_ORDER.map((field) => field.key));

const panelClass =
  "rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]";

function omitKeys<T extends object>(source: T, keys: string[]): T {
  const next = { ...source } as Record<string, unknown>;

  for (const key of keys) delete next[key];

  return next as T;
}

function focusField(elementId: string) {
  document.getElementById(elementId)?.focus();
}

type SimulatorWorkspaceProps = {
  /** Mostra a pré-visualização com dados fictícios (só fora de produção). */
  allowDemo: boolean;
};

export function SimulatorWorkspace({ allowDemo }: SimulatorWorkspaceProps) {
  const [line, setLine] = useState<ProductLine>("AUTO");

  const [clientMode, setClientMode] = useState<ClientMode>("existing");
  const [client, setClient] = useState<SimulatorClient | null>(null);

  const [values, setValues] = useState<AutoFormValues>(createEmptyAutoValues);
  const [prefilled, setPrefilled] = useState<PrefilledFields>({});
  const [errors, setErrors] = useState<AutoFormErrors>({});

  const [run, setRun] = useState<RunState>({ phase: "idle" });

  const formAnchorRef = useRef<HTMLDivElement>(null);
  const resultsAnchorRef = useRef<HTMLDivElement>(null);

  const calculating = run.phase === "loading";
  const isDemo = run.phase === "done" && run.demoLabel !== undefined;

  // Resultados reais ficam desatualizados quando o formulário muda.
  const stale =
    run.phase === "done" &&
    !isDemo &&
    run.snapshotKey !== JSON.stringify(values);

  /* ---------------------------------------------------------------- *
   * Cliente
   * ---------------------------------------------------------------- */

  function handleSelectClient(selected: SimulatorClient) {
    const cleared = clearPrefilledValues(values, prefilled);
    const applied = applyClientToValues(cleared, selected);

    setClient(selected);
    setValues(applied.values);
    setPrefilled(applied.prefilled);
    setErrors({});
  }

  function handleClearClient() {
    setValues(clearPrefilledValues(values, prefilled));
    setPrefilled({});
    setClient(null);
    setErrors({});
  }

  function handleModeChange(mode: ClientMode) {
    // "Novo cliente" descarta o cliente e o que veio dele; a escolha
    // "Cliente existente" só volta a mostrar a pesquisa.
    if (mode === "new") handleClearClient();

    setClientMode(mode);
  }

  /* ---------------------------------------------------------------- *
   * Formulário
   * ---------------------------------------------------------------- */

  function handleChange(patch: Partial<AutoFormValues>) {
    const keys = Object.keys(patch);

    setValues((current) => ({ ...current, ...patch }));

    // Editar um campo remove a marca "CRM" e o erro desse campo.
    const touched = keys.filter((key) => FIELD_KEYS.has(key));

    if (touched.length > 0) {
      setPrefilled((current) => omitKeys(current, touched));
    }

    // O valor da viatura só se aplica com danos próprios.
    const cleared = keys.includes("coverages")
      ? [...touched, "vehicleValue"]
      : touched;

    if (cleared.length > 0) {
      setErrors((current) => omitKeys(current, cleared));
    }
  }

  function handlePickVehicle(registration: string) {
    setValues((current) => ({ ...current, registration }));
    setPrefilled((current) => ({ ...current, registration: true }));
    setErrors((current) => omitKeys(current, ["registration"]));
  }

  function handleFixData() {
    formAnchorRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });

    const firstEmpty = FIELD_ORDER.find(
      ({ key }) => key !== "vehicleValue" && !values[key],
    );

    focusField((firstEmpty ?? FIELD_ORDER[0]).elementId);
  }

  /* ---------------------------------------------------------------- *
   * Cálculo
   * ---------------------------------------------------------------- */

  async function handleSubmit() {
    if (calculating) return;

    const found = validateAutoValues(values);

    setErrors(found);

    const firstInvalid = FIELD_ORDER.find(({ key }) => found[key]);

    if (firstInvalid) {
      focusField(firstInvalid.elementId);
      return;
    }

    const snapshot = values;

    setRun({ phase: "loading" });

    // Em ecrãs estreitos os resultados ficam abaixo do formulário.
    resultsAnchorRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });

    try {
      const result = await runSimulation({
        productLine: "AUTO",
        clientId: client?.id ?? null,
        values: snapshot,
      });

      if (result.ok) {
        setRun({
          phase: "done",
          comparison: result.comparison,
          summary: summarizeAutoRequest(snapshot),
          frequency: snapshot.paymentFrequency,
          snapshotKey: JSON.stringify(snapshot),
          zurichSnapshotToken: result.zurichSnapshotToken ?? undefined,
        });

        return;
      }

      if (result.fieldErrors) setErrors(result.fieldErrors);

      setRun({ phase: "failed", message: result.error });
    } catch {
      setRun({
        phase: "failed",
        message:
          "Sem ligação ao servidor. Verifique a ligação e tente novamente.",
      });
    }
  }

  // Na pré-visualização fictícia não há nada real para repetir.
  function handleRetry() {
    if (isDemo) return;

    void handleSubmit();
  }

  return (
    <div className="space-y-6">
      {/* RAMO + CLIENTE */}

      <section className={`${panelClass} space-y-5 p-5`}>
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-[#20242a]">Ramo</h2>

          <LineSelector
            value={line}
            disabled={calculating}
            onChange={setLine}
          />
        </div>

        <hr className="border-[#edf0f2]" />

        <ClientPicker
          mode={clientMode}
          client={client}
          disabled={calculating}
          onModeChange={handleModeChange}
          onSelect={handleSelectClient}
          onClear={handleClearClient}
        />
      </section>

      {/* FORMULÁRIO + RESULTADOS */}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,480px)_minmax(0,1fr)] xl:items-start">
        <div ref={formAnchorRef} className="@container min-w-0 scroll-mt-28">
          {line === "AUTO" && (
            <AutoForm
              values={values}
              errors={errors}
              prefilled={prefilled}
              vehicles={client?.vehicles ?? []}
              disabled={calculating}
              missing={getMissingEssentials(values)}
              onChange={handleChange}
              onPickVehicle={handlePickVehicle}
              onSubmit={() => void handleSubmit()}
            />
          )}
        </div>

        <div ref={resultsAnchorRef} className="min-w-0 scroll-mt-28">
          <QuoteResults
            state={run}
            stale={stale}
            onRetry={handleRetry}
            onFixData={handleFixData}
          />
        </div>
      </div>

      <p className="text-xs text-[#8a9099]">
        <Link
          href="/simulador/metricas"
          className="underline-offset-4 hover:text-[#20242a] hover:underline"
        >
          Ver a precisão do simulador Zurich Auto
        </Link>{" "}
        (cotações reais guardadas).
      </p>

      {allowDemo && <DemoSwitcher onSelect={setRun} />}
    </div>
  );
}
