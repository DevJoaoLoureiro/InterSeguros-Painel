import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import {
  getZurichAccounts,
  obterCoberturasPorApolice,
  obterFicheiroDia,
  obterObjetosPorNrApolice,
  ZurichTipoFicheiro,
} from "@/lib/insurance/providers/zurich/client";
import {
  defaultFileDate,
  isValidFileDate,
  runZurichPolicyDebug,
  type DebugOnly,
} from "@/lib/insurance/providers/zurich/debug-policy";
import { sanitizeZurichText } from "@/lib/insurance/providers/zurich/log-safety";

/**
 * TEMPORÁRIA. Diagnóstico isolado das chamadas da Zurich, com a conta
 * cujo storeExternalCode é "12603", o mesmo token e o mesmo host
 * (InfoAgente), no mesmo processo. Remover depois do diagnóstico.
 *
 *   ?policy=<numero>                    objetos + coberturas
 *   ?policy=<numero>&only=objects       só objetos
 *   ?policy=<numero>&only=coverages     só coberturas
 *   ?only=file[&date=AAAA-MM-DD]        só ObterFicheiroDia (Apólices do dia
 *                                       anterior, ou a data indicada)
 *   ?policy=<numero>&only=all[&date=…]  ficheiro, objetos e coberturas, por
 *                                       esta ordem (o ficheiro é o termo de
 *                                       comparação)
 *
 * Cada chamada tem timeout de 15 s e corre em série. NÃO emite nem renova
 * tokens (usa só o do env), NÃO escreve na BD e NÃO usa o backfill.
 * Só OWNER/ADMIN.
 *
 * A resposta é sanitizada: sem token, credenciais, NIF, IBAN, conteúdo da
 * Zurich (nem o ficheiro/base64) nem número de apólice.
 */

const POLICY_PATTERN = /^[A-Za-z0-9._-]{1,32}$/;
const ONLY_VALUES: readonly string[] = ["objects", "coverages", "file", "all"];

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

  const onlyRaw = searchParams.get("only");

  if (onlyRaw !== null && !ONLY_VALUES.includes(onlyRaw)) {
    return json({ success: false, error: "only inválido." }, 400);
  }

  const only = onlyRaw as DebugOnly | null;

  // A apólice só é precisa se houver consultas por apólice.
  const needsPolicy = only !== "file";
  const policyNumber = searchParams.get("policy") ?? "";

  if (needsPolicy && !POLICY_PATTERN.test(policyNumber)) {
    return json(
      {
        success: false,
        error: "Indica ?policy=<numero> (letras, dígitos, . _ -).",
      },
      400,
    );
  }

  const dateRaw = searchParams.get("date");

  if (
    dateRaw !== null &&
    (only === "file" || only === "all") &&
    !isValidFileDate(dateRaw, Date.now())
  ) {
    return json(
      { success: false, error: "date inválida (AAAA-MM-DD, não futura)." },
      400,
    );
  }

  try {
    const result = await runZurichPolicyDebug(
      {
        policyNumber: needsPolicy ? policyNumber : undefined,
        only,
        fileDate: dateRaw ?? defaultFileDate(Date.now()),
      },
      {
        getAccounts: getZurichAccounts,
        lookupObjects: async (number, account) =>
          (await obterObjetosPorNrApolice(number, account)).ListaObjetos,
        lookupCoverages: async (number, account) =>
          (await obterCoberturasPorApolice(number, account)).ListaCoberturas,
        // O resultado (base64) fica só aqui, em memória: o módulo descarta-o.
        lookupFile: (date, account) =>
          obterFicheiroDia(ZurichTipoFicheiro.Apolices, date, account),
        now: () => Date.now(),
      },
    );

    return json(result, result.success ? 200 : 404);
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
