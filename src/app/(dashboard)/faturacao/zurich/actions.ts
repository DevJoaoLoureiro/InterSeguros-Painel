"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { assertStoreAccess, requireAdmin } from "@/lib/auth/access";
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
// Imposto de selo sobre comissões de mediação Não Vida.
const ZURICH_STAMP_DUTY_RATE = 0.02;

export async function getAccessibleStores(): Promise<{
  stores: StoreOption[];
  canAccessAll: boolean;
}> {
  // Área da agência: só OWNER/ADMIN (sem lógica de lojas — a loja é
  // só um filtro).
  await requireAdmin();

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

function one<T>(value: T | T[] | null | undefined): T | null {
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
  company: Relation<{ name: string | null; code: string | null }>;
  policy: Relation<{
    id: string;
    policy_number: string | null;
    issuing_store_id: string | null;
    client: Relation<{ name: string | null }>;
    insurance_line: Relation<{ plan_type: string | null }>;
  }>;
  commissions: Relation<{
    amount: number | string | null;
    commission_type: string;
  }>;
};

// O Supabase devolve as relações como objeto ou como lista.
type Relation<T> = T | T[] | null;

type CalculatedZurichCommissionReceipt = {
  receiptId: string;
  receiptNumber: string | null;
  policyNumber: string;
  issuingStoreId: string | null;
  clientName: string;
  companyName: string;
  planType: string | null;
  commissionDate: string | null;
  // Recibo com data de pagamento (comissão efetivamente ganha).
  paid: boolean;
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

    const page = (data ?? []) as unknown as RawZurichCommissionReceipt[];

    for (const row of page) {
      const company = one(row.company);

      if (
        company?.code &&
        String(company.code).toUpperCase() !== COMPANY_CODE
      ) {
        continue;
      }

      const policy = one(row.policy);
      const client = one(policy?.client);
      const line = one(policy?.insurance_line);

      if (!policy?.id) {
        continue;
      }

      const commissions = Array.isArray(row.commissions)
        ? row.commissions
        : row.commissions
          ? [row.commissions]
          : [];

      const commissionCobranca = commissions
        .filter((c) => c.commission_type === "COLLECTION")
        .reduce((sum, c) => sum + Number(c.amount ?? 0), 0);

      const commissionAngariacao = commissions
        .filter((c) => c.commission_type === "ACQUISITION")
        .reduce((sum, c) => sum + Number(c.amount ?? 0), 0);

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
        paid: row.payment_date !== null,
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

  // Total "Geral": tudo o que o utilizador tem acesso a ver, MAIS
  // tudo o que ainda não tem loja atribuída (ex: apólices Zurich
  // por associar) — sem isto, essas comissões não apareciam em
  // lado nenhum, nem sequer contavam para nenhum total.
  const geralTotal = {
    vida: 0,
    naoVida: 0,
    financeiros: 0,
    count: 0,
  };

  for (const receipt of receipts) {
    if (!isInMonth(receipt.commissionDate, monthStart, monthEnd)) {
      continue;
    }

    const storeId = receipt.issuingStoreId;
    const total = receipt.commissionCobranca + receipt.commissionAngariacao;

    const isAccessibleOrUnassigned =
      storeId === null || storeIds.has(storeId);

    if (isAccessibleOrUnassigned) {
      if (receipt.planType === "NAO_VIDA") {
        geralTotal.naoVida += total;
      } else if (receipt.planType === "FINANCEIROS") {
        geralTotal.financeiros += total;
      } else {
        geralTotal.vida += total;
      }
      geralTotal.count += 1;
    }

    // Totais por loja específica continuam a exigir loja conhecida
    // (isto não muda — só o "Geral" acima passou a incluir os
    // sem-loja).
    if (!storeId || !storeIds.has(storeId)) {
      continue;
    }

    const current = totals.get(storeId) ?? {
      vida: 0,
      naoVida: 0,
      financeiros: 0,
      count: 0,
    };

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

  const perStoreRows = stores.map((store) => {
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

  const geralRow: StoreCommissionSummary = {
    storeId: "GERAL",
    storeName: "Geral",
    vidaTotal: geralTotal.vida,
    naoVidaTotal: geralTotal.naoVida,
    financeirosTotal: geralTotal.financeiros,
    totalGeral:
      geralTotal.vida + geralTotal.naoVida + geralTotal.financeiros,
    receiptCount: geralTotal.count,
  };

  return [geralRow, ...perStoreRows];
}

export async function getZurichCommissionsDetail(
  storeId: string,
  month: string,
): Promise<CommissionReceiptRow[]> {
  // "GERAL" já é limitado mais abaixo às lojas acessíveis.
  if (storeId !== "GERAL") await assertStoreAccess(storeId);

  const { monthStart, monthEnd } = getMonthBounds(month);
  const receipts = await getCalculatedZurichCommissionReceipts();
  const rows: CommissionReceiptRow[] = [];

  // "GERAL" mostra tudo a que o utilizador tem acesso, incluindo
  // recibos sem loja atribuída — mesma regra usada no resumo.
  let accessibleStoreIds: Set<string> | null = null;

  if (storeId === "GERAL") {
    const { stores } = await getAccessibleStores();
    accessibleStoreIds = new Set(stores.map((s) => s.id));
  }

  for (const receipt of receipts) {
    if (!isInMonth(receipt.commissionDate, monthStart, monthEnd)) {
      continue;
    }

    if (storeId === "GERAL") {
      const isAccessibleOrUnassigned =
        receipt.issuingStoreId === null ||
        accessibleStoreIds!.has(receipt.issuingStoreId);

      if (!isAccessibleOrUnassigned) {
        continue;
      }
    } else if (receipt.issuingStoreId !== storeId) {
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
/*
 * Mapa anual para a contabilidade: cobrança + angariação da agência
 * inteira (todas as lojas e as apólices sem loja), por mês de
 * pagamento. Só recibos PAGOS: a página da Zurich usa a data de
 * emissão quando não há pagamento e acaba por somar recibos
 * pendentes e anulados — comissões que nunca foram recebidas.
 */
export async function getZurichMonthlyCommissions(
  year: number,
): Promise<
  {
    month: string;
    // Vida inclui os Financeiros (ramo Vida), como na Prévoir.
    vida: { amount: number; receipts: number };
    naoVida: { amount: number; receipts: number };
    // A Zurich não envia o imposto de selo da comissão: estimativa de
    // 2% sobre o Não Vida (verba 17.3.4 da TGIS).
    stampDuty: { amount: number; official: boolean };
  }[]
> {
  await requireAdmin();

  const receipts = await getCalculatedZurichCommissionReceipts();
  const totals = new Map<
    string,
    {
      vida: { amount: number; receipts: number };
      naoVida: { amount: number; receipts: number };
    }
  >();

  for (const receipt of receipts) {
    const month = receipt.commissionDate?.slice(0, 7);

    if (!receipt.paid || !month?.startsWith(`${year}-`)) {
      continue;
    }

    const current = totals.get(month) ?? {
      vida: { amount: 0, receipts: 0 },
      naoVida: { amount: 0, receipts: 0 },
    };
    const bucket =
      receipt.planType === "NAO_VIDA" ? current.naoVida : current.vida;
    bucket.amount +=
      receipt.commissionCobranca + receipt.commissionAngariacao;
    bucket.receipts += 1;
    totals.set(month, current);
  }

  const round = (value: number) => Math.round(value * 100) / 100;

  return Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, "0")}`;
    const current = totals.get(month);

    return {
      month,
      vida: {
        amount: round(current?.vida.amount ?? 0),
        receipts: current?.vida.receipts ?? 0,
      },
      naoVida: {
        amount: round(current?.naoVida.amount ?? 0),
        receipts: current?.naoVida.receipts ?? 0,
      },
      stampDuty: {
        amount: round((current?.naoVida.amount ?? 0) * ZURICH_STAMP_DUTY_RATE),
        official: false,
      },
    };
  });
}
