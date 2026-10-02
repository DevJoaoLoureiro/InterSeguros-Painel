import type { SupabaseClient } from "@supabase/supabase-js";

import {
  deriveProcessStatus,
  isValidDateKey,
  type ProcessTaskStatus,
} from "@/lib/tasks/process-status";

/*
 * Liga processos (tasks.kind = 'PROCESS') aos recibos que chegam
 * pelos webservices das companhias (Zurich, Prevoir, ...).
 *
 * Regras:
 * - O match é feito pelo NIF do cliente → apólices → recibos com
 *   period_start perto da data de início do seguro do processo.
 * - O recibo do webservice tem SEMPRE prioridade: se o processo
 *   estava marcado manualmente, passa a usar o do webservice (e o
 *   estado pago/não pago passa a ser o do webservice).
 * - O processo só fica COMPLETED quando o recibo está pago; se o
 *   webservice disser que não está, o processo volta a estar aberto.
 */

const MATCH_WINDOW_DAYS = 30;

type ProcessRow = {
  id: string;
  status: ProcessTaskStatus;
  simulation_presented: boolean;
  issued: boolean;
  client_nif: string | null;
  insurance_line_id: string | null;
  policy_start_date: string | null;
  created_at: string;
  receipt_id: string | null;
  receipt_source: string | null;
  receipt_paid: boolean;
  completed_at: string | null;
};

type CandidateReceipt = {
  id: string;
  policy_id: string;
  status: string;
  period_start: string | null;
  issue_date: string | null;
  payment_date: string | null;
  external_nature: string | null;
  receipt_type: string | null;
};

export { isValidDateKey };

export function cleanNif(value: string | null | undefined) {
  const cleaned = (value ?? "").replace(/\D/g, "");
  return cleaned || null;
}

function isReversal(receipt: CandidateReceipt) {
  const type = (receipt.receipt_type ?? "").toUpperCase();

  return (
    receipt.external_nature === "9" ||
    type.includes("ESTORNO") ||
    type.includes("REVERSAL")
  );
}

function daysBetween(a: string, b: string) {
  return Math.abs(
    (new Date(a).getTime() - new Date(b).getTime()) / 86400000,
  );
}

