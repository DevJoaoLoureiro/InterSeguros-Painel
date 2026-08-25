import {
  enrichLibaxDocuments,
  getLibaxBusinessSeller,
  getLibaxContract,
  getLibaxDocumentsPage,
  getLibaxDocumentsRange,
} from "@/lib/libax/client";

import {
  createAdminClient,
} from "@/lib/supabase/admin";

const INITIAL_WINDOW = 20;
const OVERLAP = 10;
const OLD_PENDING_LIMIT = 10;

export async function runLibaxImport() {
  const today =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Europe/Lisbon",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",
      },
    ).format(
      new Date(),
    );

  const supabase =
    createAdminClient();

  // ==========================================
  // ESTADO
  // ==========================================

  const {
    data: syncState,
    error: syncStateError,
  } = await supabase
    .from(
      "libax_sync_state",
    )
    .select(`
      sync_key,
      last_total,
      last_document_id
    `)
    .eq(
      "sync_key",
      "documents",
    )
    .maybeSingle();

  if (syncStateError) {
    throw new Error(
      `Erro ao carregar estado do sync: ${syncStateError.message}`,
    );
  }

  const probe =
    await getLibaxDocumentsPage(
      0,
      1,
    );

  const currentTotal =
    Number(
      probe.total ?? 0,
    );

  const previousTotal =
    Number(
      syncState?.last_total ??
      0,
    );

  const previousDocumentId =
    syncState?.last_document_id != null
      ? Number(
          syncState.last_document_id,
        )
      : null;

  // ==========================================
  // CURSOR
  // ==========================================

  let startSkip: number;

  if (previousTotal <= 0) {
    startSkip =
      Math.max(
        0,
        currentTotal -
          INITIAL_WINDOW,
      );
  } else if (
    currentTotal >= previousTotal
  ) {
    startSkip =
      Math.max(
        0,
        previousTotal -
          OVERLAP,
      );
  } else {
    // Caso raro:
    // quantidade de Documents diminuiu.
    startSkip =
      Math.max(
        0,
        currentTotal -
          INITIAL_WINDOW,
      );
  }

  console.log(
    "[LIBAX SYNC]",
    {
      today,
      previousTotal,
      previousDocumentId,
      currentTotal,
      startSkip,
    },
  );

  // ==========================================
  // DOCUMENTS
  // ==========================================

  const {
    documents:
      fetchedDocuments,
  } =
    await getLibaxDocumentsRange(
      startSkip,
      currentTotal,
    );

  const uniqueDocuments =
    Array.from(
      new Map(
        fetchedDocuments.map(
          (document) => [
            document.documentId,
            document,
          ],
        ),
      ).values(),
    );

  

  // Na primeira execução processamos
  // a janela inicial.
  //
  // Nas restantes apenas IDs novos.
 const candidateDocuments =
  previousDocumentId == null
    ? uniqueDocuments
    : uniqueDocuments.filter(
        (document) =>
          document.documentId >
          previousDocumentId,
      );



const newDocuments =
  candidateDocuments;

  // ==========================================
  // ENRIQUECER
  // ==========================================

  const contracts =
    await enrichLibaxDocuments(
      newDocuments,
    );

    // ==========================================
// FICAR APENAS COM O RECIBO INICIAL
// DA APÓLICE
// ==========================================
//
// Um recibo só é considerado inicial quando
// o início da cobertura do recibo coincide
// com o início do contrato.
//
// Exemplo:
// contrato.startDate       = 2026-08-24
// documentStartDate        = 2026-08-24
// => primeiro recibo
//
// Recibo seguinte:
// documentStartDate        = 2026-09-24
// => ignorar
// ==========================================

function dateKey(
  value:
    | string
    | null
    | undefined,
) {
  return value
    ? value.slice(0, 10)
    : null;
}

const initialReceiptContracts =
  contracts.filter(
    (contract) => {
      const documentStart =
        dateKey(
          contract.documentStartDate,
        );

      const contractStart =
        dateKey(
          contract.startDate,
        );

      return (
        documentStart !== null &&
        contractStart !== null &&
        documentStart ===
          contractStart
      );
    },
  );


  // ==========================================
// APENAS UM RECIBO POR CONTRATO
// ==========================================

const firstReceiptByContract =
  new Map<
    number,
    (typeof initialReceiptContracts)[number]
  >();

