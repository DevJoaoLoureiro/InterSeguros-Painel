"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import {
  summarizeCommissions,
  type CommissionRow,
  type CommissionSummary,
} from "@/lib/insurance/commissions";
import {
  getPoliciesRoles,
  type PolicyRolesData,
} from "@/app/(dashboard)/clientes/policy-roles-action";
import type { PolicyRow } from "@/components/clientes/types";
import { getCachedInsuranceLines } from "@/lib/cache/reference-data";
import {
  detectPolicyTransfers,
  type PolicyTransferInfo,
} from "@/lib/policies/policy-transfers";
import {
  computeClientAdvice,
  type ClientAdvice,
} from "@/lib/opportunities/client-advice";
import {
  loadClientProfile,
  type ClientProfile,
} from "@/lib/clients/load-client-profile";
import {
  assertClientAccess,
  assertReceiptAccess,
} from "@/lib/auth/access";

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

  // Comparação com o recibo válido anterior da mesma apólice.
  previous_commercial_premium: number | null;
  premium_change_pct: number | null;
  premium_increase_alert: boolean;
};

type NormalizedReceipt = PolicyReceiptRow;

function getReceiptComparisonDate(receipt: NormalizedReceipt): string {
  return (
    receipt.period_start ??
    receipt.issue_date ??
    receipt.due_date ??
    receipt.period_end ??
    ""
  );
}

/*
 * Recibos de UMA apólice específica, para
 * mostrar no painel de detalhe.
 *
 * Estorno é detetado da mesma forma que no
 * resto do sistema: external_nature === "9"
 * OU receipt_type contém ESTORNO/REVERSAL,
 * independentemente do status.
 *
 * Para cada recibo válido calculamos ainda:
 * - prémio comercial do recibo anterior;
 * - variação percentual;
 * - alerta quando o aumento é superior a 5%.
 *
 * Sem verificação de acesso: só depois de o chamador validar.
 */
async function loadPolicyReceipts(
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

  const normalized: NormalizedReceipt[] = (data ?? []).map((row) => {
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
        row.total_premium === null
          ? null
          : Number(row.total_premium),
      external_nature: row.external_nature,
      cancellation_reason: row.cancellation_reason,
      isReversal,
      previous_commercial_premium: null,
      premium_change_pct: null,
      premium_increase_alert: false,
    };
  });

  /*
   * A query devolve os recibos mais recentes primeiro.
   * Para calcular corretamente "recibo anterior", criamos
   * uma cópia ordenada cronologicamente do mais antigo
   * para o mais recente.
   *
   * Como os objetos são os mesmos, os valores calculados
   * ficam também disponíveis no array `normalized`, que
   * continua na ordem original usada pela UI.
   */
  const chronologicalReceipts = [...normalized]
    .filter((receipt) => !receipt.isReversal)
    .sort((a, b) => {
      const aDate = getReceiptComparisonDate(a);
      const bDate = getReceiptComparisonDate(b);

      if (aDate === bDate) {
        return a.id.localeCompare(b.id);
      }

      return aDate.localeCompare(bDate);
    });

  let previousPremium: number | null = null;

  for (const receipt of chronologicalReceipts) {
    const currentPremium = receipt.commercial_premium;

    if (
      currentPremium !== null &&
      Number.isFinite(currentPremium) &&
      previousPremium !== null &&
      previousPremium > 0
    ) {
      const changePct =
        ((currentPremium - previousPremium) / previousPremium) * 100;

      receipt.previous_commercial_premium = previousPremium;
      receipt.premium_change_pct = changePct;
      receipt.premium_increase_alert = changePct > 5;
    }

    /*
     * Só atualizamos a referência quando o recibo tem
     * um prémio comercial válido.
     */
    if (
      currentPremium !== null &&
      Number.isFinite(currentPremium) &&
      currentPremium >= 0
    ) {
      previousPremium = currentPremium;
    }
  }

  return normalized;
}

