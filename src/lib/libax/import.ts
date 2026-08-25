import {
  getIssuedDocumentsWithDetails,
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
  // OBTER DOCUMENTOS / RECIBOS EMITIDOS HOJE
  //
  // A descoberta é feita por:
  // Documents.issueDate
  //
  // Depois:
  // Document.contractId → Contract
  // ==========================================

  const contracts =
    await getIssuedDocumentsWithDetails(
      today,
    );

  const supabase =
    createAdminClient();

  let clientsImported = 0;
  let policiesImported = 0;

  // Evita processar a mesma apólice
  // várias vezes caso tenha vários
  // documentos emitidos no mesmo dia.
  const processedContracts =
    new Set<number>();

  // ==========================================
  // IMPORTAR CLIENTES + APÓLICES
  // ==========================================

  for (const contract of contracts) {
    // ------------------------------------------
    // EVITAR CONTRATO DUPLICADO
    // ------------------------------------------

    if (
      processedContracts.has(
        contract.contractId,
      )
    ) {
      continue;
    }

    processedContracts.add(
      contract.contractId,
    );

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
    //
    // IMPORTANTE:
    //
    // issue_date = emissão da APÓLICE
    //
    // documentIssueDate foi usada apenas
    // para descobrir que este contrato
    // devia ser importado neste dia.
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

          // Emissão da APÓLICE
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
  // VERIFICAR GESTORES NA LIBAX
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
      // GESTOR = MANAGER
      //
      // Libax SellerType:
      //
      // 0 = Seller
      // 1 = Mediation
      // 2 = Commercial
      // 3 = Manager       <-- QUEREMOS ESTE
      // 4 = Source
      // ----------------------------------------

      const manager =
        contract.sellers?.find(
          (seller) =>
            seller.sellerType === 3 &&
            seller.sellerId != null,
        );

      // ----------------------------------------
      // CONTRATO AINDA NÃO TEM GESTOR
      // ----------------------------------------

      if (
        !manager?.sellerId
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
      // OBTER DADOS DO GESTOR NA BUSINESS API
      // ----------------------------------------

      const seller =
        await getLibaxBusinessSeller(
          manager.sellerId,
        );

      // ----------------------------------------
      // PROCURAR MAPPING
      //
      // LIBAX MANAGER → USER CRM
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
          manager.sellerId,
        )
        .eq(
          "active",
          true,
        )
        .maybeSingle();

      if (mappingError) {
        console.error(
          `Erro ao procurar mapping do gestor ${manager.sellerId}:`,
          mappingError,
        );
      }

      // ----------------------------------------
      // DESCOBRIR LOJA DO USER CRM
      // ----------------------------------------

      let mappedStoreId:
        string | null = null;

      if (mapping?.user_id) {
        const {
          data: mappedProfile,
          error: profileError,
        } = await supabase
          .from("profiles")
          .select(
            "store_id",
          )
          .eq(
            "id",
            mapping.user_id,
          )
          .maybeSingle();

        if (profileError) {
          console.error(
            `Erro ao procurar loja do utilizador ${mapping.user_id}:`,
            profileError,
          );
        }

        mappedStoreId =
          mappedProfile?.store_id ??
          null;
      }

      // ----------------------------------------
      // ATUALIZAR APÓLICE
      // ----------------------------------------

      const {
        error: updateError,
      } = await supabase
        .from("policies")
        .update({
          // ID do MANAGER na Libax
          libax_seller_id:
            manager.sellerId,

          // Nome do MANAGER
          responsible_name:
            seller.name ??
            null,

          // Utilizador CRM correspondente
          assigned_user_id:
            mapping?.user_id ??
            null,

          // Loja desse utilizador
          store_id:
            mappedStoreId,

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
          `Erro ao atualizar gestor da apólice ${policy.policy_number}: ${updateError.message}`,
        );
      }

      responsibleUpdated++;

      console.log(
        `Gestor atualizado: ${policy.policy_number} → ${
          seller.name ??
          "Sem nome"
        } (${manager.sellerId})`,
      );
    } catch (error) {
      // Uma apólice com problema não deve
      // parar a importação das restantes.

      console.error(
        `Erro ao sincronizar gestor da apólice ${policy.policy_number}:`,
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

    documentsFound:
      contracts.length,

    uniqueContracts:
      processedContracts.size,

    clientsImported,

    policiesImported,

    responsibleChecked,

    responsibleUpdated,
  };
}