for (
  const contract
  of initialReceiptContracts
) {
  const existing =
    firstReceiptByContract.get(
      contract.contractId,
    );

  if (!existing) {
    firstReceiptByContract.set(
      contract.contractId,
      contract,
    );

    continue;
  }

  const currentIssue =
    dateKey(
      contract.documentIssueDate,
    ) ?? "";

  const existingIssue =
    dateKey(
      existing.documentIssueDate,
    ) ?? "";

  // Ficar com o documento emitido primeiro.
  // Se a data for igual, usar o menor documentId.
  if (
    currentIssue <
      existingIssue ||
    (
      currentIssue ===
        existingIssue &&
      contract.documentId <
        existing.documentId
    )
  ) {
    firstReceiptByContract.set(
      contract.contractId,
      contract,
    );
  }
}

const policiesToImport =
  Array.from(
    firstReceiptByContract.values(),
  );

  let clientsImported = 0;
  let policiesImported = 0;

  let responsibleChecked = 0;
  let responsibleUpdated = 0;

  const processedContracts =
    new Set<number>();

  const processedPolicyIds =
    new Set<string>();

  const sellerCache =
    new Map<
      number,
      Awaited<
        ReturnType<
          typeof getLibaxBusinessSeller
        >
      >
    >();

  async function getSeller(
    sellerId: number,
  ) {
    const existing =
      sellerCache.get(
        sellerId,
      );

    if (existing) {
      return existing;
    }

    const seller =
      await getLibaxBusinessSeller(
        sellerId,
      );

    sellerCache.set(
      sellerId,
      seller,
    );

    return seller;
  }

  // ==========================================
  // GESTOR
  // ==========================================

  async function syncManager(
    policy: {
      id: string;
      policy_number:
        string | null;
    },
    sellers:
      | Array<{
          sellerId: number;
          sellerType: number;
        }>
      | undefined,
  ) {
    responsibleChecked++;

    const manager =
      sellers?.find(
        (seller) =>
          seller.sellerType ===
            3 &&
          seller.sellerId != null,
      );

    if (!manager?.sellerId) {
      await supabase
        .from("policies")
        .update({
          responsible_pending:
            true,

          responsible_last_checked_at:
            new Date().toISOString(),
        })
        .eq(
          "id",
          policy.id,
        );

      return;
    }

    const seller =
      await getSeller(
        manager.sellerId,
      );

    // ------------------------------------------
    // MAPPING EXISTENTE?
    // ------------------------------------------

    let {
      data: mapping,
      error: mappingError,
    } = await supabase
      .from(
        "libax_seller_mappings",
      )
      .select(`
        id,
        user_id,
        active
      `)
      .eq(
        "libax_seller_id",
        manager.sellerId,
      )
      .maybeSingle();

    if (mappingError) {
      throw new Error(
        `Erro ao procurar mapping do gestor ${manager.sellerId}: ${mappingError.message}`,
      );
    }

    // ------------------------------------------
    // SE NÃO EXISTE, CRIA PENDENTE
    // ------------------------------------------

    if (!mapping) {
      const {
        data:
          newMapping,
        error:
          insertMappingError,
      } = await supabase
        .from(
          "libax_seller_mappings",
        )
        .insert({
          libax_seller_id:
            manager.sellerId,

          libax_seller_name:
            seller.name ??
            `Gestor ${manager.sellerId}`,

          user_id:
            null,

          active:
            true,
        })
        .select(`
          id,
          user_id,
          active
        `)
        .single();

      if (
        insertMappingError ||
        !newMapping
      ) {
        throw new Error(
          `Erro ao criar mapping do gestor ${manager.sellerId}: ${
            insertMappingError?.message ??
            "Mapping não devolvido."
          }`,
        );
      }

      mapping =
        newMapping;
    }

    // Atualizar nome,
    // sem mexer no user_id.
    await supabase
      .from(
        "libax_seller_mappings",
      )
      .update({
        libax_seller_name:
          seller.name ??
          `Gestor ${manager.sellerId}`,
      })
      .eq(
        "id",
        mapping.id,
      );

    const hasMapping =
      Boolean(
        mapping.active &&
        mapping.user_id,
      );

    let storeId:
      string | null = null;

    if (
      hasMapping &&
      mapping.user_id
    ) {
      const {
        data: profile,
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
        throw new Error(
          `Erro ao obter loja do utilizador ${mapping.user_id}: ${profileError.message}`,
        );
      }

      storeId =
        profile?.store_id ??
        null;
    }

    const {
      error: updateError,
    } = await supabase
      .from("policies")
      .update({
        libax_seller_id:
          manager.sellerId,

        responsible_name:
          seller.name ??
          null,

        assigned_user_id:
          hasMapping
            ? mapping.user_id
            : null,

        store_id:
          hasMapping
            ? storeId
            : null,

        responsible_pending:
          !hasMapping,

        responsible_last_checked_at:
          new Date().toISOString(),
      })
      .eq(
        "id",
        policy.id,
      );

    if (updateError) {
      throw new Error(
        `Erro ao atualizar gestor da apólice ${policy.policy_number ?? policy.id}: ${updateError.message}`,
      );
    }

    if (hasMapping) {
      responsibleUpdated++;
    }
  }

  // ==========================================
  // CLIENTES + APÓLICES NOVAS
  // ==========================================

