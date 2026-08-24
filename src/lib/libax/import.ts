import {
  getIssuedContractsWithDetails,
  getLibaxContract,
  getLibaxBusinessSeller,
} from "@/lib/libax/client";

import {
  createAdminClient,
} from "@/lib/supabase/admin";

export async function runLibaxImport() {
  // ==========================================
  // DATA ATUAL EM PORTUGAL
  // ==========================================

  const today =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "Europe/Lisbon",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      },
    ).format(new Date());

  // ==========================================
  // OBTER CONTRATOS EMITIDOS HOJE
  // ==========================================

  const contracts =
    await getIssuedContractsWithDetails(
      today,
    );

  const supabase =
    createAdminClient();

  let clientsImported = 0;
  let policiesImported = 0;

  // ==========================================
  // IMPORTAR CLIENTES + APÓLICES
  // ==========================================

  for (const contract of contracts) {
    // ------------------------------------------
    // CLIENTE
    // ------------------------------------------

    const {
      data: client,
      error: clientError,
    } = await supabase
      .from("clients")
      .upsert(
        {
          source: "libax",

          external_id:
            String(
              contract.client.id,
            ),

          name:
            contract.client.name,

          nif:
            contract.client.nif,

          email:
            contract.client.email,

          phone:
            contract.client.phone,

          birth_date:
            contract.client.birthDate,

          city:
            contract.client.city,

          street:
            contract.client.street,

          last_synced_at:
            new Date().toISOString(),
        },
        {
          onConflict:
            "source,external_id",
        },
      )
      .select("id")
      .single();

    if (
      clientError ||
      !client
    ) {
      throw new Error(
        `Erro ao guardar cliente ${contract.client.id}: ${
          clientError?.message ??
          "Cliente não devolvido."
        }`,
      );
    }

    clientsImported++;

    // ------------------------------------------
    // APÓLICE
    // ------------------------------------------

    const {
      error: policyError,
    } = await supabase
      .from("policies")
      .upsert(
        {
          source: "libax",

          external_id:
            String(
              contract.contractId,
            ),

          client_id:
            client.id,

          policy_number:
            contract.policyNumber,

          company_external_id:
            String(
              contract.company.id,
            ),

          company_name:
            contract.company.name,

          product_external_id:
            String(
              contract.product.id,
            ),

          product_name:
            contract.product.name,

          line_external_id:
            String(
              contract.line.id,
            ),

          line_name:
            contract.line.name,

          issue_date:
            contract.issueDate,

          start_date:
            contract.startDate,

          end_date:
            contract.endDate,

          renew_date:
            contract.renewDate,

          premium:
            contract.premium,

          fraction_type:
            contract.fractionType,

          status:
            contract.status,

          last_synced_at:
            new Date().toISOString(),
        },
        {
          onConflict:
            "source,external_id",
        },
      );

    if (policyError) {
      throw new Error(
        `Erro ao guardar apólice ${contract.policyNumber}: ${policyError.message}`,
      );
    }

    policiesImported++;
  }

  // ==========================================
  // PROCURAR APÓLICES SEM RESPONSÁVEL
  // ==========================================

  const {
    data: pendingPolicies,
    error: pendingError,
  } = await supabase
    .from("policies")
    .select(`
      id,
      external_id,
      policy_number
    `)
    .eq(
      "source",
      "libax",
    )
    .eq(
      "responsible_pending",
      true,
    )
    .limit(50);

  if (pendingError) {
    throw new Error(
      `Erro ao carregar apólices pendentes: ${pendingError.message}`,
    );
  }

  let responsibleChecked = 0;
  let responsibleUpdated = 0;

  // ==========================================
  // VERIFICAR RESPONSÁVEIS NA LIBAX
  // ==========================================

  for (
    const policy
    of pendingPolicies ?? []
  ) {
    responsibleChecked++;

    try {
      // ----------------------------------------
      // OBTER CONTRATO COMPLETO
      // ----------------------------------------

      const contract =
        await getLibaxContract(
          Number(
            policy.external_id,
          ),
        );

      // ----------------------------------------
      // RESPONSÁVEL = COMMERCIAL (TYPE 2)
      // ----------------------------------------

      const commercial =
        contract.sellers?.find(
          (seller) =>
            seller.sellerType === 2 &&
            seller.sellerId != null,
        );

      // ----------------------------------------
      // AINDA NÃO TEM RESPONSÁVEL
      // ----------------------------------------

      if (
        !commercial?.sellerId
      ) {
        const {
          error: checkError,
        } = await supabase
          .from("policies")
          .update({
            responsible_last_checked_at:
              new Date().toISOString(),
          })
          .eq(
            "id",
            policy.id,
          );

        if (checkError) {
          console.error(
            `Erro ao atualizar verificação da apólice ${policy.policy_number}:`,
            checkError,
          );
        }

        continue;
      }

      // ----------------------------------------
      // OBTER NOME DO SELLER NA BUSINESS API
      // ----------------------------------------

      const seller =
        await getLibaxBusinessSeller(
          commercial.sellerId,
        );

      // ----------------------------------------
      // PROCURAR MAPPING SELLER → USER CRM
      // ----------------------------------------

      const {
        data: mapping,
        error: mappingError,
      } = await supabase
        .from(
          "libax_seller_mappings",
        )
        .select(
          "user_id",
        )
        .eq(
          "libax_seller_id",
          commercial.sellerId,
        )
        .eq(
          "active",
          true,
        )
        .maybeSingle();

      if (mappingError) {
        console.error(
          `Erro ao procurar mapping do seller ${commercial.sellerId}:`,
          mappingError,
        );
      }

      // ----------------------------------------
      // ATUALIZAR APÓLICE
      // ----------------------------------------

      const {
        error: updateError,
      } = await supabase
        .from("policies")
        .update({
          libax_seller_id:
            commercial.sellerId,

          responsible_name:
            seller.name ?? null,

          assigned_user_id:
            mapping?.user_id ??
            null,

          responsible_pending:
            false,

          responsible_last_checked_at:
            new Date().toISOString(),
        })
        .eq(
          "id",
          policy.id,
        );

      if (updateError) {
        throw new Error(
          `Erro ao atualizar responsável da apólice ${policy.policy_number}: ${updateError.message}`,
        );
      }

      responsibleUpdated++;

      console.log(
        `Responsável atualizado: ${policy.policy_number} → ${seller.name ?? "Sem nome"} (${commercial.sellerId})`,
      );
    } catch (error) {
      // Uma apólice com problema não deve
      // parar a importação das restantes.

      console.error(
        `Erro ao sincronizar responsável da apólice ${policy.policy_number}:`,
        error,
      );

      await supabase
        .from("policies")
        .update({
          responsible_last_checked_at:
            new Date().toISOString(),
        })
        .eq(
          "id",
          policy.id,
        );
    }
  }

  // ==========================================
  // RESULTADO
  // ==========================================

  return {
    success: true,

    date:
      today,

    found:
      contracts.length,

    clientsImported,

    policiesImported,

    responsibleChecked,

    responsibleUpdated,
  };
}