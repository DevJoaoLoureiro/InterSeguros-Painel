import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  NormalizedPolicy,
} from "@/lib/insurance/types";

import {
  resolveProviderStore,
} from "@/lib/insurance/sync/resolve-provider-store";

type UpsertPolicyResult = {
  policyId: string;
  created: boolean;
};

export async function upsertPolicy({
  supabase,
  companyId,
  clientId,
  insuranceLineId,
  policy,
  metadataPatch,
}: {
  supabase: SupabaseClient;
  companyId: string;
  clientId: string;
  insuranceLineId:
    | string
    | null;
  policy: NormalizedPolicy;

  /**
   * Opcional. Recebe o provider_metadata JÁ GRAVADO (ou {} se não
   * existir) e devolve as chaves a juntar por cima no fim. Permite a
   * um provider reconciliar listas com o que existe (ex.: união de
   * coberturas) sem uma query extra. Sem este parâmetro o
   * comportamento é exatamente o de sempre.
   */
  metadataPatch?: (
    existing: Record<string, unknown>,
  ) => Record<string, unknown>;
}): Promise<UpsertPolicyResult> {
  // ========================================
  // PROCURAR APÃ“LICE EXISTENTE
  // ========================================

  const {
    data: existing,
    error: findError,
  } = await supabase
    .from("policies")
    .select(`
      id,
      issuing_store_id,
      provider_metadata
    `)
    .eq(
      "company_id",
      companyId,
    )
    .eq(
      "external_id",
      policy.externalId,
    )
    .maybeSingle();

  if (findError) {
    throw new Error(
      `Erro ao procurar apÃ³lice: ${findError.message}`,
    );
  }

  // ========================================
  // RESOLVER IDENTIFICADOR EXTERNO DA LOJA
  // ========================================
  //
  // Prioridade:
  //
  // 1. storeExternalCode
  //    -> identificador vindo da fonte
  //       principal/oficial.
  //
  // 2. agentCode
  //    -> compatibilidade com eventual
  //       enriquecimento de outras fontes.
  //
  // Para a PrÃ©voir, neste momento:
  //
  // API oficial:
  //   04931 -> Rio Mau
  //   04932 -> Inter Seguros / Braga
  //   04933 -> Balazar
  //
  // Portal:
  //   10806 -> Rio Mau
  //   10807 -> Inter Seguros / Braga
  //   10808 -> Balazar
  //
  // Os mappings reais estÃ£o guardados em
  // store_external_refs.
  // ========================================

  const storeExternalCode =
    policy.storeExternalCode ??
    policy.agentCode ??
    null;

  const resolvedStoreId =
    await resolveProviderStore({
      admin:
        supabase,

      companyId,

      externalCode:
        storeExternalCode,
    });

  // ========================================
  // PRESERVAR LOJA EXISTENTE
  // ========================================
  //
  // Se aparecer amanhÃ£ um identificador
  // desconhecido, nÃ£o apagamos uma loja
  // anteriormente conhecida.
  // ========================================

  const issuingStoreId =
    resolvedStoreId ??
    existing?.issuing_store_id ??
    null;

  // ========================================
  // PROVIDER METADATA
  // ========================================
  //
  // Preservamos metadata existente.
  //
  // Isto Ã© particularmente importante
  // enquanto ainda temos alguns dados
  // histÃ³ricos obtidos por enriquecimento
  // atravÃ©s do portal.
  // ========================================

  const providerMetadata = {
    ...(
      existing?.provider_metadata ??
      {}
    ),

    ...policy.providerMetadata,

    /*
     * SÃ³ escrevemos dados de agente quando
     * realmente existem.
     *
     * Nunca substituÃ­mos metadata existente
     * por null.
     */
    ...(policy.agentCode
      ? {
          agentCode:
            policy.agentCode,

          agentName:
            policy.agentName,

          teamName:
            policy.teamName,
        }
      : {}),

    /*
     * Guardamos tambÃ©m qual foi o cÃ³digo
     * externo utilizado pelo sync para
     * tentar resolver a loja.
     *
     * Isto ajuda-nos a auditar novos cÃ³digos
     * sem alterar a semÃ¢ntica do valor
     * original prevoirUserId.
     */
    ...(policy.storeExternalCode
      ? {
          storeExternalCode:
            policy.storeExternalCode,
        }
      : {}),

    /*
     * Por último: chaves que o provider reconcilia com o metadata
     * existente (só quando pedido).
     */
    ...(metadataPatch
      ? metadataPatch(
          existing?.provider_metadata &&
            typeof existing.provider_metadata === "object" &&
            !Array.isArray(existing.provider_metadata)
            ? (existing.provider_metadata as Record<string, unknown>)
            : {},
        )
      : {}),
  };

  // ========================================
  // VALORES NORMALIZADOS
  // ========================================

  const values = {
    client_id:
      clientId,

    company_id:
      companyId,

    insurance_line_id:
      insuranceLineId,

    external_id:
      policy.externalId,

    external_version:
      policy.externalVersion,

    policy_number:
      policy.policyNumber,

    product_code:
      policy.productCode,

    product_name:
      policy.productName,

    status:
      policy.status,

    issue_date:
      policy.issueDate,

    start_date:
      policy.startDate,

    renewal_date:
      policy.renewalDate,

    commercial_premium:
      policy.commercialPremium,

    total_premium:
      policy.totalPremium,

    annualized_premium:
      policy.annualizedPremium,

    payment_frequency:
      policy.paymentFrequency,

    issuing_store_id:
      issuingStoreId,

    provider_metadata:
      providerMetadata,

    last_synced_at:
      new Date().toISOString(),
  };

  // ========================================
  // UPDATE
  // ========================================

  if (existing) {
    const {
      error: updateError,
    } = await supabase
      .from("policies")
      .update(values)
      .eq(
        "id",
        existing.id,
      );

    if (updateError) {
      throw new Error(
        `Erro ao atualizar apÃ³lice: ${updateError.message}`,
      );
    }

    const {
      error: refError,
    } = await supabase
      .from(
        "policy_external_refs",
      )
      .upsert(
        {
          policy_id:
            existing.id,

          company_id:
            companyId,

          external_id:
            policy.externalId,

          external_code:
            policy.policyNumber,

          last_synced_at:
            new Date().toISOString(),
        },
        {
          onConflict:
            "company_id,external_id",
        },
      );

    if (refError) {
      throw new Error(
        `Erro policy_external_refs: ${refError.message}`,
      );
    }

    return {
      policyId:
        existing.id,

      created:
        false,
    };
  }

  // ========================================
  // INSERT
  // ========================================

  const {
    data: created,
    error: insertError,
  } = await supabase
    .from("policies")
    .insert(values)
    .select("id")
    .single();

  if (insertError) {
    throw new Error(
      `Erro ao criar apÃ³lice: ${insertError.message}`,
    );
  }

  // ========================================
  // EXTERNAL REF
  // ========================================

  const {
    error: refError,
  } = await supabase
    .from(
      "policy_external_refs",
    )
    .upsert(
      {
        policy_id:
          created.id,

        company_id:
          companyId,

        external_id:
          policy.externalId,

        external_code:
          policy.policyNumber,

        last_synced_at:
          new Date().toISOString(),
      },
      {
        onConflict:
          "company_id,external_id",
      },
    );

  if (refError) {
    throw new Error(
      `Erro policy_external_refs: ${refError.message}`,
    );
  }

  return {
    policyId:
      created.id,

    created:
      true,
  };
}
