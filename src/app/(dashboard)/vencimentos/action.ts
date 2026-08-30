"use server";

import { createAdminClient } from "@/lib/supabase/admin";

const WINDOW_DAYS_AHEAD = 30;
const WINDOW_DAYS_BEHIND = 30;

function getDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getWindow() {
  const today = new Date();

  const from = new Date(today);
  from.setDate(from.getDate() - WINDOW_DAYS_BEHIND);

  const to = new Date(today);
  to.setDate(to.getDate() + WINDOW_DAYS_AHEAD);

  return {
    todayKey: getDateKey(today),
    fromKey: getDateKey(from),
    toKey: getDateKey(to),
  };
}

export type RenewalRow = {
  policyId: string;
  policyNumber: string;
  clientName: string;
  companyName: string;
  lineName: string | null;
  renewalDate: string;
  annualizedPremium: number | null;
  storeId: string | null;
  storeName: string | null;
  overdue: boolean;
};

export type UpcomingReceiptRow = {
  receiptId: string;
  receiptNumber: string | null;
  policyNumber: string;
  clientName: string;
  companyName: string;
  dueDate: string;
  commercialPremium: number | null;
  totalPremium: number | null;
  storeId: string | null;
  storeName: string | null;
  overdue: boolean;
};

/*
 * Apólices a renovar: calculado a partir do
 * period_end do último recibo não-estorno de
 * cada apólice ativa.
 *
 * O cálculo do "último recibo por apólice" é
 * feito dentro da base de dados (função SQL
 * get_latest_renewal_dates), em vez de trazer
 * milhares de linhas de recibos para o Node.js
 * só para reduzir aqui — isso era a causa da
 * lentidão desta página.
 */
export async function getUpcomingRenewals({
  storeId,
}: {
  storeId: string | null;
}): Promise<RenewalRow[]> {
  const supabase = createAdminClient();

  const { todayKey, fromKey, toKey } = getWindow();

  const { data, error } = await supabase.rpc(
    "get_upcoming_renewals",
    {
      p_store_id:
        storeId && storeId !== "all"
          ? storeId
          : null,

      p_from: fromKey,
      p_to: toKey,
    },
  );

  if (error) {
    throw new Error(
      `Erro ao carregar renovações: ${error.message}`,
    );
  }

  return (data ?? []).map((row: any) => ({
    policyId: row.policy_id,
    policyNumber: row.policy_number,

    clientName: row.client_name,
    companyName: row.company_name,

    lineName: row.line_name,

    renewalDate: row.renewal_date,

    annualizedPremium:
      row.annualized_premium === null
        ? null
        : Number(row.annualized_premium),

    storeId: row.store_id,
    storeName: row.store_name,

    overdue: row.renewal_date < todayKey,
  }));
}

/*
 * Recibos a vencer: due_date dentro da janela,
 * status PENDING (ainda não cobrado), excluindo estornos.
 */
export async function getUpcomingReceipts({
  storeId,
}: {
  storeId: string | null;
}): Promise<UpcomingReceiptRow[]> {
  const supabase = createAdminClient();

  const { todayKey, fromKey, toKey } = getWindow();

  const { data, error } = await supabase.rpc(
    "get_upcoming_receipts",
    {
      p_store_id:
        storeId && storeId !== "all"
          ? storeId
          : null,

      p_from: fromKey,
      p_to: toKey,
    },
  );

  if (error) {
    throw new Error(
      `Erro ao carregar recibos a vencer: ${error.message}`,
    );
  }

  return (data ?? []).map((row: any) => ({
    receiptId: row.receipt_id,
    receiptNumber: row.receipt_number,

    policyNumber: row.policy_number,

    clientName: row.client_name,
    companyName: row.company_name,

    dueDate: row.due_date,

    commercialPremium:
      row.commercial_premium === null
        ? null
        : Number(row.commercial_premium),

    totalPremium:
      row.total_premium === null
        ? null
        : Number(row.total_premium),

    storeId: row.store_id,
    storeName: row.store_name,

    overdue: row.due_date < todayKey,
  }));
}