// ============================================================
// DETALHE DE UM RECIBO
// ============================================================

export type ReceiptDetail = {
  id: string;
  receipt_number: string | null;
  receipt_type: string | null;
  status: string;
  isReversal: boolean;

  period_start: string | null;
  period_end: string | null;
  issue_date: string | null;
  due_date: string | null;
  payment_date: string | null;
  situation_date: string | null;
  cancellation_date: string | null;
  cancellation_reason: string | null;

  commercial_premium: number | null;
  total_premium: number | null;

  payment_method: string | null;
  external_payment_method: string | null;

  commissions: CommissionSummary | null;

  company_name: string | null;
  company_code: string | null;
  policy_number: string | null;
  product_name: string | null;
  line_name: string | null;
  client_name: string | null;
  client_nif: string | null;

  collected_by: string | null;
  collection_store: string | null;
  notes: string | null;
  last_synced_at: string | null;

  // Campos extra que cada companhia envia (já com rótulo legível).
  provider_details: { label: string; value: string }[];
};

function toNumber(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}

function first<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/*
 * Campos do provider_metadata que interessam ao utilizador,
 * com rótulo em português. O resto (ids internos) fica de fora.
 */
const PROVIDER_FIELDS: { key: string; label: string }[] = [
  { key: "tipo", label: "Tipo" },
  { key: "fracionamento", label: "Fracionamento" },
  { key: "modalidadeDescricao", label: "Modalidade" },
  { key: "ramo", label: "Ramo" },
  { key: "tipoComissao", label: "Tipo de comissão" },
  { key: "agenteAngariador", label: "Agente angariador" },
  { key: "agenteCobrador", label: "Agente cobrador" },
  { key: "tipoAgenteCobrador", label: "Tipo de cobrador" },
  { key: "numeroBoletim", label: "Nº boletim" },
  { key: "motivoDevolucao", label: "Motivo de devolução" },
];

const RECEIPT_DETAIL_SELECT = `
  id,
  receipt_number,
  receipt_type,
  status,
  period_start,
  period_end,
  issue_date,
  due_date,
  payment_date,
  situation_date,
  cancellation_date,
  cancellation_reason,
  commercial_premium,
  total_premium,
  payment_method,
  external_payment_method,
  external_nature,
  commission_total,
  commission_acquisition,
  commission_collection,
  commission_brokerage,
  commission_other,
  commission_type,
  collected_by_user_id,
  collection_store_id,
  notes,
  last_synced_at,
  provider_metadata,
  company:companies ( name, code ),
  policy:policies (
    policy_number,
    product_name,
    insurance_line:insurance_lines ( name ),
    client:clients ( name, nif )
  )
`;

type Relation<T> = T | T[] | null;

const COMMISSIONS_CHUNK = 150;

type ReceiptDetailRow = {
  id: string;
  receipt_number: string | null;
  receipt_type: string | null;
  status: string;
  period_start: string | null;
  period_end: string | null;
  issue_date: string | null;
  due_date: string | null;
  payment_date: string | null;
  situation_date: string | null;
  cancellation_date: string | null;
  cancellation_reason: string | null;
  commercial_premium: number | string | null;
  total_premium: number | string | null;
  payment_method: string | null;
  external_payment_method: string | null;
  external_nature: string | null;
  commission_total: number | string | null;
  commission_acquisition: number | string | null;
  commission_collection: number | string | null;
  commission_brokerage: number | string | null;
  commission_other: number | string | null;
  commission_type: string | null;
  collected_by_user_id: string | null;
  collection_store_id: string | null;
  notes: string | null;
  last_synced_at: string | null;
  provider_metadata: Record<string, unknown> | null;
  company: Relation<{ name: string; code: string }>;
  policy: Relation<{
    policy_number: string;
    product_name: string | null;
    insurance_line: Relation<{ name: string }>;
    client: Relation<{ name: string; nif: string | null }>;
  }>;
};

