"use server";

import { createAdminClient } from "@/lib/supabase/admin";

export type PolicyReceiptRow = {
  id: string;
  receipt_number: string | null;
  receipt_type: string | null;
  status: string;
  period_start: string | null;
  period_end: string | null;
  issue_date: string | null;
  due_date: string | null;
  payment_date: string | null;
  commercial_premium: number | null;
  total_premium: number | null;
  external_nature: string | null;
  cancellation_reason: string | null;
  isReversal: boolean;
};

/*
 * Recibos de UMA apólice específica, para
 * mostrar no painel de detalhe.
 *
 * Estorno é detetado da mesma forma que no
 * resto do sistema: external_nature === "9"
 * OU receipt_type contém ESTORNO/REVERSAL,
 * independentemente do status.
 */
export async function getPolicyReceipts(
  policyId: string,
): Promise<PolicyReceiptRow[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("receipts")
    .select(`
      id,
      receipt_number,
      receipt_type,
      status,
      period_start,
      period_end,
      issue_date,
      due_date,
      payment_date,
      commercial_premium,
      total_premium,
      external_nature,
      cancellation_reason
    `)
    .eq("policy_id", policyId)
    .order("due_date", { ascending: false, nullsFirst: false })
    .order("issue_date", { ascending: false, nullsFirst: false });

  if (error) {
    throw new Error(
      `Erro ao carregar recibos da apólice: ${error.message}`,
    );
  }

  return (data ?? []).map((row) => {
    const isReversal =
      row.external_nature === "9" ||
      (row.receipt_type ?? "").toUpperCase().includes("ESTORNO") ||
      (row.receipt_type ?? "").toUpperCase().includes("REVERSAL");

    return {
      id: row.id,
      receipt_number: row.receipt_number,
      receipt_type: row.receipt_type,
      status: row.status,
      period_start: row.period_start,
      period_end: row.period_end,
      issue_date: row.issue_date,
      due_date: row.due_date,
      payment_date: row.payment_date,
      commercial_premium:
        row.commercial_premium === null
          ? null
          : Number(row.commercial_premium),
      total_premium:
        row.total_premium === null ? null : Number(row.total_premium),
      external_nature: row.external_nature,
      cancellation_reason: row.cancellation_reason,
      isReversal,
    };
  });
}