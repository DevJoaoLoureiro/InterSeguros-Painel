"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";

export type StoreOption = {
  id: string;
  name: string;
};

export type CommissionReceiptRow = {
  receiptId: string;
  receiptNumber: string | null;
  policyNumber: string;
  clientName: string;
  companyName: string;
  commissionDate: string | null;
  planType: string | null;
  commissionCobranca: number;
  commissionAngariacao: number;
  commissionTotal: number;
};

export type StoreCommissionSummary = {
  storeId: string;
  storeName: string;
  vidaTotal: number;
  naoVidaTotal: number;
  financeirosTotal: number;
  totalGeral: number;
  receiptCount: number;
};

const PAGE_SIZE = 1000;
const COMPANY_CODE = "ZURICH";

export async function getAccessibleStores(): Promise<{
  stores: StoreOption[];
  canAccessAll: boolean;
}> {
  const profile = await getCurrentProfile();

  if (!profile) {
    throw new Error("Não autenticado.");
  }

  const canAccessAll = profile.role === "OWNER" || profile.role === "ADMIN";
  const admin = createAdminClient();

  if (canAccessAll) {
    const { data, error } = await admin
      .from("stores")
      .select("id, name")
      .order("name", { ascending: true });

    if (error) {
      throw new Error(`Erro ao carregar lojas: ${error.message}`);
    }

    return { stores: data ?? [], canAccessAll: true };
  }

  if (!profile.store) {
    return { stores: [], canAccessAll: false };
  }

  return {
    stores: [{ id: profile.store.id, name: profile.store.name }],
    canAccessAll: false,
  };
}

function one<T = any>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function getMonthBounds(month: string): {
  monthStart: string;
  monthEnd: string;
} {
  const monthStart = `${month}-01`;
  const monthEndDate = new Date(`${monthStart}T00:00:00Z`);
  monthEndDate.setUTCMonth(monthEndDate.getUTCMonth() + 1);

  return {
    monthStart,
    monthEnd: monthEndDate.toISOString().slice(0, 10),
  };
}

type RawZurichCommissionReceipt = {
  id: string;
  receipt_number: string | null;
  payment_date: string | null;
  issue_date: string | null;
  company: any;
  policy: any;
  commissions: any;
};

type CalculatedZurichCommissionReceipt = {
  receiptId: string;
  receiptNumber: string | null;
  policyNumber: string;
  issuingStoreId: string | null;
  clientName: string;
  companyName: string;
  planType: string | null;
  commissionDate: string | null;
  commissionCobranca: number;
  commissionAngariacao: number;
};

/**
 * A Zurich não tem um "fecho oficial em PDF" como a Prévoir — as
 * comissões (ComissaoCobranca / ComissaoAngariacao) já vêm líquidas
 * e diretas em cada recibo, sem necessidade de heurísticas de
 * estorno/substituição. Por isso esta versão é bem mais simples:
 * soma direta, agrupada por loja e por mês de pagamento.
 *
 * "Mês da comissão" = payment_date (data em que o recibo foi
 * efetivamente pago/cobrado), com fallback para issue_date quando
 * não há data de pagamento.
 */
async function getCalculatedZurichCommissionReceipts(): Promise<
  CalculatedZurichCommissionReceipt[]
