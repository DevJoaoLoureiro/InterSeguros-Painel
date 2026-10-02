/*
 * Comissão de um recibo a partir de receipt_commissions.
 *
 * Cada companhia manda de forma diferente:
 * - Prévoir: uma linha TOTAL (com o tipo de comissão em external_type,
 *   ex. "GIS", "CNL - PC").
 * - Zurich: linhas por componente — ACQUISITION (angariação) e
 *   COLLECTION (cobrança).
 *
 * Regra: se houver TOTAL usa-se o TOTAL; senão soma-se as partes.
 * Assim nunca se conta duas vezes.
 */

export type CommissionRow = {
  commission_type: string;
  amount: number | string | null;
  external_type?: string | null;
};

export type CommissionSummary = {
  total: number;
  parts: { type: string; label: string; amount: number }[];
  externalType: string | null;
};

export const COMMISSION_TYPE_LABELS: Record<string, string> = {
  TOTAL: "Total",
  ACQUISITION: "Angariação",
  COLLECTION: "Cobrança",
  BROKERAGE: "Corretagem",
  OTHER: "Outras",
};

export function summarizeCommissions(
  rows: CommissionRow[],
): CommissionSummary | null {
  const valid = rows
    .map((row) => ({
      type: row.commission_type,
      amount: row.amount === null ? NaN : Number(row.amount),
      externalType: row.external_type ?? null,
    }))
    .filter((row) => Number.isFinite(row.amount));

  if (valid.length === 0) return null;

  const totalRow = valid.find((row) => row.type === "TOTAL");
  const parts = valid.filter((row) => row.type !== "TOTAL");

  const total = totalRow
    ? totalRow.amount
    : parts.reduce((sum, row) => sum + row.amount, 0);

  return {
    total,
    parts: parts.map((row) => ({
      type: row.type,
      label: COMMISSION_TYPE_LABELS[row.type] ?? row.type,
      amount: row.amount,
    })),
    externalType:
      totalRow?.externalType ??
      valid.find((row) => row.externalType)?.externalType ??
      null,
  };
}
