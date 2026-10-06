/*
 * Clientes perdidos: deteção de QUANDO um cliente saiu.
 *
 * Usado pelo separador "Anuladas" dos Vencimentos (lista para
 * contactar e tentar renovar). O fracionamento só muda de quanto em
 * quanto tempo há recibo, por isso só muda a tolerância para o recibo
 * seguinte aparecer.
 *
 * Funções puras: não tocam na BD.
 */

// Tolerância para o recibo seguinte aparecer, por fracionamento.
// No máximo 30 dias: é até onde os Vencimentos mostram a renovação
// "em atraso" — a partir daí passa ao separador "Anuladas", sem buraco.
const GRACE_DAYS: Record<string, number> = {
  MONTHLY: 15,
  QUARTERLY: 30,
  SEMIANNUAL: 30,
  ANNUAL: 30,
};
const DEFAULT_GRACE_DAYS = 30;

export type RecoveryPolicy = {
  id: string;
  status: string;
  payment_frequency: string | null;
  cancellation_date: string | null;
  end_date: string | null;
  provider_metadata: Record<string, unknown> | null;
};

export type RecoveryReceipt = {
  status: string;
  period_end: string | null;
  isReversal: boolean;
};

export type ExitReason = "CANCELLED" | "EXPIRED" | "NO_NEW_RECEIPTS";

function dateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match && !Number.isNaN(Date.parse(match[0])) ? match[0] : null;
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/*
 * Data em que o cliente saiu (ou null se continua connosco).
 * `receipts` em qualquer ordem.
 */
export function computeExit(
  policy: RecoveryPolicy,
  receipts: RecoveryReceipt[],
  today: string,
): { exitDate: string; exitReason: ExitReason } | null {
  const valid = receipts
    .filter((r) => !r.isReversal && dateOnly(r.period_end))
    .sort((a, b) =>
      (dateOnly(a.period_end) as string).localeCompare(
        dateOnly(b.period_end) as string,
      ),
    );

  const lastPaid = [...valid].reverse().find((r) => r.status === "PAID");
  const lastPaidEnd = lastPaid ? dateOnly(lastPaid.period_end) : null;

  // 1) A companhia anulou.
  if (policy.status === "CANCELLED") {
    const exitDate =
      dateOnly(policy.provider_metadata?.dataCancelamento) ??
      dateOnly(policy.cancellation_date) ??
      lastPaidEnd ??
      dateOnly(policy.end_date);

    return exitDate ? { exitDate, exitReason: "CANCELLED" } : null;
  }

  // 2) Terminou (não renovou).
  if (policy.status === "EXPIRED") {
    const exitDate = dateOnly(policy.end_date) ?? lastPaidEnd;
    return exitDate ? { exitDate, exitReason: "EXPIRED" } : null;
  }

  // 3) Ativa na companhia, mas deixaram de vir recibos: o último
  //    recibo (pago) acabou e o seguinte não apareceu dentro da
  //    tolerância do fracionamento.
  //    Recibo devolvido/em atraso NÃO é saída — é cobrança.
  const last = valid.at(-1);
  if (!last || last.status !== "PAID" || !lastPaidEnd) return null;

  const grace =
    GRACE_DAYS[policy.payment_frequency ?? ""] ?? DEFAULT_GRACE_DAYS;

  if (addDays(lastPaidEnd, grace) >= today) return null;

  return { exitDate: lastPaidEnd, exitReason: "NO_NEW_RECEIPTS" };
}