> {
  const admin = createAdminClient();
  const rows: CalculatedZurichCommissionReceipt[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await admin
      .from("receipts")
      .select(`
        id,
        receipt_number,
        payment_date,
        issue_date,

        company:companies (
          name,
          code
        ),

        policy:policies (
          id,
          policy_number,
          issuing_store_id,

          client:clients (
            name
          ),

          insurance_line:insurance_lines (
            plan_type
          )
        ),

        commissions:receipt_commissions!inner (
          amount,
          commission_type
        )
      `)
      .in("commissions.commission_type", ["COLLECTION", "ACQUISITION"])
      .range(from, to);

    if (error) {
      throw new Error(`Erro ao carregar comissões Zurich: ${error.message}`);
    }

    const page = (data ?? []) as RawZurichCommissionReceipt[];

    for (const row of page) {
      const company = one<any>(row.company);

      if (
        company?.code &&
        String(company.code).toUpperCase() !== COMPANY_CODE
      ) {
        continue;
      }

      const policy = one<any>(row.policy);
      const client = one<any>(policy?.client);
      const line = one<any>(policy?.insurance_line);

      if (!policy?.id) {
        continue;
      }

      const commissions = Array.isArray(row.commissions)
        ? row.commissions
        : row.commissions
          ? [row.commissions]
          : [];

      const commissionCobranca = commissions
        .filter((c: any) => c.commission_type === "COLLECTION")
        .reduce((sum: number, c: any) => sum + Number(c.amount ?? 0), 0);

      const commissionAngariacao = commissions
        .filter((c: any) => c.commission_type === "ACQUISITION")
        .reduce((sum: number, c: any) => sum + Number(c.amount ?? 0), 0);

      if (commissionCobranca === 0 && commissionAngariacao === 0) {
        continue;
      }

      rows.push({
        receiptId: row.id,
        receiptNumber: row.receipt_number,
        policyNumber: String(policy.policy_number ?? ""),
        issuingStoreId: policy.issuing_store_id ?? null,
        clientName: client?.name ?? "Cliente",
        companyName: company?.name ?? "Zurich",
        planType: line?.plan_type ?? null,
        commissionDate: row.payment_date ?? row.issue_date,
        commissionCobranca,
        commissionAngariacao,
      });
    }

    if (page.length < PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

function isInMonth(date: string | null, monthStart: string, monthEnd: string) {
  return Boolean(date && date >= monthStart && date < monthEnd);
}

export async function getZurichCommissionsSummaryByStore(
  month: string,
): Promise<StoreCommissionSummary[]> {
  const { stores } = await getAccessibleStores();
  if (stores.length === 0) {
    return [];
  }

  const { monthStart, monthEnd } = getMonthBounds(month);
  const receipts = await getCalculatedZurichCommissionReceipts();
  const storeIds = new Set(stores.map((s) => s.id));

  const totals = new Map<
    string,
    { vida: number; naoVida: number; financeiros: number; count: number }
  >();

  for (const receipt of receipts) {
    if (!isInMonth(receipt.commissionDate, monthStart, monthEnd)) {
      continue;
    }

    const storeId = receipt.issuingStoreId;
    if (!storeId || !storeIds.has(storeId)) {
      continue;
    }

    const current = totals.get(storeId) ?? {
      vida: 0,
      naoVida: 0,
      financeiros: 0,
      count: 0,
    };

    const total = receipt.commissionCobranca + receipt.commissionAngariacao;

    if (receipt.planType === "NAO_VIDA") {
      current.naoVida += total;
    } else if (receipt.planType === "FINANCEIROS") {
      current.financeiros += total;
    } else {
      current.vida += total;
    }

    current.count += 1;
    totals.set(storeId, current);
  }

  return stores.map((store) => {
    const current = totals.get(store.id) ?? {
      vida: 0,
      naoVida: 0,
      financeiros: 0,
      count: 0,
    };

    return {
      storeId: store.id,
      storeName: store.name,
      vidaTotal: current.vida,
      naoVidaTotal: current.naoVida,
      financeirosTotal: current.financeiros,
      totalGeral: current.vida + current.naoVida + current.financeiros,
      receiptCount: current.count,
    };
  });
}

export async function getZurichCommissionsDetail(
  storeId: string,
  month: string,
): Promise<CommissionReceiptRow[]> {
  const { monthStart, monthEnd } = getMonthBounds(month);
  const receipts = await getCalculatedZurichCommissionReceipts();
  const rows: CommissionReceiptRow[] = [];

  for (const receipt of receipts) {
    if (
      receipt.issuingStoreId !== storeId ||
      !isInMonth(receipt.commissionDate, monthStart, monthEnd)
    ) {
      continue;
    }

    rows.push({
      receiptId: receipt.receiptId,
      receiptNumber: receipt.receiptNumber,
      policyNumber: receipt.policyNumber,
      clientName: receipt.clientName,
      companyName: receipt.companyName,
      commissionDate: receipt.commissionDate,
      planType: receipt.planType,
      commissionCobranca: receipt.commissionCobranca,
      commissionAngariacao: receipt.commissionAngariacao,
      commissionTotal: receipt.commissionCobranca + receipt.commissionAngariacao,
    });
  }

  return rows.sort((a, b) =>
    (b.commissionDate ?? "").localeCompare(a.commissionDate ?? ""),
  );
}