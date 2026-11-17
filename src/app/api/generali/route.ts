import {
  getGeneraliEnv,
  obterApolicePorNr,
  obterClientePorNr,
  obterDetalheApolice,
  obterListas,
  obterReciboPorNr,
  testGeneraliLogin,
} from "@/lib/insurance/providers/generali/client";
import {
  syncGenerali,
  type GeneraliSyncOptions,
} from "@/lib/insurance/providers/generali/sync";
import type { GeneraliRecurso } from "@/lib/insurance/providers/generali/types";

export const dynamic = "force-dynamic";

/*
 * Ferramenta de administração da integração Generali.
 * Só OWNER/ADMIN (proxy.ts: /api/generali/*).
 *
 * GET (só leitura, nada é gravado):
 *   ?op=login                 confirma as credenciais (pede um token)
 *   ?op=listas[&servico=…]    tabela de códigos da API
 *   ?op=apolice&nr=…          uma apólice em bruto   (dados pessoais)
 *   ?op=detalhe&nr=…          coberturas/veículo     (dados pessoais)
 *   ?op=recibo&nr=…           um recibo em bruto
 *   ?op=cliente&nr=…          um cliente em bruto    (dados pessoais)
 *   ?op=preview[&recurso=Apolices|Recibos|Clientes]
 *                             1.ª página do sync, já convertida, sem gravar
 *
 * POST (grava na BD — o .env.local aponta para PRODUÇÃO):
 *   corpo JSON opcional: {"resources":["Apolices"],"maxPages":5,"skipInitialLoad":false}
 */

const RECURSOS: GeneraliRecurso[] = ["Apolices", "Recibos", "Clientes"];

function parseRecursos(value: unknown): GeneraliRecurso[] | undefined {
  const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const valid = list.filter((item): item is GeneraliRecurso =>
    RECURSOS.includes(item as GeneraliRecurso),
  );

  return valid.length > 0 ? valid : undefined;
}

function fail(error: unknown, status = 500) {
  return Response.json(
    {
      success: false,
      env: getGeneraliEnv(),
      error: error instanceof Error ? error.message : String(error),
    },
    { status },
  );
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const op = params.get("op") ?? "login";
  const nr = params.get("nr")?.trim() ?? "";

  if (["apolice", "detalhe", "recibo", "cliente"].includes(op) && !nr) {
    return fail(new Error(`Falta ?nr= para op=${op}.`), 400);
  }

  try {
    switch (op) {
      case "login":
        return Response.json({ success: true, ...(await testGeneraliLogin()) });

      case "listas":
        return Response.json({
          success: true,
          listas: await obterListas({
            servico: params.get("servico") ?? undefined,
            campo: params.get("campo") ?? undefined,
          }),
        });

      case "apolice":
        return Response.json({ success: true, apolice: await obterApolicePorNr(nr) });

      case "detalhe":
        return Response.json({ success: true, detalhe: await obterDetalheApolice(nr) });

      case "recibo":
        return Response.json({ success: true, recibo: await obterReciboPorNr(nr) });

      case "cliente":
        return Response.json({ success: true, cliente: await obterClientePorNr(nr) });

      case "preview":
        return Response.json({
          success: true,
          ...(await syncGenerali({
            dryRun: true,
            resources: parseRecursos(params.get("recurso")) ?? ["Apolices"],
          })),
        });

      default:
        return fail(new Error(`op desconhecida: ${op}`), 400);
    }
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const options: GeneraliSyncOptions = {
    resources: parseRecursos(body.resources),
    maxPages: Number.isInteger(body.maxPages) ? Number(body.maxPages) : undefined,
    skipInitialLoad: body.skipInitialLoad === true,
  };

  try {
    const result = await syncGenerali(options);
    return Response.json({ success: result.ok, ...result }, { status: result.ok ? 200 : 500 });
  } catch (error) {
    return fail(error);
  }
}
