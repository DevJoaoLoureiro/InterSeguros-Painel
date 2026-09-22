import {
  syncZurichPolicies,
  syncZurichReceipts,
} from "@/lib/insurance/providers/zurich/sync";

import {
  getZurichAccounts,
  obterObjetosPorNrApolice,
  obterCoberturasPorApolice,
} from "@/lib/insurance/providers/zurich/client";

import {
  runZurichEnrichmentBackfill,
  BACKFILL_MAX_LIMIT,
} from "@/lib/insurance/providers/zurich/backfill-enrichment";

import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const cursor =
    searchParams.get("cursor")?.trim() || null;

  const metadataOnly =
    searchParams.get("metadataOnly") === "true";

  const skipMetadata =
    searchParams.get("skipMetadata") === "true";

  const forceMetadata =
    searchParams.get("forceMetadata") === "true";

  const metadataLimitRaw =
    Number(searchParams.get("metadataLimit") ?? 25);

  const metadataLimit =
    Number.isFinite(metadataLimitRaw) &&
    metadataLimitRaw > 0
      ? Math.min(
          Math.floor(metadataLimitRaw),
          BACKFILL_MAX_LIMIT,
        )
      : 25;

  try {
    const policiesResult =
      metadataOnly
        ? null
        : await syncZurichPolicies();

    const receiptsResult =
      metadataOnly
        ? null
        : await syncZurichReceipts();

    if (skipMetadata) {
      return Response.json({
        success: true,
        policies: policiesResult,
        receipts: receiptsResult,
        metadata: {
          skipped: true,
        },
      });
    }

    const supabase =
      createAdminClient();

    const metadataResult =
      await runZurichEnrichmentBackfill(
        {
          apply: true,
          limit: metadataLimit,
          cursor,
          force: forceMetadata,
          budgetMs: 55_000,
        },
        {
          supabase,

          getAccounts:
            getZurichAccounts,

          lookupObjects:
            async (
              policyNumber,
              account,
            ) => {
              const result =
                await obterObjetosPorNrApolice(
                  policyNumber,
                  account,
                );

              return result.ListaObjetos ?? [];
            },

          lookupCoverages:
            async (
              policyNumber,
              account,
            ) => {
              const result =
                await obterCoberturasPorApolice(
                  policyNumber,
                  account,
                );

              return result.ListaCoberturas ?? [];
            },

          sleep:
            (ms: number) =>
              new Promise((resolve) =>
                setTimeout(resolve, ms),
              ),

          now: () => Date.now(),
        },
      );

    return Response.json({
      success: true,
      policies: policiesResult,
      receipts: receiptsResult,
      metadata: metadataResult,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro desconhecido.",
      },
      {
        status: 500,
      },
    );
  }
}