/*
 * Clientes perdidos: QUANDO os recontactar.
 *
 * Ideia: quem sai vai para outra companhia na data em que o nosso
 * seguro acabou. Esse seguro novo é (quase sempre) um contrato anual
 * — mesmo pago ao mês ou ao trimestre — e renova no ANIVERSÁRIO da
 * saída. É aí que o cliente recebe o aviso (muitas vezes com aumento)
 * e está mais aberto a mudar. Alertamos 45 dias ANTES desse
 * aniversário: dá tempo de ligar, simular e o cliente cancelar a
 * outra companhia a tempo.
 *
 * Funciona para qualquer fracionamento: o fracionamento só muda de
 * quanto em quanto tempo há recibo, por isso só muda COMO se deteta a
 * saída (a tolerância para o recibo seguinte), não a data do alerta.
 *
 * Funções puras: não tocam na BD (usadas pelo cron e pela lâmpada).
 */

export const RECOVERY_LEAD_DAYS = 45;

// Anos depois da saída em que ainda vale a pena tentar.
const MAX_ANNIVERSARIES = 3;

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

export type RecoveryWindow = {
  exitDate: string;
  exitReason: "CANCELLED" | "EXPIRED" | "NO_NEW_RECEIPTS";
  anniversary: string;
  daysUntilAnniversary: number;
  // true quando estamos nos 45 dias antes do aniversário.
  inWindow: boolean;
};

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

function addYears(date: string, years: number) {
  const [y, m, d] = date.split("-").map(Number);
  // 29/02 → 28/02 nos anos não bissextos.
  const result = new Date(Date.UTC(y + years, m - 1, d, 12));
  if (result.getUTCMonth() !== m - 1) result.setUTCDate(0);
  return result.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
      86_400_000,
  );
}

/*
 * Data em que o cliente saiu (ou null se continua connosco).
 * `receipts` em qualquer ordem.
 */
export function computeExit(
  policy: RecoveryPolicy,
  receipts: RecoveryReceipt[],
  today: string,
): { exitDate: string; exitReason: RecoveryWindow["exitReason"] } | null {
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
  //    Recibo devolvido/em atraso NÃO é saída — é cobrança (lâmpada).
  const last = valid.at(-1);
  if (!last || last.status !== "PAID" || !lastPaidEnd) return null;

  const grace =
    GRACE_DAYS[policy.payment_frequency ?? ""] ?? DEFAULT_GRACE_DAYS;

  if (addDays(lastPaidEnd, grace) >= today) return null;

  return { exitDate: lastPaidEnd, exitReason: "NO_NEW_RECEIPTS" };
}

/*
 * Próximo aniversário da saída (hoje incluído) e se já estamos na
 * janela dos 45 dias. Só até MAX_ANNIVERSARIES anos depois da saída.
 */
export function computeRecoveryWindow(
  policy: RecoveryPolicy,
  receipts: RecoveryReceipt[],
  today: string,
): RecoveryWindow | null {
  const exit = computeExit(policy, receipts, today);
  if (!exit) return null;

  for (let years = 1; years <= MAX_ANNIVERSARIES; years++) {
    const anniversary = addYears(exit.exitDate, years);
    const daysUntilAnniversary = daysBetween(today, anniversary);

    if (daysUntilAnniversary < 0) continue;

    return {
      ...exit,
      anniversary,
      daysUntilAnniversary,
      inWindow: daysUntilAnniversary <= RECOVERY_LEAD_DAYS,
    };
  }

  return null;
}

/* Chave única da lead (uma por apólice e por aniversário). */
export function recoveryReference(policyId: string, anniversary: string) {
  return `recuperacao:${policyId}:${anniversary}`;
}
