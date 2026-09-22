import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import {
  getZurichAccounts,
  splitZurichToken,
} from "@/lib/insurance/providers/zurich/client";
import {
  DEBUG_STORE_CODE,
  defaultFileDate,
  isValidFileDate,
} from "@/lib/insurance/providers/zurich/debug-policy";
import { runHttpCompare } from "@/lib/insurance/providers/zurich/http-compare";
import { sanitizeZurichText } from "@/lib/insurance/providers/zurich/log-safety";

/**
 * TEMPORÁRIA. Faz a MESMA chamada Zurich (ObterFicheiroDia, Apólices) duas
 * vezes, em série, com clientes HTTP diferentes do Node:
 *   1) o fetch atual (o que o client.ts usa)
 *   2) https.request nativo
 * com a conta de storeExternalCode "12603", o mesmo token, Basic Auth,
 * host e query. Remover depois do diagnóstico.
 *
 *   GET /api/dev/zurich-http-compare
 *   GET /api/dev/zurich-http-compare?date=AAAA-MM-DD   (omissão: dia anterior)
 *   GET /api/dev/zurich-http-compare?first=https       (inverte a ordem)
 *
 * Cada chamada tem timeout de 15 s (até ~30 s no total). NÃO emite nem
 * renova tokens (usa só o do env), NÃO escreve na BD, NÃO altera o client
 * nem usa o backfill. Só OWNER/ADMIN.
 *
 * A resposta é sanitizada: sem URL/query, token, credenciais, NIF, IBAN,
 * nem qualquer conteúdo da Zurich (o base64 é descartado).
 */

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request) {
  const profile = await getCurrentProfile();

  if (!profile) {
    return json({ success: false, error: "Não autenticado." }, 401);
  }

  if (profile.role !== "OWNER" && profile.role !== "ADMIN") {
    return json({ success: false, error: "Sem permissões." }, 403);
  }

  const { searchParams } = new URL(request.url);

  const dateRaw = searchParams.get("date");

  if (dateRaw !== null && !isValidFileDate(dateRaw, Date.now())) {
    return json(
      { success: false, error: "date inválida (AAAA-MM-DD, não futura)." },
      400,
    );
  }

  const firstRaw = searchParams.get("first");

  if (firstRaw !== null && firstRaw !== "fetch" && firstRaw !== "https") {
    return json({ success: false, error: "first inválido." }, 400);
  }

  try {
    const account = getZurichAccounts().find(
      (candidate) => candidate.storeExternalCode === DEBUG_STORE_CODE,
    );

    if (!account) {
      return json(
        {
          success: false,
          error: "Nenhuma conta configurada com o storeExternalCode pedido.",
        },
        404,
      );
    }

    let token1: string;
    let token2: string;

    try {
      ({ token1, token2 } = splitZurichToken(account.token));
    } catch {
      return json(
        { success: false, error: "Token da conta em falta ou inválido." },
        500,
      );
    }

    const result = await runHttpCompare({
      account,
      token1,
      token2,
      date: dateRaw ?? defaultFileDate(Date.now()),
      first: firstRaw === "https" ? "https" : "fetch",
    });

    return json(result);
  } catch (error) {
    return json(
      {
        success: false,
        error: sanitizeZurichText(
          error instanceof Error ? error.message : "Erro desconhecido.",
        ),
      },
      500,
    );
  }
}