for (
  const contract
  of policiesToImport
) {
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

    // CLIENTE
    const {
      data: client,
      error: clientError,
    } = await supabase
      .from("clients")
      .upsert(
        {
          source:
            "libax",

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

    // APÓLICE
    const {
      data: policy,
      error: policyError,
    } = await supabase
      .from("policies")
      .upsert(
        {
          source:
            "libax",

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
            contract.line.id !=
            null
              ? String(
                  contract.line.id,
                )
              : null,

          line_name:
            contract.line.name ??
            null,

          // Emissão do primeiro recibo
          issue_date:
            contract.documentIssueDate,

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
      )
      .select(`
        id,
        policy_number
      `)
      .single();

    if (
      policyError ||
      !policy
    ) {
      throw new Error(
        `Erro ao guardar apólice ${contract.policyNumber}: ${
          policyError?.message ??
          "Apólice não devolvida."
        }`,
      );
    }

    policiesImported++;

    processedPolicyIds.add(
      policy.id,
    );

    // Não voltamos a chamar
    // /Contracts aqui.
    //
    // Os sellers já vieram do
    // enrichLibaxDocuments().
    await syncManager(
      policy,
      contract.sellers,
    );
  }

  // ==========================================
  // PENDENTES ANTIGOS
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
    .limit(
      OLD_PENDING_LIMIT,
    );

  if (pendingError) {
    throw new Error(
      `Erro ao carregar apólices pendentes: ${pendingError.message}`,
    );
  }

  for (
    const policy
    of pendingPolicies ?? []
  ) {
    if (
      processedPolicyIds.has(
        policy.id,
      )
    ) {
      continue;
    }

    try {
      const contractId =
        Number(
          policy.external_id,
        );

      if (
        !Number.isFinite(
          contractId,
        )
      ) {
        continue;
      }

      const contract =
        await getLibaxContract(
          contractId,
        );

      await syncManager(
        policy,
        contract.sellers,
      );
    } catch (error) {
      console.error(
        `[LIBAX] Erro no gestor da apólice ${policy.policy_number}:`,
        error,
      );
    }
  }

  // ==========================================
  // CURSOR
  // ==========================================

  const maxDocumentId =
    uniqueDocuments.reduce<
      number | null
    >(
      (
        current,
        document,
      ) => {
        if (
          current === null ||
          document.documentId >
            current
        ) {
          return document.documentId;
        }

        return current;
      },
      previousDocumentId,
    );

  // Só avançamos depois de tudo acima
  // ter terminado.
  const {
    error: syncUpdateError,
  } = await supabase
    .from(
      "libax_sync_state",
    )
    .upsert(
      {
        sync_key:
          "documents",

        last_total:
          currentTotal,

        last_document_id:
          maxDocumentId,

        updated_at:
          new Date().toISOString(),
      },
      {
        onConflict:
          "sync_key",
      },
    );

  if (syncUpdateError) {
    throw new Error(
      `Erro ao atualizar cursor Libax: ${syncUpdateError.message}`,
    );
  }

  return {
    success: true,

    date:
      today,

    sync: {
      previousTotal,
      currentTotal,
      startSkip,

      documentsFetched:
        uniqueDocuments.length,

      newDocuments:
        newDocuments.length,

      lastDocumentId:
        maxDocumentId,
    },

    uniqueContracts:
      processedContracts.size,

    clientsImported,

    policiesImported,

    responsibleChecked,

    responsibleUpdated,
  };
}