/*
 * Detalhe completo de recibos em lote: os recibos, as comissões de
 * todos eles e os nomes de cobrador/loja — 2 a 3 consultas no total,
 * seja 1 recibo ou a apólice inteira.
 */
async function loadReceiptDetails(
  filter: { receiptId: string } | { policyIds: string[] },
): Promise<ReceiptDetail[]> {
  const supabase = createAdminClient();

  if ("policyIds" in filter && filter.policyIds.length === 0) {
    return [];
  }

  const base = supabase.from("receipts").select(RECEIPT_DETAIL_SELECT);

  const { data, error } =
    "receiptId" in filter
      ? await base.eq("id", filter.receiptId)
      : await base.in("policy_id", filter.policyIds);

  if (error) {
    throw new Error(`Erro ao carregar recibos: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as ReceiptDetailRow[];

  if (rows.length === 0) {
    return [];
  }

  const userIds = Array.from(
    new Set(rows.map((r) => r.collected_by_user_id).filter(Boolean)),
  ) as string[];
  const storeIds = Array.from(
    new Set(rows.map((r) => r.collection_store_id).filter(Boolean)),
  ) as string[];

  // Comissões em blocos: muitos ids num só "in" passam o limite do URL.
  const receiptIdChunks: string[][] = [];

  for (let i = 0; i < rows.length; i += COMMISSIONS_CHUNK) {
    receiptIdChunks.push(rows.slice(i, i + COMMISSIONS_CHUNK).map((r) => r.id));
  }

  const [commissionChunks, usersResult, storesResult] = await Promise.all([
    Promise.all(
      receiptIdChunks.map((chunk) =>
        supabase
          .from("receipt_commissions")
          .select("receipt_id, commission_type, amount, external_type")
          .in("receipt_id", chunk),
      ),
    ),
    userIds.length > 0
      ? supabase.from("profiles").select("id, full_name").in("id", userIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    storeIds.length > 0
      ? supabase.from("stores").select("id, name").in("id", storeIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const commissionsByReceipt = new Map<string, CommissionRow[]>();

  for (const row of commissionChunks.flatMap((chunk) => chunk.data ?? [])) {
    commissionsByReceipt.set(row.receipt_id, [
      ...(commissionsByReceipt.get(row.receipt_id) ?? []),
      row,
    ]);
  }

  const userNames = new Map(
    (usersResult.data ?? []).map((u) => [u.id, u.full_name]),
  );
  const storeNames = new Map(
    (storesResult.data ?? []).map((s) => [s.id, s.name]),
  );

  return rows.map((row) => {
    // Comissões: tabela receipt_commissions; as colunas commission_*
    // do recibo ficam como alternativa (hoje estão vazias).
    const commissions =
      summarizeCommissions(commissionsByReceipt.get(row.id) ?? []) ??
      summarizeCommissions(
        [
          { commission_type: "TOTAL", amount: row.commission_total },
          { commission_type: "ACQUISITION", amount: row.commission_acquisition },
          { commission_type: "COLLECTION", amount: row.commission_collection },
          { commission_type: "BROKERAGE", amount: row.commission_brokerage },
          { commission_type: "OTHER", amount: row.commission_other },
        ]
          .filter((c) => c.amount !== null && c.amount !== undefined)
          .map((c) => ({ ...c, external_type: row.commission_type })),
      );

    const company = first(row.company);
    const policy = first(row.policy);
    const client = first(policy?.client);

    const metadata = row.provider_metadata ?? {};

    const providerDetails = PROVIDER_FIELDS.flatMap(({ key, label }) => {
      const value = metadata[key];

      if (
        value === null ||
        value === undefined ||
        String(value).trim() === ""
      ) {
        return [];
      }

      return [{ label, value: String(value).trim() }];
    });

    const receiptType = (row.receipt_type ?? "").toUpperCase();

    return {
      id: row.id,
      receipt_number: row.receipt_number,
      receipt_type: row.receipt_type,
      status: row.status,
      isReversal:
        row.external_nature === "9" ||
        receiptType.includes("ESTORNO") ||
        receiptType.includes("REVERSAL"),

      period_start: row.period_start,
      period_end: row.period_end,
      issue_date: row.issue_date,
      due_date: row.due_date,
      payment_date: row.payment_date,
      situation_date: row.situation_date,
      cancellation_date: row.cancellation_date,
      // A Prévoir manda "0" quando não há motivo.
      cancellation_reason:
        row.cancellation_reason && row.cancellation_reason !== "0"
          ? row.cancellation_reason
          : null,

      commercial_premium: toNumber(row.commercial_premium),
      total_premium: toNumber(row.total_premium),

      payment_method: row.payment_method,
      external_payment_method: row.external_payment_method,

      commissions,

      company_name: company?.name ?? null,
      company_code: company?.code ?? null,
      policy_number: policy?.policy_number ?? null,
      product_name: policy?.product_name ?? null,
      line_name: first(policy?.insurance_line)?.name ?? null,
      client_name: client?.name ?? null,
      client_nif: client?.nif ?? null,

      collected_by: row.collected_by_user_id
        ? userNames.get(row.collected_by_user_id) ?? null
        : null,
      collection_store: row.collection_store_id
        ? storeNames.get(row.collection_store_id) ?? null
        : null,
      notes: row.notes,
      last_synced_at: row.last_synced_at,

      provider_details: providerDetails,
    };
  });
}

export async function getReceiptDetail(
  receiptId: string,
): Promise<ReceiptDetail> {
  await assertReceiptAccess(receiptId);

  const [detail] = await loadReceiptDetails({ receiptId });

  if (!detail) {
    throw new Error("Recibo não encontrado.");
  }

  return detail;
}

/*
 * Tudo o que o painel de um cliente precisa, num só pedido:
 * - todas as apólices do NIF (não só as que a lista da carteira
 *   mostrou, que podem vir filtradas);
 * - recibos de todas as apólices + detalhe de cada recibo (abrir um
 *   recibo fica instantâneo);
 * - intervenientes de cada apólice.
 *
 * Um só pedido importa: o Next corre as server actions de um
 * cliente uma de cada vez, por isso chamadas separadas somavam os
 * tempos.
 */
export type ClientPanelData = {
  policies: PolicyRow[];
  receiptsByPolicy: Record<string, PolicyReceiptRow[]>;
  details: Record<string, ReceiptDetail>;
  roles: Record<string, PolicyRolesData>;
  rolesError: string | null;
  // Anuladas/devolvidas: para onde foi o seguro (ou de onde veio).
  transfers: Record<string, PolicyTransferInfo>;
  // Ficha do cliente (aba "Dados do cliente") — vem já aqui para
  // a aba não precisar de outro pedido.
  profile: ClientProfile | null;
  // Conselhos da lâmpada (já sem os dispensados).
  advice: ClientAdvice[];
};

const CLIENT_POLICY_SELECT = `
  id,
  client_id,
  external_id,
  policy_number,
  product_code,
  product_name,
  status,
  issue_date,
  start_date,
  end_date,
  renewal_date,
  cancellation_date,
  commercial_premium,
  total_premium,
  annualized_premium,
  payment_frequency,
  origin,
  commercial_user_id,
  issued_by_user_id,
  issuing_store_id,
  provider_metadata,
  last_synced_at,
  created_at,
  company:companies ( id, code, name ),
  insurance_line:insurance_lines ( id, code, name, plan_type ),
  commercial_user:profiles!policies_commercial_user_id_fkey ( id, full_name ),
  issuing_store:stores ( id, name )
`;

const STATUS_ORDER: Record<string, number> = {
  ACTIVE: 0,
  PENDING: 1,
  SUSPENDED: 2,
  REDUCED: 3,
  UNKNOWN: 4,
  EXPIRED: 5,
  CANCELLED: 6,
};

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getClientPanel(
  clientId: string,
): Promise<ClientPanelData> {
  if (!(await getCurrentProfile())) {
    throw new Error("Não autenticado.");
  }

  const supabase = createAdminClient();

  // Todos os registos de cliente com o mesmo NIF.
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, nif")
    .eq("id", clientId)
    .single();

  if (clientError || !client) {
    throw new Error(
      `Erro ao carregar cliente: ${clientError?.message ?? "não encontrado"}`,
    );
  }

  let clientIds = [client.id];

  if (client.nif) {
    const { data: sameNif } = await supabase
      .from("clients")
      .select("id")
      .eq("nif", client.nif);

    clientIds = Array.from(
      new Set([client.id, ...(sameNif ?? []).map((c) => c.id)]),
    );
  }

  // Uma só verificação para todo o painel (as funções internas
  // abaixo já não repetem).
  await assertClientAccess(clientIds);

  const { data: policiesData, error: policiesError } = await supabase
    .from("policies")
    .select(CLIENT_POLICY_SELECT)
    .in("client_id", clientIds);

  if (policiesError) {
    throw new Error(`Erro ao carregar apólices: ${policiesError.message}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawPolicies = (policiesData ?? []) as any[];
  const policyIds = rawPolicies.map((p) => p.id as string);

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
  }).format(new Date());

  const [
    receiptLists,
    details,
    roles,
    profile,
    linesResult,
    openProcessesResult,
    dismissalsResult,
  ] = await Promise.all([
    Promise.all(policyIds.map((id) => loadPolicyReceipts(id))),
    loadReceiptDetails({ policyIds }),
    getPoliciesRoles(policyIds)
      .then((data) => ({ data, error: null as string | null }))
      .catch((error: unknown) => ({
        data: {} as Record<string, PolicyRolesData>,
        error:
          error instanceof Error
            ? error.message
            : "Erro ao carregar intervenientes.",
      })),
    loadClientProfile(client.id).catch((error: unknown) => {
      console.error("[clientes] getClientProfile", error);
      return null;
    }),
    getCachedInsuranceLines(),
    client.nif
      ? supabase
          .from("tasks")
          .select("insurance_line_id")
          .eq("kind", "PROCESS")
          .eq("client_nif", client.nif)
          .not("status", "in", "(COMPLETED,CANCELLED)")
      : Promise.resolve({ data: [] as { insurance_line_id: string | null }[] }),
    supabase
      .from("client_advice_dismissals")
      .select("advice_key")
      .in("client_id", clientIds)
      .gte("dismissed_until", today),
  ]);

  const receiptsByPolicy: Record<string, PolicyReceiptRow[]> = {};

  policyIds.forEach((id, index) => {
    receiptsByPolicy[id] = receiptLists[index];
  });

  const policies: PolicyRow[] = rawPolicies
    .map((raw) => {
      const latest = (receiptsByPolicy[raw.id] ?? []).find(
        (r) => !r.isReversal,
      );

      const registration =
        typeof raw.provider_metadata?.vehicleRegistration === "string"
          ? raw.provider_metadata.vehicleRegistration.trim().toUpperCase() ||
            null
          : null;

      return {
        id: raw.id,
        client_id: raw.client_id,
        external_id: raw.external_id,
        policy_number: raw.policy_number,
        product_code: raw.product_code,
        product_name: raw.product_name,
        status: raw.status,
        issue_date: raw.issue_date,
        start_date: raw.start_date,
        end_date: raw.end_date,
        renewal_date: raw.renewal_date,
        cancellation_date: raw.cancellation_date,
        commercial_premium: toNullableNumber(raw.commercial_premium),
        total_premium: toNullableNumber(raw.total_premium),
        annualized_premium: toNullableNumber(raw.annualized_premium),
        vehicle_registration: registration,
        latest_receipt: latest
          ? {
              id: latest.id,
              receipt_number: latest.receipt_number,
              due_date: latest.due_date,
              commercial_premium: latest.commercial_premium,
              total_premium: latest.total_premium,
            }
          : null,
        payment_frequency: raw.payment_frequency,
        origin: raw.origin,
        commercial_user_id: raw.commercial_user_id,
        issued_by_user_id: raw.issued_by_user_id,
        issuing_store_id: raw.issuing_store_id,
        company: first(raw.company),
        insurance_line: first(raw.insurance_line),
        commercial_user: first(raw.commercial_user),
        issuing_store: first(raw.issuing_store),
        last_synced_at: raw.last_synced_at,
        created_at: raw.created_at,
      } as PolicyRow;
    })
    .sort(
      (a, b) =>
        (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
        (b.issue_date ?? "").localeCompare(a.issue_date ?? ""),
    );

  // Transferências: uma falha aqui não impede de ver o cliente.
  let transfers: Record<string, PolicyTransferInfo> = {};

  try {
    transfers = await detectPolicyTransfers(
      supabase,
      rawPolicies.map((raw) => {
        const lastValid = (receiptsByPolicy[raw.id] ?? []).find(
          (r) => !r.isReversal,
        );

        return {
          id: raw.id,
          policy_number: raw.policy_number,
          status: raw.status,
          client_id: raw.client_id,
          company_id: first<{ id: string }>(raw.company)?.id ?? null,
          company_name: first<{ name: string }>(raw.company)?.name ?? null,
          line_code: first<{ code: string }>(raw.insurance_line)?.code ?? null,
          start_date: raw.start_date,
          issue_date: raw.issue_date,
          cancellation_date: raw.cancellation_date,
          provider_metadata: raw.provider_metadata,
          returned_receipt_date:
            lastValid?.status === "RETURNED"
              ? lastValid.due_date ?? lastValid.period_start
              : null,
        };
      }),
    );
  } catch (error) {
    console.error("[clientes] detectPolicyTransfers", error);
  }

  // ----------------------------------------
  // Conselhos (lâmpada)
  // ----------------------------------------

  const lines = linesResult;
  const lineCodeById = new Map(lines.map((l) => [l.id, l.code]));

  // Sem a migração dos dispensados, os conselhos aparecem na mesma.
  if ("error" in dismissalsResult && dismissalsResult.error) {
    console.error(
      "[clientes] client_advice_dismissals",
      dismissalsResult.error.message,
    );
  }

  const dismissed = new Set(
    (dismissalsResult.data ?? []).map((d) => d.advice_key),
  );

  const zurichFicha =
    profile?.providers.find((p) => p.company_code === "ZURICH")?.metadata ??
    profile?.providers[0]?.metadata ??
    {};

  const advice = computeClientAdvice({
    today,
    client: {
      nif: client.nif,
      email: profile?.email ?? null,
      phone: profile?.phone ?? null,
      birth_date: profile?.birth_date ?? null,
      metadata: zurichFicha,
    },
    policies: policies.map((p) => ({
      id: p.id,
      policy_number: p.policy_number,
      status: p.status,
      line_code: p.insurance_line?.code ?? null,
      line_name: p.insurance_line?.name ?? null,
      company_name: p.company?.name ?? null,
      annualized_premium: p.annualized_premium,
    })),
    receiptsByPolicy,
    transfers,
    lineIdsByCode: Object.fromEntries(lines.map((l) => [l.code, l.id])),
    lineNamesByCode: Object.fromEntries(lines.map((l) => [l.code, l.name])),
    openProcessLineCodes: new Set(
      (openProcessesResult.data ?? [])
        .map((t) =>
          t.insurance_line_id ? lineCodeById.get(t.insurance_line_id) : null,
        )
        .filter(Boolean) as string[],
    ),
  }).filter((item) => !dismissed.has(item.key));

  return {
    policies,
    receiptsByPolicy,
    details: Object.fromEntries(details.map((d) => [d.id, d])),
    roles: roles.data,
    rolesError: roles.error,
    transfers,
    profile,
    advice,
  };
}
