import {
  obterFicheiroDia,
  ZurichTipoFicheiro,
} from "@/lib/insurance/providers/zurich/client";
import { sanitizeZurichText } from "@/lib/insurance/providers/zurich/log-safety";

/**
 * Teste de ligação à Zurich: pede o ficheiro de apólices de hoje com o
 * token em vigor. Só leitura — NÃO emite tokens (emitir um token aqui
 * e não o gravar deixava o sync parado; a renovação é só no cron e em
 * /api/dev/zurich-token).
 *
 * "Código 6/7" = dia sem dados: a ligação e o token estão bons.
 */
export async function GET() {
  const dia = new Date().toISOString().slice(0, 10);

  try {
    await obterFicheiroDia(ZurichTipoFicheiro.Apolices, dia);

    return Response.json({ success: true, tokenAccepted: true, dia });
  } catch (error) {
    const message =
      error instanceof Error
        ? sanitizeZurichText(error.message)
        : "Erro desconhecido.";

    if (message.includes("Código 6") || message.includes("Código 7")) {
      return Response.json({
        success: true,
        tokenAccepted: true,
        dia,
        note: "Sem ficheiro para hoje (normal em dias sem alterações).",
      });
    }

    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
