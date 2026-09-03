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
  situationDate: string | null;
  planType: string | null;
  commissionBruto: number;
  commissionLiquido: number;
};

export type StoreCommissionSummary = {
  storeId: string;
  storeName: string;
  vidaBruto: number;
  naoVidaBruto: number;
  naoVidaRetencao: number;
  naoVidaLiquido: number;
  financeirosBruto: number;
  totalLiquido: number;
  receiptCount: number;
};

export type ParsedCommissionMovementType =
  | "NEW_POLICY"
  | "COMMISSION"
  | "REVERSAL";

export type ParsedCommissionMovement = {
  agentCode: string;
  policyPrefix: string;
  policyNumber: string;
  movementType: ParsedCommissionMovementType;
  grossAmount: number;
  rawLine: string;
};

export type OfficialCommissionMovement = {
  id: string;
  month: string;
  fechoDate: string | null;

  agentCode: string;
  policyPrefix: string;
  policyNumber: string;

  movementType: ParsedCommissionMovementType;
  grossAmount: number;

  rawLine: string | null;
};

export type OfficialClosing = {
  month: string;
  fechoDate: string;
  vidaLiquido: number;
  apBruto: number;
  apRetencao: number;
  apLiquido: number;
  saudeLiquido: number;
  notes: string | null;
};

export type SaveOfficialClosingInput = OfficialClosing & {
  movements?: ParsedCommissionMovement[];
};

export type ParsedClosing = {
  fechoDate: string | null;
  vidaLiquido: number | null;
  apBruto: number | null;
  apRetencao: number | null;
  apLiquido: number | null;
  saudeLiquido: number | null;

  movements: ParsedCommissionMovement[];

  rawTextPreview: string;

  debug: {
  newPolicies: number;
  commissions: number;
  reversals: number;
};
};

export async function getAccessibleStores(): Promise<{
  stores: StoreOption[];
  canAccessAll: boolean;
}> {
  const profile = await getCurrentProfile();

  if (!profile) {
    throw new Error("Não autenticado.");
  }

  const canAccessAll =
    profile.role === "OWNER" || profile.role === "ADMIN";

  const admin = createAdminClient();

  if (canAccessAll) {
    const { data, error } = await admin
      .from("stores")
      .select("id, name")
      .order("name", { ascending: true });

    if (error) {
      throw new Error(`Erro ao carregar lojas: ${error.message}`);
    }

    return {
      stores: data ?? [],
      canAccessAll: true,
    };
  }

  if (!profile.store) {
    return {
      stores: [],
      canAccessAll: false,
    };
  }

  return {
    stores: [
      {
        id: profile.store.id,
        name: profile.store.name,
      },
    ],
    canAccessAll: false,
  };
}

/*
 * ============================================================
 * ESTIMATIVA AUTOMÁTICA PRÉVOIR
 * ============================================================
 *
 * Regra de competência validada contra os fechos oficiais
 * de junho, julho e agosto de 2026:
 *
 * 1) Primeiro recibo COM comissão da apólice, natureza 1,
 *    e period_start = dataInicioApolice:
 *       -> competência = issue_date
 *
 * 2) Restantes movimentos:
 *       -> competência = situation_date
 *
 * 3) Excluir comissão positiva quando cancellation_date
 *    é anterior à situation_date.
 *
 * 4) Excluir PAID positivo que apenas substitui um RETURNED
 *    anterior do mesmo período/valor, quando não existe
 *    REVERSAL intermédio.
 *
 * 5) Excluir RETURNED positivo sem PAID posterior equivalente.
 *
 * NOTA:
 * - Esta lógica foi validada ao cêntimo no BRUTO dos recibos
 *   para 2026-06, 2026-07 e 2026-08.
 * - O líquido continua a usar 2% como estimativa para NÃO VIDA.
 *   O imposto de selo oficial da Prévoir não é sempre exatamente
 *   2% do bruto AP.
 * - Prémios trimestrais/extraordinários não estão no comtot
 *   dos recibos e, por isso, não entram nesta estimativa.
 */

const STAMP_DUTY_RATE = 0.02;
const PAGE_SIZE = 1000;

