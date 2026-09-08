import {
  syncZurichPolicies,
  syncZurichReceipts,
} from "@/lib/insurance/providers/zurich/sync";

/**
 * Cron diário da Zurich. Protegido pelo mesmo padrão CRON_SECRET
 * que já usas para /api/cron/libax-import — o proxy.ts já trata
 * disso desde que a rota esteja em /api/cron/*.
 */
export async function GET() {
  try {
    const policiesResult = await syncZurichPolicies();
    const receiptsResult = await syncZurichReceipts();

    return Response.json({
      success: true,
      policies: policiesResult,
      receipts: receiptsResult,
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