"use client";

import { FlaskConical } from "lucide-react";

import type { RunState } from "../results/run-state";
import { DEMO_SCENARIOS } from "./demo-scenarios";

/*
 * Pré-visualização dos estados dos resultados com dados FICTÍCIOS.
 * Só é renderizada quando a página o permite (fora de produção).
 */
export function DemoSwitcher({
  onSelect,
}: {
  onSelect: (state: RunState) => void;
}) {
  return (
    <section
      aria-label="Pré-visualização com dados fictícios"
      className="rounded-2xl border border-dashed border-violet-300 bg-violet-50/60 p-4"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-violet-900">
        <FlaskConical className="h-4 w-4" />
        Pré-visualização de estados (só em desenvolvimento)
      </p>

      <p className="mt-1 text-xs text-violet-800/80">
        Mostra os resultados com dados fictícios. Não calcula nada nem chama
        seguradoras.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {DEMO_SCENARIOS.map((scenario) => (
          <button
            key={scenario.id}
            type="button"
            onClick={() => onSelect(scenario.build())}
            className="h-8 rounded-lg border border-violet-200 bg-white px-3 text-xs font-medium text-violet-900 transition hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
          >
            {scenario.label}
          </button>
        ))}
      </div>
    </section>
  );
}