type RawCommissionReceipt = {
  id: string;
  receipt_number: string | null;
  status: string | null;
  external_nature: string | null;
  issue_date: string | null;
  situation_date: string | null;
  period_start: string | null;
  period_end: string | null;
  cancellation_date: string | null;
  cancellation_reason: string | number | null;
  provider_metadata: Record<string, unknown> | null;
  company: any;
  policy: any;
  commissions: any;
};

type CalculatedCommissionReceipt = {
  receiptId: string;
  receiptNumber: string | null;
  policyId: string;
  policyNumber: string;
  issuingStoreId: string | null;
  clientName: string;
  companyName: string;
  planType: string | null;
  status: string;
  externalNature: string | null;
  issueDate: string | null;
  situationDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  cancellationDate: string | null;
  cancellationReason: string | number | null;
  commissionAmount: number;
  commissionDate: string | null;
  excludeCancelled: boolean;
  excludeReplacement: boolean;
  excludeUnreplacedReturned: boolean;
};

function one<T = any>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function cents(value: number): number {
  return Math.round(value * 100);
}

function movementDate(receipt: {
  situationDate: string | null;
  issueDate: string | null;
}): string | null {
  return receipt.situationDate ?? receipt.issueDate;
}

function parseProviderPolicyStart(
  metadata: Record<string, unknown> | null,
): string | null {
  const raw = metadata?.dataInicioApolice;
  if (raw === null || raw === undefined) {
    return null;
  }

  const value = String(raw).trim();
  if (!/^\d{8}$/.test(value)) {
    return null;
  }

  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function compareNullableDates(
  a: string | null,
  b: string | null,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

function isDateInMonth(
  date: string | null,
  monthStart: string,
  monthEnd: string,
): boolean {
  return Boolean(date && date >= monthStart && date < monthEnd);
}

async function getRawPrevoirCommissionReceipts(): Promise<RawCommissionReceipt[]> {
  const admin = createAdminClient();
  const rows: RawCommissionReceipt[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await admin
      .from("receipts")
      .select(`
        id,
        receipt_number,
        status,
        external_nature,
        issue_date,
        situation_date,
        period_start,
        period_end,
        cancellation_date,
        cancellation_reason,
        provider_metadata,

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
      .eq("commissions.commission_type", "TOTAL")
      .range(from, to);

    if (error) {
      throw new Error(`Erro ao carregar comissões Prévoir: ${error.message}`);
    }

    const page = (data ?? []) as RawCommissionReceipt[];

    for (const row of page) {
      const company = one<any>(row.company);

      if (
        company?.code &&
        String(company.code).toUpperCase() !== "PREVOIR"
      ) {
        continue;
      }

      rows.push(row);
    }

    if (page.length < PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

async function getCalculatedCommissionReceipts(): Promise<CalculatedCommissionReceipt[]> {
  const rawRows = await getRawPrevoirCommissionReceipts();

  const base = rawRows
    .map((row) => {
      const company = one<any>(row.company);
      const policy = one<any>(row.policy);
      const client = one<any>(policy?.client);
      const line = one<any>(policy?.insurance_line);

      const commissions = Array.isArray(row.commissions)
        ? row.commissions
        : row.commissions
          ? [row.commissions]
          : [];

      const commissionAmount = commissions
        .filter((commission: any) => commission.commission_type === "TOTAL")
        .reduce(
          (sum: number, commission: any) =>
            sum + Number(commission.amount ?? 0),
          0,
        );

      if (!policy?.id || commissionAmount === 0) {
        return null;
      }

      return {
        receiptId: row.id,
        receiptNumber: row.receipt_number,
        policyId: String(policy.id),
        policyNumber: String(policy.policy_number ?? ""),
        issuingStoreId: policy.issuing_store_id ?? null,
        clientName: client?.name ?? "Cliente",
        companyName: company?.name ?? "Prévoir",
        planType: line?.plan_type ?? null,
        status: String(row.status ?? "").toUpperCase(),
        externalNature:
          row.external_nature === null || row.external_nature === undefined
            ? null
            : String(row.external_nature),
        issueDate: row.issue_date,
        situationDate: row.situation_date,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        cancellationDate: row.cancellation_date,
        cancellationReason: row.cancellation_reason,
        providerMetadata: row.provider_metadata ?? null,
        commissionAmount,
      };
    })
    .filter(Boolean) as Array<{
      receiptId: string;
      receiptNumber: string | null;
      policyId: string;
      policyNumber: string;
      issuingStoreId: string | null;
      clientName: string;
      companyName: string;
      planType: string | null;
      status: string;
      externalNature: string | null;
      issueDate: string | null;
      situationDate: string | null;
      periodStart: string | null;
      periodEnd: string | null;
      cancellationDate: string | null;
      cancellationReason: string | number | null;
      providerMetadata: Record<string, unknown> | null;
      commissionAmount: number;
    }>;

  const byPolicy = new Map<string, typeof base>();

  for (const receipt of base) {
    const list = byPolicy.get(receipt.policyId) ?? [];
    list.push(receipt);
    byPolicy.set(receipt.policyId, list);
  }

  const firstCommissionReceiptId = new Map<string, string>();

  for (const [policyId, receipts] of byPolicy) {
    receipts.sort((a, b) => {
      const dateCompare = compareNullableDates(a.issueDate, b.issueDate);
      if (dateCompare !== 0) {
        return dateCompare;
      }
      return (a.receiptNumber ?? "").localeCompare(b.receiptNumber ?? "");
    });

    if (receipts[0]) {
      firstCommissionReceiptId.set(policyId, receipts[0].receiptId);
    }
  }

  const classified = base.map((receipt) => {
    const policyStart = parseProviderPolicyStart(receipt.providerMetadata);

    const isInitialCommission =
      receipt.externalNature === "1" &&
      receipt.periodStart !== null &&
      policyStart !== null &&
      receipt.periodStart === policyStart &&
      firstCommissionReceiptId.get(receipt.policyId) === receipt.receiptId;

    const commissionDate = isInitialCommission
      ? receipt.issueDate
      : receipt.situationDate;

    return {
      ...receipt,
      commissionDate,
    };
  });

  return classified.map((receipt) => {
    const amount = receipt.commissionAmount;
    const currentMovementDate = movementDate(receipt);

    const excludeCancelled =
      amount > 0 &&
      receipt.cancellationDate !== null &&
      receipt.situationDate !== null &&
      receipt.cancellationDate < receipt.situationDate;

    const excludeReplacement =
      amount > 0 &&
      receipt.status === "PAID" &&
      classified.some((previous) => {
        if (
          previous.policyId !== receipt.policyId ||
          previous.periodStart !== receipt.periodStart ||
          previous.periodEnd !== receipt.periodEnd ||
          cents(previous.commissionAmount) !== cents(amount) ||
          previous.status !== "RETURNED"
        ) {
          return false;
        }

        const previousMovementDate = movementDate(previous);
        if (
          !previousMovementDate ||
          !currentMovementDate ||
          previousMovementDate >= currentMovementDate
        ) {
          return false;
        }

        const hasReversalBetween = classified.some((reversal) => {
          if (
            reversal.policyId !== receipt.policyId ||
            reversal.periodStart !== receipt.periodStart ||
            reversal.periodEnd !== receipt.periodEnd
          ) {
            return false;
          }

          if (
            reversal.externalNature !== "9" &&
            reversal.commissionAmount >= 0
          ) {
            return false;
          }

          const reversalMovementDate = movementDate(reversal);
          return Boolean(
            reversalMovementDate &&
              reversalMovementDate > previousMovementDate &&
              reversalMovementDate < currentMovementDate,
          );
        });

        return !hasReversalBetween;
      });

    const excludeUnreplacedReturned =
      amount > 0 &&
      receipt.status === "RETURNED" &&
      !classified.some((next) => {
        if (
          next.policyId !== receipt.policyId ||
          next.periodStart !== receipt.periodStart ||
          next.periodEnd !== receipt.periodEnd ||
          cents(next.commissionAmount) !== cents(amount) ||
          next.status !== "PAID"
        ) {
          return false;
        }

        const nextMovementDate = movementDate(next);
        return Boolean(
          nextMovementDate &&
            currentMovementDate &&
            nextMovementDate > currentMovementDate,
        );
      });

    return {
      receiptId: receipt.receiptId,
      receiptNumber: receipt.receiptNumber,
      policyId: receipt.policyId,
      policyNumber: receipt.policyNumber,
      issuingStoreId: receipt.issuingStoreId,
      clientName: receipt.clientName,
      companyName: receipt.companyName,
      planType: receipt.planType,
      status: receipt.status,
      externalNature: receipt.externalNature,
      issueDate: receipt.issueDate,
      situationDate: receipt.situationDate,
      periodStart: receipt.periodStart,
      periodEnd: receipt.periodEnd,
      cancellationDate: receipt.cancellationDate,
      cancellationReason: receipt.cancellationReason,
      commissionAmount: receipt.commissionAmount,
      commissionDate: receipt.commissionDate,
      excludeCancelled,
      excludeReplacement,
      excludeUnreplacedReturned,
    };
  });
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

function includeCommissionInMonth(
  receipt: CalculatedCommissionReceipt,
  monthStart: string,
  monthEnd: string,
): boolean {
  return (
    isDateInMonth(receipt.commissionDate, monthStart, monthEnd) &&
    !receipt.excludeCancelled &&
    !receipt.excludeReplacement &&
    !receipt.excludeUnreplacedReturned
  );
}

export async function getCommissionsSummaryByStore(
  month: string,
): Promise<StoreCommissionSummary[]> {
  const { stores } = await getAccessibleStores();
  if (stores.length === 0) {
    return [];
  }

  const { monthStart, monthEnd } = getMonthBounds(month);
  const receipts = await getCalculatedCommissionReceipts();
  const storeIds = new Set(stores.map((store) => store.id));

  const totals = new Map<
    string,
    {
      vidaBruto: number;
      naoVidaBruto: number;
      financeirosBruto: number;
      count: number;
    }
  >();

  for (const receipt of receipts) {
    if (!includeCommissionInMonth(receipt, monthStart, monthEnd)) {
      continue;
    }

    const storeId = receipt.issuingStoreId;
    if (!storeId || !storeIds.has(storeId)) {
      continue;
    }

    const current = totals.get(storeId) ?? {
      vidaBruto: 0,
      naoVidaBruto: 0,
      financeirosBruto: 0,
      count: 0,
    };

    if (receipt.planType === "NAO_VIDA") {
      current.naoVidaBruto += receipt.commissionAmount;
    } else if (receipt.planType === "FINANCEIROS") {
      current.financeirosBruto += receipt.commissionAmount;
    } else {
      current.vidaBruto += receipt.commissionAmount;
    }

    current.count += 1;
    totals.set(storeId, current);
  }

  return stores.map((store) => {
    const current = totals.get(store.id) ?? {
      vidaBruto: 0,
      naoVidaBruto: 0,
      financeirosBruto: 0,
      count: 0,
    };

    const naoVidaRetencao = current.naoVidaBruto * STAMP_DUTY_RATE;
    const naoVidaLiquido = current.naoVidaBruto - naoVidaRetencao;

    return {
      storeId: store.id,
      storeName: store.name,
      vidaBruto: current.vidaBruto,
      naoVidaBruto: current.naoVidaBruto,
      naoVidaRetencao,
      naoVidaLiquido,
      financeirosBruto: current.financeirosBruto,
      totalLiquido:
        current.vidaBruto +
        naoVidaLiquido +
        current.financeirosBruto,
      receiptCount: current.count,
    };
  });
}

export async function getCommissionsDetail(
  storeId: string,
  month: string,
): Promise<CommissionReceiptRow[]> {
  const { monthStart, monthEnd } = getMonthBounds(month);
  const receipts = await getCalculatedCommissionReceipts();
  const rows: CommissionReceiptRow[] = [];

  for (const receipt of receipts) {
    if (
      receipt.issuingStoreId !== storeId ||
      !includeCommissionInMonth(receipt, monthStart, monthEnd)
    ) {
      continue;
    }

    const commissionBruto = receipt.commissionAmount;
    const commissionLiquido =
      receipt.planType === "NAO_VIDA"
        ? commissionBruto * (1 - STAMP_DUTY_RATE)
        : commissionBruto;

    rows.push({
      receiptId: receipt.receiptId,
      receiptNumber: receipt.receiptNumber,
      policyNumber: receipt.policyNumber,
      clientName: receipt.clientName,
      companyName: receipt.companyName,
      situationDate: receipt.commissionDate,
      planType: receipt.planType,
      commissionBruto,
      commissionLiquido,
    });
  }

  return rows.sort((a, b) =>
    (b.situationDate ?? "").localeCompare(a.situationDate ?? ""),
  );
}

/*
 * ============================================================
 * FECHO OFICIAL
 * ============================================================
 */

export async function getOfficialClosing(
  month: string,
): Promise<OfficialClosing | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("prevoir_commission_closings")
    .select(`
      month,
      fecho_date,
      vida_liquido,
      ap_bruto,
      ap_retencao,
      ap_liquido,
      saude_liquido,
      notes
    `)
    .eq("month", month)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Erro ao carregar fecho oficial: ${error.message}`,
    );
  }

  if (!data) {
    return null;
  }

  return {
    month: data.month,
    fechoDate: data.fecho_date,

    vidaLiquido: Number(data.vida_liquido),

    apBruto: Number(data.ap_bruto),
    apRetencao: Number(data.ap_retencao),
    apLiquido: Number(data.ap_liquido),

    saudeLiquido: Number(data.saude_liquido),

    notes: data.notes,
  };
}

/*
 * Movimentos oficiais extraídos do PDF.
 */
export async function getOfficialCommissionMovements(
  month: string,
): Promise<OfficialCommissionMovement[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("prevoir_commission_movements")
    .select(`
      id,
      month,
      fecho_date,
      agent_code,
      policy_prefix,
      policy_number,
      movement_type,
      gross_amount,
      raw_line
    `)
    .eq("month", month)
    .order("agent_code", { ascending: true })
    .order("policy_prefix", { ascending: true })
    .order("policy_number", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(
      `Erro ao carregar movimentos oficiais: ${error.message}`,
    );
  }

  return ((data ?? []) as any[]).map((row) => ({
    id: row.id,
    month: row.month,

    fechoDate: row.fecho_date,

    agentCode: row.agent_code,
    policyPrefix: row.policy_prefix,
    policyNumber: row.policy_number,

    movementType:
      row.movement_type as ParsedCommissionMovementType,

    grossAmount: Number(row.gross_amount),

    rawLine: row.raw_line,
  }));
}

export async function saveOfficialClosing(
  input: SaveOfficialClosingInput,
): Promise<{ success: true }> {
  const profile = await getCurrentProfile();

  if (!profile) {
    throw new Error("Não autenticado.");
  }

  if (
    profile.role !== "OWNER" &&
    profile.role !== "ADMIN"
  ) {
    throw new Error(
      "Só OWNER ou ADMIN podem registar o fecho oficial.",
    );
  }

  const admin = createAdminClient();

  /*
   * 1. Guardar resumo oficial.
   */
  const { error: closingError } = await admin
    .from("prevoir_commission_closings")
    .upsert(
      {
        month: input.month,

        fecho_date: input.fechoDate,

        vida_liquido: input.vidaLiquido,

        ap_bruto: input.apBruto,
        ap_retencao: input.apRetencao,
        ap_liquido: input.apLiquido,

        saude_liquido: input.saudeLiquido,

        notes: input.notes,

        created_by: profile.id,

        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "month",
      },
    );

  if (closingError) {
    throw new Error(
      `Erro ao guardar fecho oficial: ${closingError.message}`,
    );
  }

  /*
   * 2. Se o fecho veio de um PDF e temos movimentos,
   * substituir os movimentos desse mês.
   *
   * Fazemos DELETE + INSERT porque a mesma apólice
   * pode aparecer várias vezes no mesmo fecho.
   */
  if (input.movements) {
    const { error: deleteError } = await admin
      .from("prevoir_commission_movements")
      .delete()
      .eq("month", input.month);

    if (deleteError) {
      throw new Error(
        `Erro ao limpar movimentos antigos: ${deleteError.message}`,
      );
    }

    if (input.movements.length > 0) {
      const rows = input.movements.map((movement) => ({
        month: input.month,

        fecho_date: input.fechoDate,

        agent_code: movement.agentCode,

        policy_prefix: movement.policyPrefix,
        policy_number: movement.policyNumber,

        movement_type: movement.movementType,

        gross_amount:
          movement.movementType === "REVERSAL"
            ? -Math.abs(movement.grossAmount)
            : Math.abs(movement.grossAmount),

        raw_line: movement.rawLine,
      }));

      const { error: movementsError } = await admin
        .from("prevoir_commission_movements")
        .insert(rows);

      if (movementsError) {
        throw new Error(
          `Fecho guardado, mas ocorreu um erro ao guardar os movimentos: ${movementsError.message}`,
        );
      }
    }
  }

  return {
    success: true,
  };
}

/*
 * ============================================================
 * PDF
 * ============================================================
 */

function parsePortugueseNumber(
  raw: string,
): number | null {
  const cleaned = raw
    .trim()
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".");

  const value = Number(cleaned);

  return Number.isFinite(value)
    ? value
    : null;
}

function extractValue(
  text: string,
  label: string,
): number | null {
  const escapedLabel = label.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );

  const regex = new RegExp(
    `${escapedLabel}\\s*([\\d.,]+)\\s*€`,
    "i",
  );

  const match = text.match(regex);

  if (!match) {
    return null;
  }

  return parsePortugueseNumber(match[1]);
}



