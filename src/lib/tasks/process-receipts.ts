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
 * - Só processos de APÓLICE NOVA. Numa renegociação a apólice já
 *   existe e os recibos normais dela não provam nada (ligavam-se
 *   sozinhos e o processo saltava para "à espera do pagamento").
 * - Só depois do passo 2 (simulação apresentada, com a companhia
 *   escolhida) e só apólices DESSA companhia: um NIF tem apólices de
 *   várias companhias, e antes da simulação nenhum recibo pode ser
 *   deste processo (o processo saltava logo para a penúltima fase).
 * - O match é feito pelo NIF do cliente → apólices NOVAS (emitidas
 *   pela companhia no máximo NEW_POLICY_GRACE_DAYS antes de o
 *   processo ser criado) → recibos com period_start perto da data de
 *   início do seguro do processo. As apólices antigas do cliente
 *   nunca contam: um cliente pode ter vários processos.
 * - Cada apólice só serve um processo.
 * - Uma ligação do webservice que já não cumpre estas regras é
 *   desfeita (o processo volta à fase certa).
 * - O recibo do webservice tem SEMPRE prioridade: se o processo
 *   estava marcado manualmente, passa a usar o do webservice (e o
 *   estado pago/não pago passa a ser o do webservice).
 * - O processo só fica COMPLETED quando o recibo está pago; se o
 *   webservice disser que não está, o processo volta a estar aberto.
 */

const MATCH_WINDOW_DAYS = 30;

// Apólice emitida até X dias ANTES do processo ser registado ainda
// conta como a apólice do processo (registado depois de emitir).
const NEW_POLICY_GRACE_DAYS = 15;

