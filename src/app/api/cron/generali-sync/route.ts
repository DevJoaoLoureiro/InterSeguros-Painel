import { revalidateTag } from "next/cache";

import { VENCIMENTOS_TAG } from "@/lib/alerts/expiry-alerts";
import { refreshPolicyRenewals } from "@/lib/vencimentos/queries";
import { syncGenerali } from "@/lib/insurance/providers/generali/sync";
import { detectGeneraliPremiumIncreases } from "@/lib/assistant/premium-increase";
import { reconcileProcessReceipts } from "@/lib/tasks/process-receipts";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/*
 * Cron diário da Generali (Cron Trigger da Cloudflare, ver
 * custom-worker.ts). Protegido pelo CRON_SECRET no proxy.ts.
 *
 * Apólices -> recibos -> clientes, cada um com um limite de páginas
 * por execução. Com o carregamento inicial por terminar, cada execução
 * avança mais um bocado (o SyncToken fica gravado página a página).
 *
 * ?maxPages=N muda o limite (testes manuais).
 */
export async function GET(request: Request) {
  const maxPages = Number(new URL(request.url).searchParams.get("maxPages"));

  try {
    const result = await syncGenerali({
      maxPages: Number.isInteger(maxPages) && maxPages > 0 ? maxPages : undefined,
    });

    // Próxima renovação de cada apólice (policy_renewals) com os dados novos.
    await refreshPolicyRenewals();

    revalidateTag(VENCIMENTOS_TAG, "max");

    // Mensagens do assistente: renovações com subida de prémio.
    const premiumAlerts = await detectGeneraliPremiumIncreases(createAdminClient()).catch(
      (error: unknown) => {
        console.error("[cron generali] subidas de prémio", error);
        return null;
      },
    );

    const processes = await reconcileProcessReceipts(createAdminClient()).catch(
      (error: unknown) => {
        console.error("[cron generali] reconcileProcessReceipts", error);
        return null;
      },
    );

    // Só contagens: nada de dados de clientes na resposta (vai para os
    // logs do Worker).
    return Response.json(
      {
        success: result.ok,
        results: result.results.map(({ resource, status, phaseBefore, phaseAfter, pages, moreRemaining, received, created, updated, skipped, failed, message }) => ({
          resource,
          status,
          phaseBefore,
          phaseAfter,
          pages,
          moreRemaining,
          received,
          created,
          updated,
          skipped,
          failed,
          message,
        })),
        missingClients: result.missingClients
          ? { ...result.missingClients, errors: result.missingClients.errors.length }
          : null,
        processes,
        premiumAlerts,
      },
      { status: result.ok ? 200 : 500 },
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro desconhecido.",
      },
      { status: 500 },
    );
  }
}
