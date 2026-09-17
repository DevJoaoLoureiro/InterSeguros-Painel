import { createAdminClient } from "@/lib/supabase/admin";

const DEFAULT_TRANSFER_WINDOW_DAYS = 30;

type PolicyStatus =
  | "ACTIVE"
  | "PENDING"
  | "CANCELLED"
  | "EXPIRED"
  | "SUSPENDED"
  | "REDUCED"
  | "UNKNOWN";

type PolicyTransferSource = {
  id: string;
  policy_number: string;
  company_id: string;
  client_id: string;
  status: PolicyStatus | string;
  start_date: string | null;
  issue_date: string | null;
  provider_metadata: Record<string, unknown> | null;
  company:
    | {
        id: string;
        code: string;
        name: string;
      }
    | {
        id: string;
        code: string;
        name: string;
      }[]
    | null;
};

export type PolicyTransferCandidate = {
  registration: string;

  oldPolicy: {
    id: string;
    policyNumber: string;
    companyId: string;
    companyCode: string | null;
    companyName: string | null;
    clientId: string;
    cancellationDate: string;
  };

  newPolicy: {
    id: string;
    policyNumber: string;
    companyId: string;
    companyCode: string | null;
    companyName: string | null;
    clientId: string;
    startDate: string;
  };

  daysBetween: number;
  sameClient: boolean;
  reason: "SAME_REGISTRATION_DIFFERENT_COMPANY";
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function normalizeRegistration(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "-");

  if (!normalized) return null;

  return normalized;
}

function getVehicleRegistration(
  metadata: Record<string, unknown> | null,
): string | null {
  return normalizeRegistration(metadata?.vehicleRegistration);
}

function getCancellationDate(
  metadata: Record<string, unknown> | null,
): string | null {
  const raw = metadata?.dataCancelamento;

  if (typeof raw !== "string") return null;

  const value = raw.trim();

  if (!value) return null;

  /*
   * O mapper Zurich já guarda dataCancelamento em YYYY-MM-DD.
   * Se no futuro outra companhia guardar outra chave/formato,
   * adapta-se aqui sem alterar o motor de matching.
   */
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function dateToUtcDay(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

  if (!match) return null;

  const [, year, month, day] = match;

  return Date.UTC(Number(year), Number(month) - 1, Number(day));
}

function daysBetweenDates(from: string, to: string): number | null {
  const fromTime = dateToUtcDay(from);
  const toTime = dateToUtcDay(to);

  if (fromTime === null || toTime === null) return null;

  return Math.round((toTime - fromTime) / 86_400_000);
}

function isCancelledPolicy(policy: PolicyTransferSource): boolean {
  return policy.status === "CANCELLED";
}

function isPossibleNewPolicy(policy: PolicyTransferSource): boolean {
  return policy.status !== "CANCELLED" && policy.status !== "EXPIRED";
}

async function loadPoliciesWithRegistration(): Promise<
  PolicyTransferSource[]
> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("policies")
    .select(`
      id,
      policy_number,
      company_id,
      client_id,
      status,
      start_date,
      issue_date,
      provider_metadata,
      company:companies (
        id,
        code,
        name
      )
    `)
    .not("provider_metadata->>vehicleRegistration", "is", null);

  if (error) {
    throw new Error(
      `Erro ao carregar apólices com matrícula: ${error.message}`,
    );
  }

  return (data ?? []) as unknown as PolicyTransferSource[];
}

/**
 * Procura candidatos a transferência de companhia.
 *
 * Regra atual:
 * - mesma matrícula;
 * - apólice antiga CANCELLED;
 * - apólice nova noutra companhia;
 * - nova apólice começa no mesmo dia ou até N dias após a anulação.
 *
 * Não grava nada na BD e não altera nenhuma apólice.
 *
 * `requireSameClient`:
 * - true  -> exige também o mesmo client_id;
 * - false -> matrícula + datas + companhia diferente são suficientes.
 *
 * Para já recomendamos true para reduzir falsos positivos.
 */
