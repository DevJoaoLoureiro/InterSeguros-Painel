/*
 * Consultas de vencimentos (renovações, recibos a vencer, vencidos).
 *
 * SEM verificação de acesso: o storeId tem de vir já decidido pelo
 * servidor (resolveStoreScope / getAlertScope). Não é "use server",
 * por isso não é chamável a partir do browser — os pontos de entrada
 * públicos estão em app/(dashboard)/vencimentos/action.ts.
 *
 * Tudo é calculado na BD (supabase/migrations/*_vencimentos_rpcs.sql):
 * um pedido por página de 1000 linhas, em vez de ler todas as apólices
 * ativas e os clientes/lojas aos blocos. Isto corre no layout (todas
 * as páginas), e no Worker da Cloudflare a versão antiga passava o
 * limite de subpedidos.
 */

import { createAdminClient } from "@/lib/supabase/admin";

const WINDOW_DAYS_AHEAD = 30;
const WINDOW_DAYS_BEHIND = 30;

// O PostgREST devolve no máximo 1000 linhas por pedido (também nas
// funções): lê-se por páginas.
const PAGE_SIZE = 1000;

function storeParam(storeId: string | null) {
  return storeId && storeId !== "all" ? storeId : null;
}

async function rpcAllPages<T>(
  fn: string,
  args: Record<string, unknown>,
): Promise<T[]> {
  const supabase = createAdminClient();
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .rpc(fn, args)
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Erro em ${fn}: ${error.message}`);
    }

    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return rows;
}

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
  // Para abrir o cliente (Clientes com o painel aberto).
  clientId: string | null;
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
  // Para abrir o cliente (Clientes com o painel aberto).
  clientId: string | null;
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
 * Apólices a renovar: period_end do último recibo não-estorno de cada
 * apólice ativa, dentro da janela (função get_upcoming_renewals).
 */
export async function getUpcomingRenewals({
  storeId,
}: {
  storeId: string | null;
}): Promise<RenewalRow[]> {
  const { todayKey, fromKey, toKey } = getWindow();

  type Row = {
    policy_id: string;
    policy_number: string;
    client_id: string | null;
    client_name: string | null;
    company_name: string | null;
    line_name: string | null;
    renewal_date: string;
    annualized_premium: number | string | null;
    store_id: string | null;
    store_name: string | null;
  };

  const rows = await rpcAllPages<Row>("get_upcoming_renewals", {
    p_store_id: storeParam(storeId),
    p_from: fromKey,
    p_to: toKey,
  });

  return rows.map((row) => ({
    policyId: row.policy_id,
    policyNumber: row.policy_number,
    clientId: row.client_id,
    clientName: row.client_name ?? "Cliente",
    companyName: row.company_name ?? "—",
    lineName: row.line_name,
    renewalDate: row.renewal_date,
    annualizedPremium:
      row.annualized_premium === null ? null : Number(row.annualized_premium),
    storeId: row.store_id,
    storeName: row.store_name,
    overdue: row.renewal_date < todayKey,
  }));
}

/*
 * Recibos a vencer: due_date dentro da janela, status PENDING (ainda
 * não cobrado), sem estornos (função get_upcoming_receipts).
 */
export async function getUpcomingReceipts({
  storeId,
}: {
  storeId: string | null;
}): Promise<UpcomingReceiptRow[]> {
  const { todayKey, fromKey, toKey } = getWindow();

  type Row = {
    receipt_id: string;
    receipt_number: string | null;
    policy_number: string | null;
    client_id: string | null;
    client_name: string | null;
    company_name: string | null;
    due_date: string;
    commercial_premium: number | string | null;
    total_premium: number | string | null;
    store_id: string | null;
    store_name: string | null;
  };

  const rows = await rpcAllPages<Row>("get_upcoming_receipts", {
    p_store_id: storeParam(storeId),
    p_from: fromKey,
    p_to: toKey,
  });

  return rows.map((row) => ({
    receiptId: row.receipt_id,
    receiptNumber: row.receipt_number,
    policyNumber: row.policy_number ?? "—",
    clientId: row.client_id,
    clientName: row.client_name ?? "Cliente",
    companyName: row.company_name ?? "—",
    dueDate: row.due_date,
    commercialPremium:
      row.commercial_premium === null ? null : Number(row.commercial_premium),
    totalPremium: row.total_premium === null ? null : Number(row.total_premium),
    storeId: row.store_id,
    storeName: row.store_name,
    overdue: row.due_date < todayKey,
  }));
}

/*
 * Contagem exata de recibos vencidos, SEM limite de janela (badge da
 * sidebar: todos os atrasados). Contado na BD (count_overdue_receipts).
 */
export async function getOverdueReceiptsCount({
  storeId,
}: {
  storeId: string | null;
}): Promise<number> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("count_overdue_receipts", {
    p_store_id: storeParam(storeId),
    p_today: getDateKey(new Date()),
  });

  if (error) {
    throw new Error(`Erro ao contar recibos vencidos: ${error.message}`);
  }

  return Number(data ?? 0);
}
