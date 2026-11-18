"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getMonthlyCommissionsFromDb } from "@/lib/billing/monthly-commissions";
import { assertStoreAccess, requireAdmin } from "@/lib/auth/access";
import { getAccessibleStores } from "@/app/(dashboard)/faturacao/zurich/actions";
import type {
  CommissionReceiptRow,
  StoreCommissionSummary,
} from "@/components/faturacao/commission-types";

/*
 * Comissões da Generali (faturacao/generali e Mapa de comissões).
 *
 * As comissões vêm em cada recibo (ComissaoMediacao → ACQUISITION,
 * ComissaoCobranca → COLLECTION, já com o sinal do lado do mediador:
 * ver providers/generali/receipt-mapper.ts). Conta-se só o que foi
 * recebido: recibos PAGOS, pelo mês da data de pagamento. Os estornos
 * pagos entram com comissão negativa.
 *
 * Ao contrário da Zurich, o filtro (companhia, estado, datas) é feito
 * na BD: só vêm os recibos do período pedido.
 *
 * O imposto de selo da comissão vem em cada recibo (SeloMediador +
 * SeloCobrador, em provider_metadata): é o valor oficial. Recibos
 * gravados antes de 2026-11-18 não o têm; nesses usa-se a estimativa de
 * 2% do Não Vida, como na Zurich, e o mês fica marcado como estimado.
 */

const PAGE_SIZE = 1000;
const COMPANY_CODE = "GENERALI";
const STAMP_DUTY_ESTIMATE_RATE = 0.02;

type Relation<T> = T | T[] | null;

function one<T>(value: Relation<T> | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

type RawReceipt = {
  id: string;
  receipt_number: string | null;
  payment_date: string | null;
  selo_mediador: number | string | null;
  selo_cobrador: number | string | null;
  policy: Relation<{
    id: string;
    policy_number: string | null;
    issuing_store_id: string | null;
    client: Relation<{ name: string | null }>;
    insurance_line: Relation<{ plan_type: string | null }>;
  }>;
  commissions: Relation<{ amount: number | string | null; commission_type: string }>;
};

type GeneraliCommissionReceipt = {
  receiptId: string;
  receiptNumber: string | null;
  policyNumber: string;
  issuingStoreId: string | null;
  clientName: string;
  planType: string | null;
  paymentDate: string;
  commissionCobranca: number;
  commissionAngariacao: number;
  /** null: recibo gravado antes de se guardar o selo. */
  stampDuty: number | null;
};

async function getCompanyId(): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("companies")
    .select("id")
    .eq("code", COMPANY_CODE)
    .maybeSingle();

  if (error || !data) {
    throw new Error("Companhia Generali não encontrada.");
  }

  return data.id;
}

function addMonths(month: string, count: number) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + count);
  return date.toISOString().slice(0, 10);
}

