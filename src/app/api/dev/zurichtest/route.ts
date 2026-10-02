import { criarNovoTokenZurich } from "@/lib/insurance/providers/zurich/client";
import { sanitizeZurichText } from "@/lib/insurance/providers/zurich/log-safety";

/**
 * Teste de ligação à Zurich (pede um token novo).
 *
 * ATENÇÃO: emitir um token pode anular o token PARTILHADO por vários
 * CRMs. Por isso o client tem esta operação DESATIVADA por omissão (só
 * corre com ZURICH_ALLOW_TOKEN_ISSUE=1) e, desativada, esta rota devolve
 * só o erro. Nada a chama automaticamente. NUNCA devolve o token nem a
 * resposta bruta: só indica se a Zurich emitiu um token, e o token não
 * é guardado em lado nenhum.
 */
export async function GET() {
  try {
    const result = await criarNovoTokenZurich();

    return Response.json({
      success: true,
      tokenIssued: typeof result.Token === "string" && result.Token !== "",
      code: result.CodigoErro ?? null,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? sanitizeZurichText(error.message)
            : "Erro desconhecido.",
      },
      { status: 500 },
    );
  }
}
