import { createAdminClient } from "@/lib/supabase/admin";
import { loadZurichAutoPortfolio } from "@/lib/quoting/models/zurich/auto-model";
import { ZURICH_AUTO_MODEL_VERSION } from "@/lib/quoting/models/zurich/model-version";
import { buildRetroactiveObservations } from "@/lib/quoting/models/zurich/calibration/retroactive-backfill";
import { createSupabaseObservationStore } from "@/lib/quoting/observations/supabase-store";

/**
 * Cron automático do backfill retroativo (ver retroactive-backfill.ts e a
 * rota manual /api/dev/zurich-backfill-retroactive-observations, que faz o
 * mesmo cálculo com pré-visualização). Sem isto, cada apólice nova sincronizada
 * pela Zurich só entrava nas métricas se alguém corresse o backfill manual.
 *
 * Protegida pelo CRON_SECRET genérico de /api/cron/* em src/proxy.ts — não
 * precisa de auth própria aqui. NÃO toca em
 * src/lib/insurance/providers/zurich/sync.ts nem em policies/clients/receipts:
 * só lê apólices já sincronizadas e grava observações RETROACTIVE_PORTFOLIO,
 * nunca repetindo uma apólice já coberta (verifica por policy_id antes).
 */

const MAX_INSERTS_PER_RUN = 200;
const CHECK_CHUNK = 50;

export async function GET() {
  try {
    const admin = createAdminClient();
    const now = new Date();

    const { inputs, truncated } = await loadZurichAutoPortfolio(admin);
    const built = buildRetroactiveObservations(inputs, ZURICH_AUTO_MODEL_VERSION, now);

    const candidateIds = built.rows
      .map((row) => row.policy_id)
      .filter((id): id is string => id !== null);

    const alreadyBackfilled = new Set<string>();

    for (let i = 0; i < candidateIds.length; i += CHECK_CHUNK) {
      const chunk = candidateIds.slice(i, i + CHECK_CHUNK);

      const { data, error } = await admin
        .from("zurich_quote_observations")
        .select("policy_id")
        .in("policy_id", chunk);

      if (error) {
        return Response.json(
          { success: false, error: "Erro ao verificar apólices já cobertas." },
          { status: 500 },
        );
      }

      for (const row of (data as { policy_id: string | null }[] | null) ?? []) {
        if (row.policy_id) alreadyBackfilled.add(row.policy_id);
      }
    }

    const pending = built.rows.filter(
      (row) => row.policy_id !== null && !alreadyBackfilled.has(row.policy_id),
    );

    const toInsert = pending.slice(0, MAX_INSERTS_PER_RUN);
    const store = createSupabaseObservationStore(admin);

    let inserted = 0;
    let failed = 0;

    for (const row of toInsert) {
      try {
        await store.insert(row);
        inserted += 1;
      } catch {
        // Sem detalhes: podem conter dados pessoais (ver ObservationStoreError).
        failed += 1;
      }
    }

    return Response.json({
      success: true,
      truncatedPortfolio: truncated,
      eligiblePolicies: built.eligiblePolicies,
      confirmedPolicies: built.confirmedPolicies,
      skippedInsufficientComparables: built.skippedInsufficientComparables,
      skippedInvalid: built.skippedInvalid,
      alreadyBackfilled: alreadyBackfilled.size,
      inserted,
      failed,
      remainingAfterThisRun: pending.length - toInsert.length,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.name : "Erro desconhecido.",
      },
      { status: 500 },
    );
  }
}
