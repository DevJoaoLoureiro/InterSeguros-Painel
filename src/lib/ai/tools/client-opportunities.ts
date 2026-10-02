import type { AiUserContext } from "@/lib/ai/context";

import { getClientPanel } from "@/app/(dashboard)/clientes/receipts-action";

/*
 * Conselhos do cliente para o assistente — as MESMAS regras da
 * lâmpada no painel do cliente (src/lib/opportunities/client-advice.ts):
 * cobranças, renovações, recuperação, cross-sell e dados em falta.
 */
export async function getClientOpportunities(
  context: AiUserContext,
  args: { clientId: string },
) {
  const clientId = args.clientId.trim();

  if (!clientId) {
    throw new Error("clientId obrigatório.");
  }

  // Mesma visibilidade de antes: com loja ativa, o cliente tem de ter
  // pelo menos uma apólice dessa loja.
  if (context.storeId) {
    const { count } = await context.supabase
      .from("policies")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("issuing_store_id", context.storeId);

    if (!count) {
      return {
        found: false,
        advice: [],
        reason: "Não foram encontradas apólices acessíveis para este cliente.",
      };
    }
  }

  const panel = await getClientPanel(clientId);

  const activePolicies = panel.policies.filter(
    (p) => p.status === "ACTIVE" || p.status === "PENDING",
  );

  return {
    found: true,
    activePolicies: activePolicies.map((p) => ({
      line: p.insurance_line?.name ?? p.product_name,
      company: p.company?.name ?? null,
      annualized_premium: p.annualized_premium,
    })),
    adviceCount: panel.advice.length,
    // Já ordenados: prioridade e depois o que está em risco antes de vender.
    advice: panel.advice.map((a) => ({
      category: a.category,
      priority: a.priority,
      title: a.title,
      reason: a.reason,
      canCreateProcess: a.action.type === "create_process",
      processAlreadyOpen: a.processAlreadyOpen,
    })),
  };
}
