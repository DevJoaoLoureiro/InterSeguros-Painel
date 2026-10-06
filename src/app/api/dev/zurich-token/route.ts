import {
  getZurichTokenStatus,
  renewZurichTokenIfDue,
  setZurichTokenManually,
} from "@/lib/insurance/providers/zurich/token-renewal";
import { sanitizeZurichText } from "@/lib/insurance/providers/zurich/log-safety";

/**
 * DEV (só OWNER/ADMIN — protegido no proxy). Gestão do token Zurich,
 * que vive na BD e é renovado todos os dias pelo cron.
 *
 *   GET  /api/dev/zurich-token
 *        → estado: de onde vem (BD/env), idade, se a renovação está
 *          ligada. Não renova nem chama a Zurich.
 *
 *   POST /api/dev/zurich-token   { "token": "<22 caracteres>" }
 *        → EMERGÊNCIA: gravar um token gerado à mão no MyZurich
 *          (quando o atual já morreu e a renovação não consegue).
 *
 *   POST /api/dev/zurich-token   { "renew": true }
 *        → renovar JÁ (emite um token novo; o atual deixa de valer).
 *          Só com ZURICH_ALLOW_TOKEN_ISSUE=1.
 *
 * NUNCA devolve o token.
 */

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function failure(error: unknown, status = 500) {
  return json(
    {
      success: false,
      error:
        error instanceof Error
          ? sanitizeZurichText(error.message)
          : "Erro desconhecido.",
    },
    status,
  );
}

export async function GET() {
  try {
    return json({ success: true, tokens: await getZurichTokenStatus() });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  let body: { token?: unknown; account?: unknown; renew?: unknown };

  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "Corpo JSON inválido." }, 400);
  }

  try {
    if (body.renew === true) {
      return json({
        success: true,
        renewal: await renewZurichTokenIfDue({ force: true }),
      });
    }

    if (typeof body.token !== "string") {
      return json(
        { success: false, error: 'Indica { "token": "..." } ou { "renew": true }.' },
        400,
      );
    }

    const saved = await setZurichTokenManually(
      body.token,
      typeof body.account === "string" ? body.account : undefined,
    );

    return json({ success: true, saved, tokens: await getZurichTokenStatus() });
  } catch (error) {
    return failure(error, 400);
  }
}
