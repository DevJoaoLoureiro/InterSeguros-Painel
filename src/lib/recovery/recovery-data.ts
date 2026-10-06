import type { SupabaseClient } from "@supabase/supabase-js";

import type { RecoveryReceipt } from "@/lib/recovery/lost-clients";

/*
 * Dados partilhados pelos clientes perdidos (leads de recuperação no
 * cron e "Anuladas" nos Vencimentos): todas as apólices, os
 * recibos por apólice e a regra de "já não vale a pena contactar"
 * (voltou / foi substituída).
 */

const PAGE_SIZE = 1000;

export type RecoveryClientRow = {
  id: string;
  name: string;
  nif: string | null;
  phone: string | null;
  email: string | null;
  birth_date: string | null;
  postal_code: string | null;
  city: string | null;
};

export type RecoveryPolicyRow = {
  id: string;
  client_id: string;
  policy_number: string;
  status: string;
  payment_frequency: string | null;
  cancellation_date: string | null;
  end_date: string | null;
  annualized_premium: number | string | null;
  commercial_user_id: string | null;
  issuing_store_id: string | null;
  provider_metadata: Record<string, unknown> | null;
  company: { name: string } | { name: string }[] | null;
  insurance_line:
    | { code: string; name: string }
    | { code: string; name: string }[]
    | null;
  client: RecoveryClientRow | RecoveryClientRow[] | null;
};

export type ReplacedReason = "cameBack" | "vehicleElsewhere";

export type RecoveryData = {
  policies: RecoveryPolicyRow[];
  receiptsByPolicy: Map<string, RecoveryReceipt[]>;
  // Voltou (outra apólice ativa do mesmo ramo) ou, em Auto, a
  // matrícula está noutra apólice ativa. null = continua perdido.
  replacedReason: (policy: RecoveryPolicyRow) => ReplacedReason | null;
};

export function first<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function normalizeRegistration(value: unknown) {
  return typeof value === "string"
    ? value.trim().toUpperCase().replace(/\s+/g, "") || null
    : null;
}

async function fetchAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return rows;
}

export async function loadRecoveryData(
  supabase: SupabaseClient,
): Promise<RecoveryData> {
  const [policies, receiptRows] = await Promise.all([
    fetchAll<RecoveryPolicyRow>((from, to) =>
      supabase
        .from("policies")
        .select(
          "id, client_id, policy_number, status, payment_frequency, cancellation_date, end_date, annualized_premium, commercial_user_id, issuing_store_id, provider_metadata, company:companies ( name ), insurance_line:insurance_lines ( code, name ), client:clients ( id, name, nif, phone, email, birth_date, postal_code, city )",
        )
        .order("id")
        .range(from, to) as unknown as PromiseLike<{
        data: RecoveryPolicyRow[] | null;
        error: { message: string } | null;
      }>,
    ),
    fetchAll<{
      policy_id: string;
      status: string;
      period_end: string | null;
      external_nature: string | null;
      receipt_type: string | null;
    }>((from, to) =>
      supabase
        .from("receipts")
        .select("policy_id, status, period_end, external_nature, receipt_type")
        .order("id")
        .range(from, to),
    ),
  ]);

  const receiptsByPolicy = new Map<string, RecoveryReceipt[]>();

  for (const r of receiptRows) {
    const type = (r.receipt_type ?? "").toUpperCase();
    const receipt: RecoveryReceipt = {
      status: r.status,
      period_end: r.period_end,
      isReversal:
        r.external_nature === "9" ||
        type.includes("ESTORNO") ||
        type.includes("REVERSAL"),
    };

    const list = receiptsByPolicy.get(r.policy_id);
    if (list) list.push(receipt);
    else receiptsByPolicy.set(r.policy_id, [receipt]);
  }

  // Ramos ativos por NIF (ou por cliente, sem NIF) → "voltou".
  const clientKey = (p: RecoveryPolicyRow) => {
    const nif = (first(p.client)?.nif ?? "").replace(/\D/g, "");
    return nif ? `nif:${nif}` : `client:${p.client_id}`;
  };

  const plateOf = (p: RecoveryPolicyRow) =>
    normalizeRegistration(p.provider_metadata?.vehicleRegistration);

  // cliente → ramo → apólices ativas (ids), para excluir a própria.
  const activeLinesByClient = new Map<string, Map<string, Set<string>>>();
  const activeRegistrations = new Map<string, string>(); // matrícula → policyId

  for (const p of policies) {
    if (p.status !== "ACTIVE" && p.status !== "PENDING") continue;

    const line = first(p.insurance_line)?.code;
    if (line) {
      const key = clientKey(p);
      const byLine = activeLinesByClient.get(key) ?? new Map();
      byLine.set(line, (byLine.get(line) ?? new Set()).add(p.id));
      activeLinesByClient.set(key, byLine);
    }

    const plate = plateOf(p);
    if (plate) activeRegistrations.set(plate, p.id);
  }

  const replacedReason = (p: RecoveryPolicyRow): ReplacedReason | null => {
    // Voltou: OUTRA apólice ativa do mesmo ramo (a própria pode estar
    // "ativa" na companhia mas sem recibos — é justamente o caso).
    const line = first(p.insurance_line)?.code;
    const sameLine = line
      ? activeLinesByClient.get(clientKey(p))?.get(line)
      : undefined;

    if (sameLine && [...sameLine].some((id) => id !== p.id)) {
      return "cameBack";
    }

    const plate = plateOf(p);
    const plateElsewhere = plate ? activeRegistrations.get(plate) : null;

    return plateElsewhere && plateElsewhere !== p.id
      ? "vehicleElsewhere"
      : null;
  };

  return { policies, receiptsByPolicy, replacedReason };
}
