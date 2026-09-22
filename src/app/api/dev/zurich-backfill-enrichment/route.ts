import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getZurichAccounts,
  obterCoberturasPorApolice,
  obterObjetosPorNrApolice,
} from "@/lib/insurance/providers/zurich/client";
import {
  BACKFILL_DEFAULT_BUDGET_MS,
  BACKFILL_DEFAULT_LIMIT,
  BACKFILL_MAX_BUDGET_MS,
  BACKFILL_MAX_LIMIT,
  runZurichEnrichmentBackfill,
} from "@/lib/insurance/providers/zurich/backfill-enrichment";
import { sanitizeZurichText } from "@/lib/insurance/providers/zurich/log-safety";

/**
 * TEMPORÁRIA. Backfill do provider_metadata de apólices Zurich que JÁ
 * EXISTEM na BD (objetos, coberturas, viatura, fracionamento cru).
 * Remover quando o backfill estiver concluído.
 *
 *   GET /api/dev/zurich-backfill-enrichment?limit=10
 *       -> PRÉ-VISUALIZAÇÃO: consulta a Zurich, NÃO escreve nada.
 *   GET /api/dev/zurich-backfill-enrichment?apply=1&limit=10&cursor=<nextCursor>
 *       -> grava só policies.provider_metadata (merge que nunca apaga).
 *
 * Parâmetros:
 *   apply=1     só com exatamente 1 escreve;
 *   limit       1 a ${BACKFILL_MAX_LIMIT} (omissão ${BACKFILL_DEFAULT_LIMIT});
 *   cursor      o `nextCursor` da resposta anterior;
 *   force=1     reconsulta mesmo que os dados guardados sejam recentes;
 *   budgetMs    tempo máximo do pedido (omissão ${BACKFILL_DEFAULT_BUDGET_MS} ms).
 *
 * Só OWNER/ADMIN. Não cria apólices nem clientes, não toca em recibos.
 * A resposta é sanitizada (sem NIF, IBAN, tokens nem nº de apólice).
 */

const CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function boundedInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(raw);

  if (raw === null || raw.trim() === "" || !Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
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

  const cursorRaw = searchParams.get("cursor");

  if (cursorRaw !== null && cursorRaw !== "" && !CURSOR_PATTERN.test(cursorRaw)) {
    return json({ success: false, error: "cursor inválido." }, 400);
  }

  try {
    const result = await runZurichEnrichmentBackfill(
      {
        apply: searchParams.get("apply") === "1",
        limit: boundedInt(
          searchParams.get("limit"),
          BACKFILL_DEFAULT_LIMIT,
          1,
          BACKFILL_MAX_LIMIT,
        ),
        cursor: cursorRaw ? cursorRaw : null,
        force: searchParams.get("force") === "1",
        budgetMs: boundedInt(
          searchParams.get("budgetMs"),
          BACKFILL_DEFAULT_BUDGET_MS,
          1_000,
          BACKFILL_MAX_BUDGET_MS,
        ),
      },
      {
        supabase: createAdminClient(),
        getAccounts: getZurichAccounts,
        lookupObjects: async (policyNumber, account) =>
          (await obterObjetosPorNrApolice(policyNumber, account))
            .ListaObjetos ?? [],
        lookupCoverages: async (policyNumber, account) =>
          (await obterCoberturasPorApolice(policyNumber, account))
            .ListaCoberturas ?? [],
        sleep: (ms) =>
          ms > 0
            ? new Promise<void>((resolve) => setTimeout(resolve, ms))
            : Promise.resolve(),
        now: () => Date.now(),
      },
    );

    return json(result);
  } catch (error) {
    return json(
      {
        success: false,
        error: sanitizeZurichText(
          error instanceof Error ? error.message : "Erro desconhecido.",
        ),
      },
      500,
    );
  }
}
