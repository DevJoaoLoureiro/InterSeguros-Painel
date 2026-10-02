import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * "Para onde foi este seguro?"
 *
 * Quando uma apólice é anulada (ou o último recibo foi devolvido),
 * procuramos outra apólice com o MESMO OBJETO SEGURO:
 *   - Auto          → mesma matrícula (em qualquer cliente);
 *   - Multirriscos  → mesma morada do risco. A Zurich ainda não nos
 *                     manda a morada do risco, por isso, enquanto não
 *                     houver, usamos "mesmo cliente + mesmo tipo de
 *                     seguro" e marcamos como menos certo.
 *
 * Resultado:
 *   TRANSFER      outra companhia, mesmo tomador → mudou de companhia
 *   REPLACEMENT   mesma companhia, mesmo tomador → apólice substituída
 *   OTHER_HOLDER  mesmo objeto, outro tomador (ex.: carro vendido)
 *   NOT_FOUND     não há outra apólice na nossa carteira (se mudou de
 *                 companhia, foi com outro mediador)
 *
 * Só lê da BD; não grava nada.
 */

export type TransferKind =
  | "TRANSFER"
  | "REPLACEMENT"
  | "OTHER_HOLDER"
  | "NOT_FOUND";

export type TransferCounterpart = {
  policyId: string;
  policyNumber: string;
  companyName: string | null;
  status: string;
  startDate: string | null;
  clientName: string | null;
  sameClient: boolean;
};

export type PolicyTransferInfo = {
  // outgoing: esta apólice saiu; incoming: esta apólice veio de outra.
  direction: "outgoing" | "incoming";
  trigger: "CANCELLED" | "RETURNED";
  kind: TransferKind;
  matchedBy: "REGISTRATION" | "SAME_CLIENT_LINE" | null;
  confident: boolean;
  insuredObject: string | null;
  referenceDate: string | null;
  daysBetween: number | null;
  counterpart: TransferCounterpart | null;
};

export type TransferSourcePolicy = {
  id: string;
  policy_number: string;
  status: string;
  client_id: string;
  company_id: string | null;
  company_name: string | null;
  line_code: string | null;
  start_date: string | null;
  issue_date: string | null;
  cancellation_date: string | null;
  provider_metadata: Record<string, unknown> | null;
  // Data do último recibo válido se estiver devolvido.
  returned_receipt_date: string | null;
};

const MULTIRISK_LINES = new Set(["MRH", "MULTIRRISCOS_EMPRESARIAL"]);

// A nova apólice pode começar um pouco antes da anulação ficar
// registada, ou algum tempo depois (vimos casos até ~50 dias).
const WINDOW_BEFORE_DAYS = 30;
const WINDOW_AFTER_DAYS = 90;

