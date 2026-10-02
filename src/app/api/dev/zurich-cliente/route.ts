import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getZurichAccounts,
  obterClientePorIdNif,
} from "@/lib/insurance/providers/zurich/client";

/**
 * DEV. Ver os dados de um cliente: o que a Zurich devolve em bruto
 * (ObterClientePorIDNIF) e o que está guardado no CRM.
 *
 *   /api/dev/zurich-cliente?nif=123456789
 *   /api/dev/zurich-cliente?nif=123456789&source=live     só Zurich
 *   /api/dev/zurich-cliente?nif=123456789&source=db       só CRM
 *   /api/dev/zurich-cliente?id=<IDCliente Zurich>          por ID Zurich
 *   ...&account=<key>                                      conta Zurich
 *                                                          (ZURICH_ACCOUNTS)
 *
 * NÃO emite nem renova tokens (usa o token configurado — o token
 * Zurich é partilhado por vários CRMs). NÃO escreve na BD.
 * Só OWNER/ADMIN. A resposta tem dados pessoais (NIF, NIB, CC):
 * não partilhar nem deixar em logs.
 */

const NIF_PATTERN = /^\d{9}$/;
const ID_PATTERN = /^[A-Za-z0-9]{1,20}$/;

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

  const nif = (searchParams.get("nif") ?? "").replace(/\D/g, "");
  const zurichId = (searchParams.get("id") ?? "").trim();
  const source = searchParams.get("source") ?? "both";
  const accountKey = searchParams.get("account");

  if (!["both", "live", "db"].includes(source)) {
    return json(
      { success: false, error: "source deve ser both, live ou db." },
      400,
    );
  }

  if (nif && !NIF_PATTERN.test(nif)) {
    return json({ success: false, error: "NIF deve ter 9 dígitos." }, 400);
  }

  if (zurichId && !ID_PATTERN.test(zurichId)) {
    return json({ success: false, error: "id inválido." }, 400);
  }

  if (!nif && !zurichId) {
    return json(
      {
        success: false,
        error: "Indica ?nif=<9 dígitos> ou ?id=<IDCliente Zurich>.",
      },
      400,
    );
  }

  const result: Record<string, unknown> = { success: true, nif: nif || null };

  // ----------------------------------------
  // 1. ZURICH EM DIRETO
  // ----------------------------------------

  if (source !== "db") {
    const accounts = getZurichAccounts();
    const account = accountKey
      ? accounts.find((a) => a.key === accountKey)
      : undefined;

    if (accountKey && !account) {
      return json(
        {
          success: false,
          error: `Conta "${accountKey}" não existe.`,
          contas: accounts.map((a) => a.key),
        },
        400,
      );
    }

    try {
      const response = await obterClientePorIdNif(
        {
          clienteNif: nif || undefined,
          clienteId: zurichId || undefined,
        },
        account,
      );

      result.zurich = {
        conta: account?.key ?? "predefinida",
        resposta: response,
      };
    } catch (error) {
      result.zurich = {
        conta: account?.key ?? "predefinida",
        erro: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ----------------------------------------
  // 2. O QUE ESTÁ NO CRM
  // ----------------------------------------

  if (source !== "live" && nif) {
    const admin = createAdminClient();

    const { data: clients, error } = await admin
      .from("clients")
      .select("*")
      .eq("nif", nif);

    if (error) {
      result.crm = { erro: error.message };
    } else {
      const clientIds = (clients ?? []).map((c) => c.id);

      const { data: refs, error: refsError } =
        clientIds.length > 0
          ? await admin
              .from("client_external_refs")
              .select(
                "client_id, external_id, last_synced_at, provider_metadata, company:companies ( code, name )",
              )
              .in("client_id", clientIds)
          : { data: [], error: null };

      result.crm = {
        clientes: clients,
        fichasPorCompanhia: refsError ? { erro: refsError.message } : refs,
      };
    }
  }

  return json(result);
}
