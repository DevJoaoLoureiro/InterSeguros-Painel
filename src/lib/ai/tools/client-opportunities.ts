import type { AiUserContext } from "@/lib/ai/context";

import { calculateClientOpportunities } from "@/lib/opportunities/client-opportunities";

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

type OpportunityPolicyRow = {
  line_name: string | null;
  premium: number | null;
  renew_date: string | null;
};

export async function getClientOpportunities(
  context: AiUserContext,
  args: { clientId: string },
) {
  const clientId = args.clientId.trim();

  if (!clientId) {
    throw new Error("clientId obrigatório.");
  }

  // ==========================================
  // APÓLICES DO CLIENTE
  // ==========================================

  let query = context.supabase
    .from("policies")
    .select(`
      annualized_premium,
      renewal_date,
      insurance_line:insurance_lines ( name )
    `)
    .eq("client_id", clientId);

  if (context.storeId) {
    query = query.eq("issuing_store_id", context.storeId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Erro ao analisar oportunidades: ${error.message}`);
  }

  const policies: OpportunityPolicyRow[] = (data ?? []).map((row: any) => ({
    line_name: firstRelation(row.insurance_line)?.name ?? null,
    premium:
      row.annualized_premium === null ? null : Number(row.annualized_premium),
    renew_date: row.renewal_date,
  }));

  if (policies.length === 0) {
    return {
      found: false,
      hasOpportunity: false,
      opportunities: [],
      reason: "Não foram encontradas apólices acessíveis para este cliente.",
    };
  }

  // ==========================================
  // MOTOR DE OPORTUNIDADES
  // ==========================================

  const opportunities = calculateClientOpportunities(policies, context.today);

  return {
    found: true,
    hasOpportunity: opportunities.length > 0,
    opportunityCount: opportunities.length,
    bestOpportunity: opportunities[0] ?? null,
    opportunities,
  };
}