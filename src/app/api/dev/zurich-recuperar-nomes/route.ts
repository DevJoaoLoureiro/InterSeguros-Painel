import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import {
  recoverZurichClientNames,
  recoverZurichClientNamesFromFile,
} from "@/lib/insurance/providers/zurich/recover-client-names";

/**
 * DEV. Recuperar os nomes dos clientes Zurich que ficaram como
 * "Cliente NIF …" (a Zurich não devolveu a ficha quando a apólice
 * entrou). Ver lib/insurance/providers/zurich/recover-client-names.ts.
 *
 *   /api/dev/zurich-recuperar-nomes                 simulação, 20 clientes
 *   /api/dev/zurich-recuperar-nomes?limit=100       simulação, 100 clientes
 *   /api/dev/zurich-recuperar-nomes?apply=1&limit=100   GRAVA
 *   ...&after=<nextAfter da corrida anterior>       continuar a lista
 *
 * Faz um pedido à Zurich por cliente (com o token em vigor; NUNCA
 * emite tokens). A simulação também pergunta à Zurich — só não grava.
 *
 * MELHOR: POST com o ficheiro de Clientes da Carteira Total (portal
 * MyZurich → Serviços) — não faz NENHUM pedido à Zurich:
 *   POST /api/dev/zurich-recuperar-nomes            (form: ficheiro=<ficheiro>)
 *   POST /api/dev/zurich-recuperar-nomes?apply=1    GRAVA
 *
 * Só OWNER/ADMIN. A resposta não traz nomes nem NIF.
 */

export const maxDuration = 300;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 300;

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
  const apply = searchParams.get("apply") === "1";
  const requested = Number(searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const afterParam = (searchParams.get("after") ?? "").trim();
  const after = /^[0-9a-f-]{36}$/i.test(afterParam) ? afterParam : null;

  try {
    const result = await recoverZurichClientNames({ apply, limit, after });
    return json({ success: true, ...result });
  } catch (error) {
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
}

// Ficheiros da Zurich vêm em Latin-1; um ficheiro já convertido pode
// vir em UTF-8. Usa UTF-8 se for válido, senão Latin-1.
function decodeFile(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("latin1").decode(bytes);
  }
}

export async function POST(request: Request) {
  const profile = await getCurrentProfile();

  if (!profile) {
    return json({ success: false, error: "Não autenticado." }, 401);
  }

  if (profile.role !== "OWNER" && profile.role !== "ADMIN") {
    return json({ success: false, error: "Sem permissões." }, 403);
  }

  const apply = new URL(request.url).searchParams.get("apply") === "1";

  let file: File | null = null;

  try {
    const form = await request.formData();
    const value = form.get("ficheiro");
    file = value instanceof File ? value : null;
  } catch {
    file = null;
  }

  if (!file || file.size === 0) {
    return json(
      {
        success: false,
        error: "Envia o ficheiro de Clientes da Carteira Total no campo \"ficheiro\".",
      },
      400,
    );
  }

  try {
    const content = decodeFile(await file.arrayBuffer());
    const result = await recoverZurichClientNamesFromFile({ content, apply });
    return json({ success: true, ...result });
  } catch (error) {
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
}