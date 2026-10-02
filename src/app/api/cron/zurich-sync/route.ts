import { revalidateTag } from "next/cache";

import {
  syncZurichPolicies,
  syncZurichReceipts,
} from "@/lib/insurance/providers/zurich/sync";
import { VENCIMENTOS_TAG } from "@/lib/alerts/expiry-alerts";
import { reconcileProcessReceipts } from "@/lib/tasks/process-receipts";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Cron diário da Zurich. Protegido pelo mesmo padrão CRON_SECRET
 * que já usas para /api/cron/libax-import — o proxy.ts já trata
 * disso desde que a rota esteja em /api/cron/*.
 */
export async function GET() {
  try {
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

    return Response.json({
      success: true,
      policies: policiesResult,
      receipts: receiptsResult,
      processes,
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
      { status: 500 },
    );
  }
}