type ProcessRow = {
  id: string;
  status: ProcessTaskStatus;
  simulation_presented: boolean;
  issued: boolean;
  is_new_policy: boolean | null;
  simulation_company: string | null;
  client_id: string | null;
  policy_id: string | null;
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

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
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
      is_new_policy,
      simulation_company,
      client_id,
      policy_id,
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

  const all = (processData ?? []) as ProcessRow[];
  const nowIso = new Date().toISOString();
  let updated = 0;

  // Processos sem cliente cujo NIF já existe nos clientes (ex.: o
  // cliente chegou depois pelo sync): ligar ao cliente, seja apólice
  // nova ou renegociação.
  const withoutClient = all.filter((p) => !p.client_id && cleanNif(p.client_nif));

  if (withoutClient.length > 0) {
    const { data: known, error: knownError } = await admin
      .from("clients")
      .select("id, nif")
      .in(
        "nif",
        Array.from(new Set(withoutClient.map((p) => cleanNif(p.client_nif)))),
      );

    if (knownError) {
      throw new Error(`Erro ao procurar clientes: ${knownError.message}`);
    }

    const clientByNif = new Map(
      (known ?? []).map((c) => [cleanNif(c.nif), c.id as string]),
    );

    for (const p of withoutClient) {
      const id = clientByNif.get(cleanNif(p.client_nif));
      if (!id) continue;

      const { error } = await admin
        .from("tasks")
        .update({ client_id: id, updated_at: nowIso })
        .eq("id", p.id);

      if (error) {
        throw new Error(`Erro ao ligar processo ao cliente: ${error.message}`);
      }

      p.client_id = id;
      updated++;
    }
  }

  // Ligações do webservice que as regras já não permitem: desfazer.
  const unlink = async (process: ProcessRow) => {
    const nextStatus = deriveProcessStatus({
      status: process.status,
      simulation_presented: process.simulation_presented,
      issued: false,
      receipt_paid: false,
    });

    const { error } = await admin
      .from("tasks")
      .update({
        receipt_id: null,
        receipt_source: null,
        receipt_paid: false,
        receipt_paid_at: null,
        policy_id: null,
        issued: false,
        status: nextStatus,
        completed_at: null,
        updated_at: nowIso,
      })
      .eq("id", process.id);

    if (error) {
      throw new Error(`Erro ao desligar recibo do processo: ${error.message}`);
    }

    updated++;
  };

  // Companhia da simulação (texto) → companhia do CRM.
  const { data: companiesData, error: companiesError } = await admin
    .from("companies")
    .select("id, name");

  if (companiesError) {
    throw new Error(`Erro ao carregar companhias: ${companiesError.message}`);
  }

  const companyIdByName = new Map(
    (companiesData ?? []).map((c) => [normalizeName(c.name), c.id as string]),
  );

  const companyIdOf = (process: ProcessRow) =>
    process.simulation_company
      ? companyIdByName.get(normalizeName(process.simulation_company)) ?? null
      : null;

  // Só apólices novas, depois da simulação, de uma companhia que o CRM
  // recebe (ver regras no topo). Datas inválidas ficam à espera de ser
  // corrigidas.
  const processes: ProcessRow[] = [];

  for (const p of all) {
    if (
      p.is_new_policy === false ||
      !p.simulation_presented ||
      !companyIdOf(p) ||
      !isValidDateKey(referenceDate(p))
    ) {
      if (p.receipt_source === "WEBSERVICE") await unlink(p);
      continue;
    }
    processes.push(p);
  }

  if (processes.length === 0) {
    return { updated };
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

  const { data: policiesData, error: policiesError } = clientIds.length
    ? await admin
        .from("policies")
        .select(
          "id, client_id, company_id, insurance_line_id, issue_date, start_date",
        )
        .in("client_id", clientIds)
    : { data: [], error: null };

  if (policiesError) {
    throw new Error(`Erro ao procurar apólices: ${policiesError.message}`);
  }

  const policies = (policiesData ?? []) as {
    id: string;
    client_id: string;
    company_id: string | null;
    insurance_line_id: string | null;
    issue_date: string | null;
    start_date: string | null;
  }[];

  const policyById = new Map(policies.map((p) => [p.id, p]));
  const policyIds = policies.map((p) => p.id);

  // Apólices que já pertencem a outro processo (aberto ou fechado).
  const { data: takenData, error: takenError } = policyIds.length
    ? await admin
        .from("tasks")
        .select("id, policy_id")
        .eq("kind", "PROCESS")
        .neq("status", "CANCELLED")
        .in("policy_id", policyIds)
    : { data: [], error: null };

  if (takenError) {
    throw new Error(`Erro ao ver apólices ocupadas: ${takenError.message}`);
  }

  const processByPolicy = new Map(
    (takenData ?? []).map((t) => [t.policy_id as string, t.id as string]),
  );

  // Apólice nova para este processo: emitida (ou, sem data de
  // emissão, iniciada) no máximo NEW_POLICY_GRACE_DAYS antes de o
  // processo ser criado.
  const isNewForProcess = (
    policy: (typeof policies)[number],
    process: ProcessRow,
  ) => {
    const policyDate = policy.issue_date ?? policy.start_date;
    if (!policyDate) return false;
    const earliest = shiftDays(
      process.created_at.slice(0, 10),
      -NEW_POLICY_GRACE_DAYS,
    );
    return policyDate.slice(0, 10) >= earliest;
  };

  const usableBy = (policyId: string, process: ProcessRow) => {
    const owner = processByPolicy.get(policyId);
    return !owner || owner === process.id;
  };

  // ----------------------------------------
  // Recibos candidatos (janela total de todos os processos)
  // ----------------------------------------

  const refDates = processes.map(referenceDate).sort();
  const fromKey = shiftDays(refDates[0], -MATCH_WINDOW_DAYS);
  const toKey = shiftDays(refDates[refDates.length - 1], MATCH_WINDOW_DAYS);

  const { data: receiptsData, error: receiptsError } = !policyIds.length
    ? { data: [], error: null }
    : await admin
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
    .in("policy_id", policyIds)
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

  for (const process of processes) {
    const nif = cleanNif(process.client_nif);
    const processClientIds = new Set(nif ? clientIdsByNif.get(nif) ?? [] : []);

    const ref = referenceDate(process);
    const companyId = companyIdOf(process);

    const candidates = receipts
      .filter((r) => {
        const policy = policyById.get(r.policy_id);
        return (
          policy &&
          processClientIds.has(policy.client_id) &&
          policy.company_id === companyId &&
          isNewForProcess(policy, process) &&
          usableBy(policy.id, process) &&
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

    if (!best) {
      // Estava ligado a um recibo que já não serve (apólice antiga,
      // de outro processo, ...): volta a não ter recibo.
      if (process.receipt_source === "WEBSERVICE") await unlink(process);
      continue;
    }

    // A partir daqui a apólice é deste processo.
    processByPolicy.set(best.policy.id, process.id);

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
