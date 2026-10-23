import { after } from "next/server";
import { revalidateTag } from "next/cache";

import {
  syncZurichPolicies,
  syncZurichReceipts,
} from "@/lib/insurance/providers/zurich/sync";
import { renewZurichTokenIfDue } from "@/lib/insurance/providers/zurich/token-renewal";
import { VENCIMENTOS_TAG } from "@/lib/alerts/expiry-alerts";
import { reconcileProcessReceipts } from "@/lib/tasks/process-receipts";
import { createAdminClient } from "@/lib/supabase/admin";

// Sync de apólices + recibos (com consultas individuais à Zurich) pode
// levar minutos; sem isto a Vercel cortava a meio e o estado não avançava.
export const maxDuration = 300;

async function runZurichSync() {
  // Token: renova uma vez por dia, ANTES do sync (nunca lança; se
  // falhar, o sync segue com o token que houver).
  const token = await renewZurichTokenIfDue();

  const policiesResult = await syncZurichPolicies();
  const receiptsResult = await syncZurichReceipts();

  // Alertas/sino/vencimentos em cache passam a refletir o sync.
  revalidateTag(VENCIMENTOS_TAG, "max");

  // Processos de simulação: ligar aos recibos que acabaram de chegar
  // (e fechar os que já estão pagos).
  const processes = await reconcileProcessReceipts(createAdminClient()).catch(
    (error: unknown) => {
      console.error("[cron zurich] reconcileProcessReceipts", error);
      return null;
    },
  );

  return {
    token,
    policies: policiesResult,
    receipts: receiptsResult,
    processes,
  };
}

/**
 * Cron diário da Zurich. Protegido pelo mesmo padrão CRON_SECRET
 * que já usas para /api/cron/libax-import — o proxy.ts já trata
 * disso desde que a rota esteja em /api/cron/*.
 *
 * Responde logo e corre o sync depois da resposta (after): o
 * cron-job.org desiste ao fim de 30 s e o sync leva minutos. O
 * resultado fica em integration_sync_runs. ?wait=1 espera pelo fim e
 * devolve o resultado (para testes manuais).
 */
export async function GET(request: Request) {
  const wait = new URL(request.url).searchParams.get("wait") === "1";

  if (!wait) {
    after(async () => {
      try {
        await runZurichSync();
      } catch (error) {
        console.error("[cron zurich] sync falhou", error);
      }
    });

    return Response.json({ success: true, started: true }, { status: 202 });
  }

  try {
    return Response.json({ success: true, ...(await runZurichSync()) });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro desconhecido.",
      },
      { status: 500 },
    );
  }
}
