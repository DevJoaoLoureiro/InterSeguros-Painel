import {
  NextResponse,
} from "next/server";

import {
  syncPrevoirPolicies,
} from "@/lib/insurance/providers/prevoir/sync";

import {
  syncPrevoirReceipts,
} from "@/lib/insurance/providers/prevoir/receipt-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
 * ENDPOINT DE CRON — PRÉVOIR
 *
 * Protegido automaticamente pelo proxy.ts:
 * qualquer rota debaixo de /api/cron/ exige
 * Authorization: Bearer <CRON_SECRET>.
 *
 * Corre policies e depois recibos, em sequência,
 * para garantir que uma apólice nova já existe
 * na BD antes de tentarmos associar-lhe recibos.
 *
 * Cada sync decide sozinho (via integration_sync_state)
 * se corre em modo incremental ou completo:
 * - Policies: incremental real, via endpoint /AAAAMMDD.
 * - Recibos: sempre busca tudo (não há incremental
 *   na API oficial), mas só escreve o que mudou. 
 */

export async function POST() {
  const startedAt = new Date().toISOString();

  let policiesResult: Awaited<
    ReturnType<typeof syncPrevoirPolicies>
  > | null = null;

  let receiptsResult: Awaited<
    ReturnType<typeof syncPrevoirReceipts>
  > | null = null;

  let policiesError: string | null = null;
  let receiptsError: string | null = null;

  // ========================================
  // 1. POLICIES
  // ========================================

  try {
    policiesResult = await syncPrevoirPolicies();
  } catch (error) {
    policiesError =
      error instanceof Error ? error.message : String(error);

    console.error(
      "Erro no cron Prévoir (policies):",
      error,
    );
  }

  // ========================================
  // 2. RECIBOS
  //
  // Corre mesmo que policies tenha falhado,
  // porque recibos de apólices já existentes
  // continuam válidos para sincronizar.
  // ========================================

  try {
    receiptsResult = await syncPrevoirReceipts();
  } catch (error) {
    receiptsError =
      error instanceof Error ? error.message : String(error);

    console.error(
      "Erro no cron Prévoir (recibos):",
      error,
    );
  }

  const ok = !policiesError && !receiptsError;

  return NextResponse.json(
    {
      ok,
      startedAt,
      finishedAt: new Date().toISOString(),

      policies: policiesResult ?? {
        ok: false,
        error: policiesError,
      },

      receipts: receiptsResult ?? {
        ok: false,
        error: receiptsError,
      },
    },
    {
      status: ok ? 200 : 500,
    },
  );
}