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

  // ----------------------------------------
  // 1. Apólices ativas no âmbito (loja)
  // ----------------------------------------

  let policiesQuery = supabase
    .from("policies")
    .select(`
      id,
      client_id,
      policy_number,
      annualized_premium,
      issuing_store_id,
      status,
      company:companies ( id, name ),
      insurance_line:insurance_lines ( id, name )
    `)
    .eq("status", "ACTIVE");

  if (storeId && storeId !== "all") {
    policiesQuery = policiesQuery.eq("issuing_store_id", storeId);
  }

  const { data: policiesData, error: policiesError } =
    await policiesQuery;

  if (policiesError) {
    throw new Error(
      `Erro ao carregar apólices: ${policiesError.message}`,
    );
  }

  const policies = policiesData ?? [];

  if (policies.length === 0) {
    return [];
  }

  const policyIds = policies.map((p) => p.id);

  // ----------------------------------------
  // 2. Renovação calculada na BD (RPC)
  // ----------------------------------------

  const { data: renewalRows, error: renewalError } = await supabase.rpc(
    "get_latest_renewal_dates",
    { p_policy_ids: policyIds },
  );

  if (renewalError) {
    throw new Error(
      `Erro ao calcular renovações: ${renewalError.message}`,
    );
  }

 const renewalByPolicy = new Map<string, string>((renewalRows ?? []).map((row: any) => [row.policy_id as string, row.renewal_date as string]));

  // ----------------------------------------
  // 3. Filtrar para a janela de vencimentos
  // ----------------------------------------

  const policiesInWindow = policies.filter((policy) => {
    const renewalDate = renewalByPolicy.get(policy.id);

    return (
      renewalDate !== undefined &&
      renewalDate >= fromKey &&
      renewalDate <= toKey
    );
  });

  if (policiesInWindow.length === 0) {
    return [];
  }

  // ----------------------------------------
  // Clientes e lojas relacionadas
  // ----------------------------------------

  const clientIds = Array.from(
    new Set(
      policiesInWindow.map((p) => p.client_id).filter(Boolean),
    ),
  );

  const storeIds = Array.from(
    new Set(
      policiesInWindow
        .map((p) => p.issuing_store_id)
        .filter(Boolean),
    ),
  );

  const [clientsResult, storesResult] = await Promise.all([
    clientIds.length > 0
      ? supabase.from("clients").select("id, name").in("id", clientIds)
      : Promise.resolve({ data: [], error: null }),

    storeIds.length > 0
      ? supabase.from("stores").select("id, name").in("id", storeIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const clientMap = new Map(
    (clientsResult.data ?? []).map((c) => [c.id, c.name]),
  );

  const storeMap = new Map(
    (storesResult.data ?? []).map((s) => [s.id, s.name]),
  );

  const rows = policiesInWindow
    .map((policy) => {
      const company = Array.isArray(policy.company)
        ? policy.company[0]
        : policy.company;

      const line = Array.isArray(policy.insurance_line)
        ? policy.insurance_line[0]
        : policy.insurance_line;

      const renewalDate = renewalByPolicy.get(policy.id) as string;

      return {
        policyId: policy.id,
        policyNumber: policy.policy_number,
        clientName: clientMap.get(policy.client_id) ?? "Cliente",
        companyName: company?.name ?? "—",
        lineName: line?.name ?? null,
        renewalDate,
        annualizedPremium:
          policy.annualized_premium === null
            ? null
            : Number(policy.annualized_premium),
        storeId: policy.issuing_store_id,
        storeName: policy.issuing_store_id
          ? storeMap.get(policy.issuing_store_id) ?? null
          : null,
        overdue: renewalDate < todayKey,
      };
    })
    .sort((a, b) => a.renewalDate.localeCompare(b.renewalDate));

  return rows;
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