export async function findPolicyTransferCandidates({
  windowDays = DEFAULT_TRANSFER_WINDOW_DAYS,
  requireSameClient = true,
}: {
  windowDays?: number;
  requireSameClient?: boolean;
} = {}): Promise<PolicyTransferCandidate[]> {
  const policies = await loadPoliciesWithRegistration();

  const byRegistration = new Map<string, PolicyTransferSource[]>();

  for (const policy of policies) {
    const registration = getVehicleRegistration(policy.provider_metadata);

    if (!registration) continue;

    const group = byRegistration.get(registration) ?? [];
    group.push(policy);
    byRegistration.set(registration, group);
  }

  const candidates: PolicyTransferCandidate[] = [];

  for (const [registration, group] of byRegistration) {
    if (group.length < 2) continue;

    const oldPolicies = group.filter(isCancelledPolicy);
    const newPolicies = group.filter(isPossibleNewPolicy);

    for (const oldPolicy of oldPolicies) {
      const cancellationDate = getCancellationDate(
        oldPolicy.provider_metadata,
      );

      if (!cancellationDate) continue;

      for (const newPolicy of newPolicies) {
        if (oldPolicy.id === newPolicy.id) continue;

        // Tem de existir mudança de seguradora.
        if (oldPolicy.company_id === newPolicy.company_id) continue;

        const sameClient = oldPolicy.client_id === newPolicy.client_id;

        if (requireSameClient && !sameClient) continue;

        const newStartDate =
          newPolicy.start_date ?? newPolicy.issue_date;

        if (!newStartDate) continue;

        const daysBetween = daysBetweenDates(
          cancellationDate,
          newStartDate,
        );

        if (daysBetween === null) continue;

        /*
         * Não consideramos uma "transferência" quando a nova apólice
         * começou antes da antiga ser anulada, pelo menos nesta
         * primeira versão da regra.
         */
        if (daysBetween < 0 || daysBetween > windowDays) continue;

        const oldCompany = firstRelation(oldPolicy.company);
        const newCompany = firstRelation(newPolicy.company);

        candidates.push({
          registration,

          oldPolicy: {
            id: oldPolicy.id,
            policyNumber: oldPolicy.policy_number,
            companyId: oldPolicy.company_id,
            companyCode: oldCompany?.code ?? null,
            companyName: oldCompany?.name ?? null,
            clientId: oldPolicy.client_id,
            cancellationDate,
          },

          newPolicy: {
            id: newPolicy.id,
            policyNumber: newPolicy.policy_number,
            companyId: newPolicy.company_id,
            companyCode: newCompany?.code ?? null,
            companyName: newCompany?.name ?? null,
            clientId: newPolicy.client_id,
            startDate: newStartDate,
          },

          daysBetween,
          sameClient,
          reason: "SAME_REGISTRATION_DIFFERENT_COMPANY",
        });
      }
    }
  }

  return candidates.sort((a, b) => {
    if (a.newPolicy.startDate !== b.newPolicy.startDate) {
      return b.newPolicy.startDate.localeCompare(a.newPolicy.startDate);
    }

    return a.registration.localeCompare(b.registration);
  });
}

/**
 * Versão focada numa apólice.
 *
 * Útil mais tarde para o detalhe do cliente:
 * ao abrir uma apólice, podes perguntar se ela participa
 * nalguma possível transferência sem recalcular regras na UI.
 */
export async function findPolicyTransfersForPolicy(
  policyId: string,
  options?: {
    windowDays?: number;
    requireSameClient?: boolean;
  },
): Promise<PolicyTransferCandidate[]> {
  const all = await findPolicyTransferCandidates(options);

  return all.filter(
    (candidate) =>
      candidate.oldPolicy.id === policyId ||
      candidate.newPolicy.id === policyId,
  );
}