type PolicyRef = {
  agentCode: string;
  policyPrefix: string;
  policyNumber: string;
};


function normalizePdfLine(line: string) {
  return line
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .trim();
}

function extractEuroValues(line: string): number[] {
  const values: number[] = [];

  /*
   * Apanha:
   * 25,00 €
   * 1.234,56 €
   * -39,80 €
   */
  const regex =
    /(-?\d+(?:\.\d{3})*,\d{2})\s*€/g;

  for (const match of line.matchAll(regex)) {
    const value =
      parsePortugueseNumber(match[1]);

    if (value !== null) {
      values.push(value);
    }
  }

  return values;
}

function extractCommissionMovements(
  text: string,
): ParsedCommissionMovement[] {
  const movements: ParsedCommissionMovement[] = [];

  const lines = text
    .split("\n")
    .map(normalizePdfLine)
    .filter(Boolean);

  let currentType:
    | ParsedCommissionMovementType
    | null = null;

  for (const line of lines) {
    /*
     * IMPORTANTE:
     * Verificar ESTORNOS antes de "1ºs Prémios",
     * porque o título dos estornos também contém
     * a expressão "1ºs Prémios".
     */

    if (
      /Estornos de 1[ºo]s Pr[eé]mios/i.test(line)
    ) {
      currentType = "REVERSAL";
      continue;
    }

    if (
      /Ap[oó]lices Novas\s*-\s*Comiss/i.test(line)
    ) {
      currentType = "NEW_POLICY";
      continue;
    }

    if (
      /1[ºo]s Pr[eé]mios Novos,\s*Continuados/i.test(
        line,
      )
    ) {
      currentType = "COMMISSION";
      continue;
    }

    if (!currentType) {
      continue;
    }

    /*
     * O pdf-parse cola as colunas:
     *
     * 1080650/00007084128,60 €...
     *
     * Portanto:
     * 10806 = agente
     * 50 = prefixo
     * 00007084 = nº apólice
     *
     * Também aceita PDFs onde haja espaços:
     * 10806 50/00007084 ...
     */
    const policyMatch = line.match(
      /^(\d{5})\s*(\d{2})\/(\d{8})(.*)$/,
    );

    if (!policyMatch) {
      continue;
    }

    const agentCode =
      policyMatch[1];

    const policyPrefix =
      policyMatch[2];

    const rawPolicyNumber =
      policyMatch[3];

    const restOfLine =
      policyMatch[4];

    const policyNumber =
      rawPolicyNumber.replace(/^0+/, "") || "0";

    /*
     * Exemplos:
     *
     * Apólice nova:
     * 128,60 € 10,72 € ... 0,00% 25,72 € --
     *
     * => [128.60, 10.72, 25.72]
     *
     * Comissão normal:
     * 25,00 € ... 0,15 € --
     *
     * => [25.00, 0.15]
     *
     * Estorno:
     * 31,07 € 31,07 € ... -39,80 € --
     *
     * => [31.07, 31.07, -39.80]
     *
     * A última quantia em euros é "Com. Real."
     */
    const euroValues =
      extractEuroValues(restOfLine);

    if (euroValues.length === 0) {
      continue;
    }

    const rawGrossAmount =
      euroValues[euroValues.length - 1];

    const grossAmount =
      currentType === "REVERSAL"
        ? -Math.abs(rawGrossAmount)
        : Math.abs(rawGrossAmount);

    movements.push({
      agentCode,
      policyPrefix,
      policyNumber,
      movementType: currentType,
      grossAmount,

      /*
       * Guardamos a linha original para auditoria/debug.
       */
      rawLine: line,
    });
  }

  return movements;
}





