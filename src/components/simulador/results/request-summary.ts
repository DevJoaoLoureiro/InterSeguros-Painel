import {
  COVERAGE_PRESETS,
  USAGE_OPTIONS,
  getCoveragePreset,
} from "../auto-values";
import type { AutoFormValues } from "../types";
import { frequencyLabel } from "./format";

/*
 * Frases curtas com o que foi pedido, para mostrar por cima dos
 * resultados. Ajuda o mediador a confirmar que está a olhar para a
 * simulação certa.
 */
export function summarizeAutoRequest(values: AutoFormValues): string[] {
  const summary: string[] = [];

  summary.push(values.registration);

  const usage = USAGE_OPTIONS.find((option) => option.value === values.usage);
  if (usage) summary.push(usage.label);

  const preset = getCoveragePreset(values.coverages);
  summary.push(
    preset === "CUSTOM"
      ? "Coberturas personalizadas"
      : (COVERAGE_PRESETS.find((item) => item.id === preset)?.label ?? ""),
  );

  if (values.coverages.ownDamage && values.deductible !== null) {
    summary.push(
      values.deductible === 0
        ? "Sem franquia"
        : `Franquia ${values.deductible.toLocaleString("pt-PT")} €`,
    );
  }

  summary.push(`Pagamento ${frequencyLabel(values.paymentFrequency).toLowerCase()}`);

  return summary.filter(Boolean);
}