/** Recibos pagos com payment_date em [from, to). */
async function loadPaidCommissionReceipts(
  from: string,
  to: string,
): Promise<GeneraliCommissionReceipt[]> {
  const admin = createAdminClient();
  const companyId = await getCompanyId();
  const rows: GeneraliCommissionReceipt[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from("receipts")
      .select(`
        id,
        receipt_number,
        payment_date,
        selo_mediador:provider_metadata->seloMediador,
        selo_cobrador:provider_metadata->seloCobrador,
        policy:policies (
          id,
          policy_number,
          issuing_store_id,
          client:clients ( name ),
          insurance_line:insurance_lines ( plan_type )
        ),
        commissions:receipt_commissions ( amount, commission_type )
      `)
      .eq("company_id", companyId)
      .eq("status", "PAID")
      .gte("payment_date", from)
      .lt("payment_date", to)
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Erro ao carregar comissões Generali: ${error.message}`);
    }

    const page = (data ?? []) as unknown as RawReceipt[];

    for (const row of page) {
      const policy = one(row.policy);
      if (!policy?.id || !row.payment_date) continue;

      const commissions = Array.isArray(row.commissions)
        ? row.commissions
        : row.commissions
          ? [row.commissions]
          : [];

      const sum = (type: string) =>
        commissions
          .filter((c) => c.commission_type === type)
          .reduce((total, c) => total + Number(c.amount ?? 0), 0);

      const commissionCobranca = sum("COLLECTION");
      const commissionAngariacao = sum("ACQUISITION");

      if (commissionCobranca === 0 && commissionAngariacao === 0) continue;

      const hasStamp = row.selo_mediador !== null || row.selo_cobrador !== null;

      rows.push({
        receiptId: row.id,
        receiptNumber: row.receipt_number,
        policyNumber: String(policy.policy_number ?? ""),
        issuingStoreId: policy.issuing_store_id ?? null,
        clientName: one(policy.client)?.name ?? "Cliente",
        planType: one(policy.insurance_line)?.plan_type ?? null,
        paymentDate: row.payment_date,
        commissionCobranca,
        commissionAngariacao,
        stampDuty: hasStamp
          ? Number(row.selo_mediador ?? 0) + Number(row.selo_cobrador ?? 0)
          : null,
      });
    }

    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

export async function getGeneraliCommissionsSummaryByStore(
  month: string,
): Promise<StoreCommissionSummary[]> {
  const { stores } = await getAccessibleStores();
  if (stores.length === 0) return [];

  const receipts = await loadPaidCommissionReceipts(`${month}-01`, addMonths(month, 1));
  const storeIds = new Set(stores.map((s) => s.id));

  type Totals = { vida: number; naoVida: number; financeiros: number; count: number };
  const empty = (): Totals => ({ vida: 0, naoVida: 0, financeiros: 0, count: 0 });
  const add = (target: Totals, planType: string | null, amount: number) => {
    if (planType === "NAO_VIDA") target.naoVida += amount;
    else if (planType === "FINANCEIROS") target.financeiros += amount;
    else target.vida += amount;
    target.count += 1;
  };

  // "Geral": lojas acessíveis + apólices sem loja (como na Zurich).
  const geral = empty();
  const perStore = new Map<string, Totals>();

  for (const receipt of receipts) {
    const storeId = receipt.issuingStoreId;
    const amount = receipt.commissionCobranca + receipt.commissionAngariacao;

    if (storeId === null || storeIds.has(storeId)) add(geral, receipt.planType, amount);

    if (storeId && storeIds.has(storeId)) {
      const current = perStore.get(storeId) ?? empty();
      add(current, receipt.planType, amount);
      perStore.set(storeId, current);
    }
  }

  const toRow = (storeId: string, storeName: string, t: Totals): StoreCommissionSummary => ({
    storeId,
    storeName,
    vidaTotal: t.vida,
    naoVidaTotal: t.naoVida,
    financeirosTotal: t.financeiros,
    totalGeral: t.vida + t.naoVida + t.financeiros,
    receiptCount: t.count,
  });

  return [
    toRow("GERAL", "Geral", geral),
    ...stores.map((store) => toRow(store.id, store.name, perStore.get(store.id) ?? empty())),
  ];
}

export async function getGeneraliCommissionsDetail(
  storeId: string,
  month: string,
): Promise<CommissionReceiptRow[]> {
  // "GERAL" é limitado abaixo às lojas acessíveis (+ sem loja).
  if (storeId !== "GERAL") await assertStoreAccess(storeId);

  const accessible =
    storeId === "GERAL"
      ? new Set((await getAccessibleStores()).stores.map((s) => s.id))
      : null;

  const receipts = await loadPaidCommissionReceipts(`${month}-01`, addMonths(month, 1));

  return receipts
    .filter((receipt) =>
      accessible
        ? receipt.issuingStoreId === null || accessible.has(receipt.issuingStoreId)
        : receipt.issuingStoreId === storeId,
    )
    .map((receipt) => ({
      receiptId: receipt.receiptId,
      receiptNumber: receipt.receiptNumber,
      policyNumber: receipt.policyNumber,
      clientName: receipt.clientName,
      companyName: "Generali",
      commissionDate: receipt.paymentDate,
      planType: receipt.planType,
      commissionCobranca: receipt.commissionCobranca,
      commissionAngariacao: receipt.commissionAngariacao,
      commissionTotal: receipt.commissionCobranca + receipt.commissionAngariacao,
    }))
    .sort((a, b) => (b.commissionDate ?? "").localeCompare(a.commissionDate ?? ""));
}

/*
 * Mapa anual para a contabilidade: agência inteira (todas as lojas e
 * apólices sem loja), por mês de pagamento. Mesmo formato que
 * getZurichMonthlyCommissions. Somado na BD (get_monthly_commissions).
 */
export async function getGeneraliMonthlyCommissions(year: number) {
  await requireAdmin();
  return getMonthlyCommissionsFromDb({
    companyCode: COMPANY_CODE,
    year,
    paidStatusOnly: true,
    // Selo oficial por recibo; nos que não o têm, estimativa de 2%.
    estimateRate: STAMP_DUTY_ESTIMATE_RATE,
  });
}