function normalizeRegistration(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  return normalized || null;
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function daysBetween(from: string | null, to: string | null) {
  if (!from || !to) return null;
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

function inWindow(days: number | null) {
  return (
    days === null || (days >= -WINDOW_BEFORE_DAYS && days <= WINDOW_AFTER_DAYS)
  );
}

function first<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

type CandidateRow = {
  id: string;
  policy_number: string;
  status: string;
  client_id: string;
  company_id: string | null;
  start_date: string | null;
  issue_date: string | null;
  registration: string | null;
  company: { name: string } | { name: string }[] | null;
  client: { name: string } | { name: string }[] | null;
};

export async function detectPolicyTransfers(
  supabase: SupabaseClient,
  policies: TransferSourcePolicy[],
): Promise<Record<string, PolicyTransferInfo>> {
  const result: Record<string, PolicyTransferInfo> = {};

  const clientIds = new Set(policies.map((p) => p.client_id));

  // Gatilho: anulada, ou último recibo devolvido.
  const triggered = policies
    .map((policy) => {
      const cancelled = policy.status === "CANCELLED";
      const returned = !cancelled && policy.returned_receipt_date !== null;

      if (!cancelled && !returned) return null;

      return {
        policy,
        trigger: (cancelled ? "CANCELLED" : "RETURNED") as
          | "CANCELLED"
          | "RETURNED",
        referenceDate: cancelled
          ? dateOnly(policy.provider_metadata?.dataCancelamento) ??
            dateOnly(policy.cancellation_date) ??
            dateOnly(policy.provider_metadata?.dataFim)
          : policy.returned_receipt_date,
        registration: normalizeRegistration(
          policy.provider_metadata?.vehicleRegistration,
        ),
        multirisk: MULTIRISK_LINES.has(policy.line_code ?? ""),
      };
    })
    .filter(Boolean) as {
    policy: TransferSourcePolicy;
    trigger: "CANCELLED" | "RETURNED";
    referenceDate: string | null;
    registration: string | null;
    multirisk: boolean;
  }[];

  // Só Auto (matrícula) e Multirriscos têm objeto para comparar.
  const relevant = triggered.filter((t) => t.registration || t.multirisk);

  if (relevant.length === 0) {
    return result;
  }

  // ----------------------------------------
  // Candidatos com a mesma matrícula (qualquer cliente)
  // ----------------------------------------

  const registrations = Array.from(
    new Set(relevant.map((t) => t.registration).filter(Boolean)),
  ) as string[];

  let byRegistration = new Map<string, CandidateRow[]>();

  if (registrations.length > 0) {
    const { data, error } = await supabase
      .from("policies")
      .select(
        "id, policy_number, status, client_id, company_id, start_date, issue_date, registration:provider_metadata->>vehicleRegistration, company:companies ( name ), client:clients ( name )",
      )
      .in("provider_metadata->>vehicleRegistration", registrations);

    if (error) {
      throw new Error(`Erro ao procurar matrículas: ${error.message}`);
    }

    byRegistration = new Map();

    for (const row of (data ?? []) as unknown as CandidateRow[]) {
      const key = normalizeRegistration(row.registration);
      if (!key) continue;
      byRegistration.set(key, [...(byRegistration.get(key) ?? []), row]);
    }
  }

  // ----------------------------------------
  // Classificar cada apólice
  // ----------------------------------------

  for (const item of relevant) {
    const { policy } = item;

    let candidates: CandidateRow[] = [];
    let matchedBy: PolicyTransferInfo["matchedBy"] = null;

    if (item.registration) {
      matchedBy = "REGISTRATION";
      candidates = byRegistration.get(item.registration) ?? [];
    } else if (item.multirisk) {
      // Sem morada do risco: mesmo cliente + Multirriscos.
      matchedBy = "SAME_CLIENT_LINE";
      candidates = policies
        .filter(
          (p) =>
            MULTIRISK_LINES.has(p.line_code ?? "") &&
            clientIds.has(p.client_id),
        )
        .map((p) => ({
          id: p.id,
          policy_number: p.policy_number,
          status: p.status,
          client_id: p.client_id,
          company_id: p.company_id,
          start_date: p.start_date,
          issue_date: p.issue_date,
          registration: null,
          company: p.company_name ? { name: p.company_name } : null,
          client: null,
        }));
    }

    const options = candidates
      .filter((c) => c.id !== policy.id && c.status !== "CANCELLED")
      .map((c) => {
        const start = dateOnly(c.start_date) ?? dateOnly(c.issue_date);
        return { candidate: c, start, days: daysBetween(item.referenceDate, start) };
      })
      .filter((o) => inWindow(o.days))
      // Preferir mesmo tomador, depois a mais próxima no tempo.
      .sort((a, b) => {
        const aSame = clientIds.has(a.candidate.client_id) ? 0 : 1;
        const bSame = clientIds.has(b.candidate.client_id) ? 0 : 1;
        return (
          aSame - bSame ||
          Math.abs(a.days ?? 9999) - Math.abs(b.days ?? 9999)
        );
      });

    const best = options[0];

    if (!best) {
      result[policy.id] = {
        direction: "outgoing",
        trigger: item.trigger,
        kind: "NOT_FOUND",
        matchedBy,
        confident: matchedBy === "REGISTRATION",
        insuredObject: item.registration,
        referenceDate: item.referenceDate,
        daysBetween: null,
        counterpart: null,
      };
      continue;
    }

    const c = best.candidate;
    const sameClient = clientIds.has(c.client_id);
    const kind: TransferKind = !sameClient
      ? "OTHER_HOLDER"
      : c.company_id && c.company_id !== policy.company_id
        ? "TRANSFER"
        : "REPLACEMENT";

    const counterpart: TransferCounterpart = {
      policyId: c.id,
      policyNumber: c.policy_number,
      companyName: first(c.company)?.name ?? null,
      status: c.status,
      startDate: best.start,
      clientName: first(c.client)?.name ?? null,
      sameClient,
    };

    result[policy.id] = {
      direction: "outgoing",
      trigger: item.trigger,
      kind,
      matchedBy,
      confident: matchedBy === "REGISTRATION",
      insuredObject: item.registration,
      referenceDate: item.referenceDate,
      daysBetween: best.days,
      counterpart,
    };

    // A apólice nova (se for deste cliente) mostra de onde veio.
    if (sameClient && !result[c.id]) {
      result[c.id] = {
        direction: "incoming",
        trigger: item.trigger,
        kind,
        matchedBy,
        confident: matchedBy === "REGISTRATION",
        insuredObject: item.registration,
        referenceDate: item.referenceDate,
        daysBetween: best.days,
        counterpart: {
          policyId: policy.id,
          policyNumber: policy.policy_number,
          companyName: policy.company_name,
          status: policy.status,
          startDate: dateOnly(policy.start_date),
          clientName: null,
          sameClient: true,
        },
      };
    }
  }

  return result;
}
