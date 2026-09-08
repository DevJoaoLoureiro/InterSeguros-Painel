import {
  syncZurichPolicies,
  syncZurichReceipts,
} from "@/lib/insurance/providers/zurich/sync";
import { NextRequest } from "next/server";

/**
 * Rota manual para disparar o sync completo da Zurich (apólices +
 * recibos) sob pedido — útil para forçar uma atualização fora do
 * horário do cron, ou para testar algo pontualmente no futuro.
 *
 * Uso: GET /api/zurich/zurich-async?limit=10 (limit é opcional,
 * só para testes rápidos sem tocar no estado de sync completo).
 */
export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  try {
    const policiesResult = await syncZurichPolicies({ limit });
    const receiptsResult = await syncZurichReceipts({ limit });

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