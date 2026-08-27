import type {
  AiUserContext,
} from "@/lib/ai/context";

import {
  calculateClientOpportunities,
} from "@/lib/opportunities/client-opportunities";

type OpportunityPolicyRow = {
  line_name: string | null;
  premium: number | null;
  renew_date: string | null;
};

export async function getClientOpportunities(
  context: AiUserContext,
  args: {
    clientId: string;
  },
) {
  const clientId =
    args.clientId.trim();

  if (!clientId) {
    throw new Error(
      "clientId obrigatório.",
    );
  }

  // ==========================================
  // APÓLICES DO CLIENTE
  // ==========================================

  let query =
    context.supabase
      .from("policies")
      .select(`
        line_name,
        premium,
        renew_date
      `)
      .eq(
        "client_id",
        clientId,
      );

  // ==========================================
  // RESPEITAR LOJA / PERMISSÕES
  // ==========================================

  if (context.storeId) {
    query =
      query.eq(
        "store_id",
        context.storeId,
      );
  }

  const {
    data,
    error,
  } = await query;

  if (error) {
    throw new Error(
      `Erro ao analisar oportunidades: ${error.message}`,
    );
  }

  const policies =
    (data ??
      []) as OpportunityPolicyRow[];

  if (policies.length === 0) {
    return {
      found: false,

      hasOpportunity: false,

      opportunities: [],

      reason:
        "Não foram encontradas apólices acessíveis para este cliente.",
    };
  }

  // ==========================================
  // MOTOR DE OPORTUNIDADES
  // ==========================================

  const opportunities =
    calculateClientOpportunities(
      policies,
      context.today,
    );

  // ==========================================
  // RESULTADO
  // ==========================================

  return {
    found: true,

    hasOpportunity:
      opportunities.length > 0,

    opportunityCount:
      opportunities.length,

    bestOpportunity:
      opportunities[0] ?? null,

    opportunities,
  };
}