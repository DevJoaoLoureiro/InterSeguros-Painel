import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadZurichAutoPortfolio } from "@/lib/quoting/models/zurich/auto-model";
import { ZURICH_AUTO_MODEL_VERSION } from "@/lib/quoting/models/zurich/model-version";
import { buildRetroactiveObservations } from "@/lib/quoting/models/zurich/calibration/retroactive-backfill";
import { createSupabaseObservationStore } from "@/lib/quoting/observations/supabase-store";

/**
 * TEMPORÁRIA / manual. Backfill retroativo de ground truth (ver
 * retroactive-backfill.ts): recalcula, com leave-one-client-out, o que o
 * modelo atual estimaria para cada apólice Zurich Auto já emitida (com
 * prémio anual CONFIRMADO por recibos) e grava-o como observação marcada
 * `RETROACTIVE_PORTFOLIO` — nunca como cotação real, nunca calibra o valor
 * principal (ver classify() em zurich-quote-calibration.ts).
 *
 *   GET /api/dev/zurich-backfill-retroactive-observations
 *       -> PRÉ-VISUALIZAÇÃO: só lê a BD, NÃO escreve nada.
 *   GET /api/dev/zurich-backfill-retroactive-observations?apply=1&limit=20
 *       -> grava até `limit` observações novas (nunca repete uma apólice já
 *          backfilled: verifica por policy_id antes de escrever).
 *
 * Idempotente: correr sem `apply` várias vezes não faz nada; correr com
 * `apply=1` várias vezes só acrescenta as apólices ainda não cobertas.
 * Só OWNER/ADMIN. Não toca em policies/clients/receipts nem no sync Zurich.
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const INSERT_CHUNK = 50;

function boundedInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);

  if (raw === null || raw.trim() === "" || !Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const profile = await getCurrentProfile();

  if (!profile) {
    return json({ success: false, error: "Não autenticado." }, 401);
  }

  if (profile.role !== "OWNER" && profile.role !== "ADMIN") {
    return json({ success: false, error: "Sem permissões." }, 403);
  }

  const { searchParams } = new URL(request.url);
  const apply = searchParams.get("apply") === "1";
  const limit = boundedInt(searchParams.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);

  try {
    const admin = createAdminClient();
    const now = new Date();

    const { inputs, truncated } = await loadZurichAutoPortfolio(admin);
    const built = buildRetroactiveObservations(inputs, ZURICH_AUTO_MODEL_VERSION, now);

    const candidateIds = built.rows
      .map((row) => row.policy_id)
      .filter((id): id is string => id !== null);

    const alreadyBackfilled = new Set<string>();

    for (let i = 0; i < candidateIds.length; i += INSERT_CHUNK) {
      const chunk = candidateIds.slice(i, i + INSERT_CHUNK);

      const { data, error } = await admin
        .from("zurich_quote_observations")
        .select("policy_id")
        .in("policy_id", chunk);

      if (error) {
        return json({ success: false, error: "Erro ao verificar apólices já cobertas." }, 500);
      }

      for (const row of (data as { policy_id: string | null }[] | null) ?? []) {
        if (row.policy_id) alreadyBackfilled.add(row.policy_id);
      }
    }

    const pending = built.rows.filter(
      (row) => row.policy_id !== null && !alreadyBackfilled.has(row.policy_id),
    );

    const summary = {
      truncatedPortfolio: truncated,
      eligiblePolicies: built.eligiblePolicies,
      confirmedPolicies: built.confirmedPolicies,
      skippedInsufficientComparables: built.skippedInsufficientComparables,
      skippedInvalid: built.skippedInvalid,
      alreadyBackfilled: alreadyBackfilled.size,
      pendingTotal: pending.length,
    };

    if (!apply) {
      const sample = pending.slice(0, 5).map((row) => ({
        policyId: row.policy_id,
        quotedAt: row.quoted_at,
        coverageTier: row.coverage_tier,
        estimatedPremium: row.estimated_premium,
        realQuoteAmount: row.real_quote_amount,
      }));

      return json({
        success: true,
        applied: false,
        summary,
        wouldInsert: Math.min(pending.length, limit),
        sample,
        note: "Pré-visualização; nada foi escrito. Repetir com ?apply=1&limit=N para gravar.",
      });
    }

    const toInsert = pending.slice(0, limit);
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

    return json({
      success: true,
      applied: true,
      summary,
      inserted,
      failed,
      remainingAfterThisRun: pending.length - toInsert.length,
    });
  } catch (error) {
    return json(
      {
        success: false,
        error: error instanceof Error ? error.name : "Erro desconhecido.",
      },
      500,
    );
  }
}