function shiftDays(date: string, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/*
 * Data de referência do processo: a data de início do seguro, ou
 * (se ainda não foi preenchida) a data de criação do processo.
 */
function referenceDate(process: ProcessRow) {
  return process.policy_start_date ?? process.created_at.slice(0, 10);
}

export async function reconcileProcessReceipts(
  admin: SupabaseClient,
  processIds?: string[],
) {
  let query = admin
    .from("tasks")
    .select(`
      id,
      status,
      simulation_presented,
      issued,
      client_nif,
      insurance_line_id,
      policy_start_date,
      created_at,
      receipt_id,
      receipt_source,
      receipt_paid,
      completed_at
    `)
    .eq("kind", "PROCESS")
    .neq("status", "CANCELLED")
    .not("client_nif", "is", null);

  if (processIds) {
    if (processIds.length === 0) return { updated: 0 };
    query = query.in("id", processIds);
  }

  const { data: processData, error: processError } = await query;

  if (processError) {
    throw new Error(
      `Erro ao carregar processos: ${processError.message}`,
    );
  }

  // Processos já fechados pelo webservice não precisam de nova volta;
  // processos com data de início inválida são ignorados até serem
  // corrigidos.
  const processes = ((processData ?? []) as ProcessRow[]).filter(
    (p) =>
      !(p.receipt_source === "WEBSERVICE" && p.receipt_paid) &&
      isValidDateKey(referenceDate(p)),
  );

  if (processes.length === 0) {
    return { updated: 0 };
  }

  // ----------------------------------------
  // NIF → clientes → apólices
  // ----------------------------------------

  const nifs = Array.from(
    new Set(
      processes
        .map((p) => cleanNif(p.client_nif))
        .filter(Boolean) as string[],
    ),
  );

  const { data: clientsData, error: clientsError } = await admin
    .from("clients")
    .select("id, nif")
    .in("nif", nifs);

  if (clientsError) {
    throw new Error(`Erro ao procurar clientes: ${clientsError.message}`);
  }

  const clientIdsByNif = new Map<string, string[]>();

  for (const client of clientsData ?? []) {
    const nif = cleanNif(client.nif);
    if (!nif) continue;
    clientIdsByNif.set(nif, [...(clientIdsByNif.get(nif) ?? []), client.id]);
  }

  const clientIds = (clientsData ?? []).map((c) => c.id);

  if (clientIds.length === 0) {
    return { updated: 0 };
  }

  const { data: policiesData, error: policiesError } = await admin
    .from("policies")
    .select("id, client_id, insurance_line_id")
    .in("client_id", clientIds);

  if (policiesError) {
    throw new Error(`Erro ao procurar apólices: ${policiesError.message}`);
  }

  const policies = policiesData ?? [];

  if (policies.length === 0) {
    return { updated: 0 };
  }

  const policyById = new Map(policies.map((p) => [p.id, p]));

  // ----------------------------------------
  // Recibos candidatos (janela total de todos os processos)
  // ----------------------------------------

  const refDates = processes.map(referenceDate).sort();
  const fromKey = shiftDays(refDates[0], -MATCH_WINDOW_DAYS);
  const toKey = shiftDays(refDates[refDates.length - 1], MATCH_WINDOW_DAYS);

  const { data: receiptsData, error: receiptsError } = await admin
    .from("receipts")
    .select(`
      id,
      policy_id,
      status,
      period_start,
      issue_date,
      payment_date,
      external_nature,
      receipt_type
    `)
    .in("policy_id", policies.map((p) => p.id))
    .neq("status", "CANCELLED")
    .gte("period_start", fromKey)
    .lte("period_start", toKey);

  if (receiptsError) {
    throw new Error(`Erro ao procurar recibos: ${receiptsError.message}`);
  }

  const receipts = ((receiptsData ?? []) as CandidateReceipt[]).filter(
    (r) => !isReversal(r) && r.period_start,
  );

  // ----------------------------------------
  // Escolher o melhor recibo por processo
  // ----------------------------------------

  let updated = 0;
  const nowIso = new Date().toISOString();

  for (const process of processes) {
    const nif = cleanNif(process.client_nif);
    const processClientIds = new Set(nif ? clientIdsByNif.get(nif) ?? [] : []);

    if (processClientIds.size === 0) continue;

    const ref = referenceDate(process);

    const candidates = receipts
      .filter((r) => {
        const policy = policyById.get(r.policy_id);
        return (
          policy &&
          processClientIds.has(policy.client_id) &&
          daysBetween(r.period_start as string, ref) <= MATCH_WINDOW_DAYS
        );
      })
      .map((r) => {
        const policy = policyById.get(r.policy_id)!;
        const lineMatch =
          !process.insurance_line_id ||
          policy.insurance_line_id === process.insurance_line_id;

        return {
          receipt: r,
          policy,
          lineMatch,
          paid: r.status === "PAID",
          distance: daysBetween(r.period_start as string, ref),
        };
      })
      // Se o processo indica o ramo, só aceitamos apólices desse ramo.
      .filter((c) => c.lineMatch)
      .sort(
        (a, b) =>
          Number(b.paid) - Number(a.paid) || a.distance - b.distance,
      );

    const best = candidates[0];

    if (!best) continue;

    const paid = best.paid;

    const unchanged =
      process.receipt_source === "WEBSERVICE" &&
      process.receipt_id === best.receipt.id &&
      process.receipt_paid === paid;

    if (unchanged) continue;

    // Recibo da companhia implica apólice emitida.
    const nextStatus = deriveProcessStatus({
      status: process.status,
      simulation_presented: process.simulation_presented,
      issued: true,
      receipt_paid: paid,
    });

    const { error: updateError } = await admin
      .from("tasks")
      .update({
        receipt_id: best.receipt.id,
        receipt_source: "WEBSERVICE",
        receipt_paid: paid,
        receipt_paid_at: paid
          ? best.receipt.payment_date
            ? new Date(best.receipt.payment_date).toISOString()
            : nowIso
          : null,
        policy_id: best.policy.id,
        client_id: best.policy.client_id,
        // Se já há recibo da companhia, a apólice foi emitida.
        issued: true,
        status: nextStatus,
        completed_at:
          nextStatus === "COMPLETED"
            ? process.completed_at ?? nowIso
            : null,
        updated_at: nowIso,
      })
      .eq("id", process.id);

    if (updateError) {
      throw new Error(
        `Erro ao ligar recibo ao processo: ${updateError.message}`,
      );
    }

    updated++;
  }

  return { updated };
}
