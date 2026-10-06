import { cache } from "react";
import { unstable_cache } from "next/cache";

import { VENCIMENTOS_TAG } from "@/lib/alerts/expiry-alerts";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Saúde das sincronizações com as companhias (Zurich, Prévoir).
 *
 * Um sync que falha não avisava ninguém: em 2026-09 o token da Zurich
 * expirou e a carteira esteve uma semana sem atualizar. Aqui deteta-se
 * "há demasiado tempo sem um sync bem-sucedido" para mostrar aos
 * administradores (sino + dashboard).
 *
 * Em cache como os vencimentos: os crons invalidam a tag no fim.
 */

// Os crons correm de 30 em 30 minutos; 6 horas sem sucesso já não é
// um soluço — é o sync parado (ou o cron deixou de ser chamado).
export const SYNC_STALE_HOURS = 6;

const RESOURCE_LABEL: Record<string, string> = {
  POLICIES: "apólices",
  RECEIPTS: "recibos",
};

export type SyncProblem = {
  companyCode: string;
  companyName: string;
  // Recursos parados ("apólices", "recibos").
  resources: string[];
  lastSuccessAt: string | null;
  hoursSince: number | null;
  // Último erro registado (já vem sem dados pessoais do sync).
  lastError: string | null;
};

function first<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

async function computeSyncProblems(): Promise<SyncProblem[]> {
  const supabase = createAdminClient();

  const { data: states, error } = await supabase
    .from("integration_sync_state")
    .select(
      "company_id, resource_type, last_successful_sync_at, company:companies ( code, name )",
    );

  if (error) {
    console.error("[sync-health] estado", error.message);
    return [];
  }

  const now = Date.now();
  const staleMs = SYNC_STALE_HOURS * 3_600_000;
  const byCompany = new Map<string, SyncProblem>();

  for (const state of states ?? []) {
    const last = state.last_successful_sync_at as string | null;
    const age = last ? now - Date.parse(last) : null;

    if (age !== null && age < staleMs) continue;

    const company = first(
      state.company as
        | { code: string; name: string }
        | { code: string; name: string }[]
        | null,
    );

    const problem = byCompany.get(state.company_id) ?? {
      companyCode: company?.code ?? "?",
      companyName: company?.name ?? "Companhia",
      resources: [],
      lastSuccessAt: last,
      hoursSince: age === null ? null : Math.floor(age / 3_600_000),
      lastError: null,
    };

    problem.resources.push(
      RESOURCE_LABEL[state.resource_type] ?? state.resource_type.toLowerCase(),
    );

    // Fica o recurso parado há mais tempo.
    if (
      last &&
      (!problem.lastSuccessAt || last < problem.lastSuccessAt)
    ) {
      problem.lastSuccessAt = last;
      problem.hoursSince = Math.floor((age as number) / 3_600_000);
    }

    byCompany.set(state.company_id, problem);
  }

  if (byCompany.size === 0) return [];

  // Motivo: o erro mais recente de cada companhia parada.
  const { data: runs } = await supabase
    .from("integration_sync_runs")
    .select("company_id, error_message, started_at")
    .in("company_id", [...byCompany.keys()])
    .eq("status", "ERROR")
    .not("error_message", "is", null)
    .order("started_at", { ascending: false })
    .limit(20);

  for (const run of runs ?? []) {
    const problem = byCompany.get(run.company_id);

    if (problem && !problem.lastError) {
      problem.lastError = String(run.error_message)
        .replace(/\s+/g, " ")
        .slice(0, 200);
    }
  }

  return [...byCompany.values()].sort((a, b) =>
    a.companyName.localeCompare(b.companyName),
  );
}

const getCachedSyncProblems = unstable_cache(
  computeSyncProblems,
  ["sync-health-v1"],
  { revalidate: 120, tags: [VENCIMENTOS_TAG] },
);

/* Uma só leitura por pedido (sino e dashboard partilham). */
export const getSyncProblems = cache(async () => getCachedSyncProblems());

export function describeSyncAge(problem: SyncProblem) {
  if (problem.hoursSince === null) return "nunca sincronizou";

  if (problem.hoursSince < 48) return `sem atualizar há ${problem.hoursSince} h`;

  return `sem atualizar há ${Math.floor(problem.hoursSince / 24)} dias`;
}
