/*
 * Regras de estado de um processo (tasks.kind = 'PROCESS'),
 * partilhadas entre servidor e cliente para que a UI otimista
 * mostre exatamente o que o servidor vai gravar.
 *
 * O estado de um processo é derivado dos passos:
 *   recibo pago                 → COMPLETED
 *   simulação ou emissão feitas → IN_PROGRESS
 *   nada feito                  → PENDING
 * A única exceção é CANCELLED, que é uma decisão manual.
 */

export type ProcessTaskStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

export type ProcessSteps = {
  status: ProcessTaskStatus;
  simulation_presented: boolean;
  issued: boolean;
  receipt_paid: boolean;
};

export function deriveProcessStatus(
  process: ProcessSteps,
): ProcessTaskStatus {
  if (process.status === "CANCELLED") return "CANCELLED";
  if (process.receipt_paid) return "COMPLETED";
  if (process.simulation_presented || process.issued) return "IN_PROGRESS";
  return "PENDING";
}

/*
 * Data YYYY-MM-DD com um ano plausível. Protege contra datas mal
 * escritas no input (ex.: ano 20226), que o Postgres aceita numa
 * coluna date mas rebentam nos filtros de recibos.
 */
export function isValidDateKey(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const year = Number(value.slice(0, 4));
  return year >= 2000 && year <= 2100 && !Number.isNaN(Date.parse(value));
}
