/*
 * Motivos de um processo "Não emitida" (tasks.not_issued_reason).
 * Partilhado entre servidor (validação) e cliente (lista do modal).
 * O código é o que fica gravado; mudar um rótulo não parte o histórico.
 */

export const NOT_ISSUED_REASONS = [
  { value: "PRICE", label: "Cliente achou muito caro" },
  { value: "STAYED", label: "Ficou na companhia atual" },
  { value: "COMPETITOR", label: "Fez o seguro noutra companhia / mediador" },
  { value: "NO_ANSWER", label: "Cliente deixou de responder" },
  { value: "GAVE_UP", label: "Cliente desistiu do seguro" },
  { value: "REFUSED", label: "Companhia recusou o risco" },
  { value: "OTHER", label: "Outro motivo" },
] as const;

export type NotIssuedReason = (typeof NOT_ISSUED_REASONS)[number]["value"];

export function isNotIssuedReason(value: unknown): value is NotIssuedReason {
  return NOT_ISSUED_REASONS.some((reason) => reason.value === value);
}

export function notIssuedReasonLabel(value: string | null | undefined) {
  if (!value) return null;

  return (
    NOT_ISSUED_REASONS.find((reason) => reason.value === value)?.label ?? value
  );
}
