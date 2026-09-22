/*
 * TARGET histórico: que valor de uma apólice é o "preço" que queremos prever.
 *
 * EVIDÊNCIA (auditoria de 116 apólices Zurich Auto + 222 recibos):
 *
 * 1. `policies.annualized_premium` e `total_premium` guardam o MESMO valor
 *    (`PremioApolice` da Zurich); `commercial_premium` é sempre null.
 *
 * 2. Esse valor é o PRÉMIO ANUAL TOTAL (com encargos e impostos), qualquer
 *    que seja o fracionamento. Recibos normais (Novo/Continuado, não
 *    cancelados) verificam total_recibo / PremioApolice =
 *        Anual 1,008 | Semestral 0,503 | Trimestral 0,255 | Mensal 0,083
 *    isto é, ~1/n com n = nº de prestações por ano. Em 104 de 116
 *    apólices existe pelo menos um recibo coerente; em 5 não há recibo
 *    elegível; em 7 os recibos discordam (>8%: prémio alterado depois?).
 *
 * 3. O prémio COMERCIAL dos recibos vale ~0,86-0,88 do total (varia com
 *    o fracionamento). Não é comparável com o total: NÃO se mistura.
 *
 * 4. `insuredObject.premium` NÃO é o prémio anual da apólice: a razão
 *    objeto/apólice varia com o fracionamento (Anual 1,30 | Semestral
 *    1,03 | Trimestral 0,88 | Mensal 0,76), por isso não é uma grandeza
 *    equivalente e nunca é usado como target.
 *
 * DECISÃO: target = annualized_premium, com base ANNUAL_TOTAL, e uma
 * confiança por apólice:
 *   CONFIRMED     um recibo coerente confirma o valor anual;
 *   PROBABLE      sem recibo elegível para confirmar (mantém-se, com menos
 *                 peso na confiança; nada o contradiz);
 *   INCONSISTENT  há recibos elegíveis e nenhum concorda: o valor da
 *                 apólice pode estar desatualizado -> não entra no histórico.
 * LIMITAÇÃO: mesmo CONFIRMED, a Zurich não documenta o significado de
 * `PremioApolice`; a conclusão vem da consistência com os recibos.
 */

export type HistoricalTargetConfidence =
  | "CONFIRMED"
  | "PROBABLE"
  | "INCONSISTENT"
  | "MISSING";

export type HistoricalTarget = {
  /** null se não há valor utilizável (nunca 0). */
  value: number | null;

  /** Campo da BD de onde veio o valor. */
  source: "annualized_premium" | "total_premium" | "none";

  /** Sempre o prémio anual total, quando há valor. */
  basis: "ANNUAL_TOTAL" | null;

  confidence: HistoricalTargetConfidence;

  /** Recibos elegíveis usados na verificação e quantos concordaram. */
  receiptsChecked: number;
  receiptsAgreeing: number;

  /** Explicação legível (diagnóstico). */
  note: string;
};

export type TargetReceipt = {
  type: string | null;
  status: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  totalPremium: number | null;
};

export type TargetPolicyInput = {
  annualizedPremium: number | null;
  totalPremium: number | null;
  paymentFrequency: string | null;
  receipts: readonly TargetReceipt[];
};

const PERIODS_PER_YEAR: Record<string, number> = {
  ANNUAL: 1,
  SEMIANNUAL: 2,
  QUARTERLY: 4,
  MONTHLY: 12,
};

/** Um recibo concorda se total x prestações/ano está a +-8% do prémio anual. */
const AGREEMENT_LOW = 0.93;
const AGREEMENT_HIGH = 1.08;

/** Duração do período do recibo aceite face ao esperado (365/prestações). */
const PERIOD_TOLERANCE = 0.25;

const DAY_MS = 86_400_000;

function positive(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

function isEligibleReceipt(receipt: TargetReceipt): boolean {
  // Estorno e Suplementar não são prestações normais do prémio anual.
  if (receipt.type !== "Novo" && receipt.type !== "Continuado") return false;
  if (receipt.status === "CANCELLED" || receipt.status === "RETURNED") return false;

  return positive(receipt.totalPremium) !== null;
}

function periodDays(receipt: TargetReceipt): number | null {
  const start = receipt.periodStart ? Date.parse(receipt.periodStart) : NaN;
  const end = receipt.periodEnd ? Date.parse(receipt.periodEnd) : NaN;

  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;

  return (end - start) / DAY_MS;
}

export function resolveHistoricalTarget(
  policy: TargetPolicyInput,
): HistoricalTarget {
  const annualized = positive(policy.annualizedPremium);
  const total = positive(policy.totalPremium);

  const value = annualized ?? total;

  if (value === null) {
    return {
      value: null,
      source: "none",
      basis: null,
      confidence: "MISSING",
      receiptsChecked: 0,
      receiptsAgreeing: 0,
      note: "Sem prémio anual utilizável na apólice.",
    };
  }

  const source = annualized !== null ? "annualized_premium" : "total_premium";
  const perYear = policy.paymentFrequency
    ? PERIODS_PER_YEAR[policy.paymentFrequency]
    : undefined;

  const base = { value, source, basis: "ANNUAL_TOTAL" } as const;

  if (perYear === undefined) {
    return {
      ...base,
      confidence: "PROBABLE",
      receiptsChecked: 0,
      receiptsAgreeing: 0,
      note: "Fracionamento desconhecido: não é possível confirmar o valor com os recibos.",
    };
  }

  const expectedDays = 365 / perYear;

  const checkable = policy.receipts.filter(isEligibleReceipt).filter((receipt) => {
    const days = periodDays(receipt);

    return (
      days !== null &&
      Math.abs(days - expectedDays) / expectedDays <= PERIOD_TOLERANCE
    );
  });

  if (checkable.length === 0) {
    return {
      ...base,
      confidence: "PROBABLE",
      receiptsChecked: 0,
      receiptsAgreeing: 0,
      note: "Nenhum recibo normal com período coerente para confirmar o valor.",
    };
  }

  const agreeing = checkable.filter((receipt) => {
    const implied = (receipt.totalPremium as number) * perYear;

    return (
      implied >= value * AGREEMENT_LOW && implied <= value * AGREEMENT_HIGH
    );
  }).length;

  return {
    ...base,
    confidence: agreeing > 0 ? "CONFIRMED" : "INCONSISTENT",
    receiptsChecked: checkable.length,
    receiptsAgreeing: agreeing,
    note:
      agreeing > 0
        ? `Confirmado por ${agreeing} de ${checkable.length} recibos (prémio anual total).`
        : `Nenhum dos ${checkable.length} recibos confirma o valor anual; pode estar desatualizado.`,
  };
}
