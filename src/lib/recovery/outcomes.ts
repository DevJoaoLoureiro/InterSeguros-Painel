/*
 * Resultado do contacto com um cliente das "Anuladas"
 * (policy_recovery_outcomes.outcome). Partilhado entre servidor
 * (validação) e cliente (lista do modal). O código é o que fica
 * gravado; mudar um rótulo não parte o histórico.
 *
 * final = já não há mais nada a fazer por esta apólice: sai da lista
 * "Por contactar". Os não finais (não atende, ligar mais tarde)
 * continuam lá, com a etiqueta.
 */

export const RECOVERY_OUTCOMES = [
  { value: "RECOVERED", label: "Recuperado — vai renovar", final: true },
  { value: "NOT_INTERESTED", label: "Não quer renovar", final: true },
  { value: "COMPETITOR", label: "Foi para outra companhia", final: true },
  { value: "SOLD", label: "Já não precisa do seguro (vendeu)", final: true },
  { value: "NO_ANSWER", label: "Não atende", final: false },
  { value: "CALL_LATER", label: "Pediu para ligar mais tarde", final: false },
  { value: "OTHER", label: "Outro", final: true },
] as const;

export type RecoveryOutcome = (typeof RECOVERY_OUTCOMES)[number]["value"];

export function isRecoveryOutcome(value: unknown): value is RecoveryOutcome {
  return RECOVERY_OUTCOMES.some((outcome) => outcome.value === value);
}

export function recoveryOutcomeInfo(value: string | null | undefined) {
  return RECOVERY_OUTCOMES.find((outcome) => outcome.value === value) ?? null;
}