export async function parseOfficialClosingPdf(
  formData: FormData,
): Promise<ParsedClosing> {
  const profile = await getCurrentProfile();

  if (!profile) {
    throw new Error("Não autenticado.");
  }

  if (
    profile.role !== "OWNER" &&
    profile.role !== "ADMIN"
  ) {
    throw new Error(
      "Só OWNER ou ADMIN podem importar o fecho oficial.",
    );
  }

  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new Error("Nenhum ficheiro enviado.");
  }

  if (file.type !== "application/pdf") {
    throw new Error(
      "O ficheiro tem de ser um PDF.",
    );
  }

  const arrayBuffer =
    await file.arrayBuffer();

  const buffer =
    Buffer.from(arrayBuffer);

  // @ts-expect-error — pdf-parse não tem tipos para este caminho interno
  const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;

  const parsed =
    await pdfParse(buffer);

  const text =
    parsed.text;

  /*
   * Data oficial do fecho.
   */
  const dateMatch = text.match(
    /Fecho de Comiss(?:õ|o)es\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/i,
  );

  const fechoDate = dateMatch
    ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
    : null;

  /*
   * Resumo oficial.
   */
  const vidaLiquido = extractValue(
    text,
    "Total líquido a pagar Vida",
  );

  const apBruto = extractValue(
    text,
    "Total bruto calculado AP",
  );

  const apRetencaoMatch = text.match(
    /Retenção\s*\(Imposto Selo[^)]*\)\s*AP\s*([\d.,]+)\s*€/i,
  );

  const apRetencao =
    apRetencaoMatch
      ? parsePortugueseNumber(
          apRetencaoMatch[1],
        )
      : null;

  const apLiquido = extractValue(
    text,
    "Total líquido a pagar AP",
  );

  const saudeBlockMatch = text.match(
    /RESUMO MENSAL SAÚDE([\s\S]*?)(?:RESUMO MENSAL|Referência Comercial|$)/i,
  );

  const saudeLiquido =
    saudeBlockMatch
      ? extractValue(
          saudeBlockMatch[1],
          "Total a pagar",
        )
      : null;

  /*
   * Linhas detalhadas que compõem o fecho.
   */
  const movements =
  extractCommissionMovements(text);

const debug = {
  newPolicies: movements.filter(
    (movement) =>
      movement.movementType ===
      "NEW_POLICY",
  ).length,

  commissions: movements.filter(
    (movement) =>
      movement.movementType ===
      "COMMISSION",
  ).length,

  reversals: movements.filter(
    (movement) =>
      movement.movementType ===
      "REVERSAL",
  ).length,
};

  return {
  fechoDate,

  vidaLiquido,
  apBruto,
  apRetencao,
  apLiquido,
  saudeLiquido,

  movements,

  debug,

  rawTextPreview:
    text.slice(0, 3000),
};
}