import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  NormalizedPrevoirPolicy,
} from "@/lib/insurance/providers/prevoir/mapper";
import { fillMissingContacts } from "@/lib/insurance/sync/client-contacts";

type UpsertClientResult = {
  clientId: string;
  created: boolean;
};

function cleanNif(
  value: string | null,
) {
  if (!value) {
    return null;
  }

  const cleaned = value.replace(
    /\D/g,
    "",
  );

  return cleaned || null;
}

export async function upsertClient({
  supabase,
  companyId,
  externalClientId,
  policy,
}: {
  supabase: SupabaseClient;
  companyId: string;
  externalClientId: string;
  policy: NormalizedPrevoirPolicy;
}): Promise<UpsertClientResult> {
  const nif = cleanNif(
    policy.client.nif,
  );

  const clientMetadata =
    policy.client.metadata &&
    Object.keys(policy.client.metadata).length > 0
      ? policy.client.metadata
      : null;

  // ========================================
  // 1. REFERÊNCIA EXTERNA
  // ========================================

  const {
    data: externalRef,
    error: externalRefError,
  } = await supabase
    .from("client_external_refs")
    .select("client_id")
    .eq("company_id", companyId)
    .eq(
      "external_id",
      externalClientId,
    )
    .maybeSingle();

  if (externalRefError) {
    throw new Error(
      `Erro client_external_refs: ${externalRefError.message}`,
    );
  }

  if (externalRef?.client_id) {
    const { error } = await supabase
      .from("clients")
      .update({
        name: policy.client.name,
        nif,
        birth_date:
          policy.client.birthDate,
        street: policy.client.street,
        postal_code:
          policy.client.postalCode,
        city: policy.client.city,
        updated_at:
          new Date().toISOString(),
      })
      .eq(
        "id",
        externalRef.client_id,
      );

    if (error) {
      throw new Error(
        `Erro ao atualizar cliente: ${error.message}`,
      );
    }

    // Telefone/email da companhia: só preenchem o que está vazio.
    await fillMissingContacts(supabase, externalRef.client_id, {
      phone: policy.client.phone,
      email: policy.client.email,
    });

    // Ficha completa do cliente desta companhia (aba "Dados do
    // cliente"). Só escreve quando a companhia enviou dados.
    if (clientMetadata) {
      const { error: metadataError } = await supabase
        .from("client_external_refs")
        .update({
          provider_metadata: clientMetadata,
          last_synced_at: new Date().toISOString(),
        })
        .eq("company_id", companyId)
        .eq("external_id", externalClientId);

      if (metadataError) {
        throw new Error(
          `Erro ao guardar dados do cliente: ${metadataError.message}`,
        );
      }
    }

    return {
      clientId:
        externalRef.client_id,
      created: false,
    };
  }

  // ========================================
  // 2. TENTAR MATCH POR NIF
  // ========================================

  let existingClientId:
    | string
    | null = null;

  if (nif) {
    const {
      data: existingClient,
      error,
    } = await supabase
      .from("clients")
      .select("id")
      .eq("nif", nif)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Erro ao procurar cliente por NIF: ${error.message}`,
      );
    }

    existingClientId =
      existingClient?.id ?? null;
  }

  // ========================================
  // 3. CRIAR SE NÃO EXISTIR
  // ========================================

  let clientId =
    existingClientId;

  let created = false;

  if (!clientId) {
    const {
      data: createdClient,
      error,
    } = await supabase
      .from("clients")
      .insert({
        name: policy.client.name,
        nif,
        birth_date:
          policy.client.birthDate,
        street: policy.client.street,
        postal_code:
          policy.client.postalCode,
        city: policy.client.city,
        country: "Portugal",
        phone: policy.client.phone ?? null,
        email: policy.client.email ?? null,
      })
      .select("id")
      .single();

    if (error) {
      throw new Error(
        `Erro ao criar cliente: ${error.message}`,
      );
    }

    clientId =
      createdClient.id;

    created = true;
  } else {
    // Cliente já existente (encontrado pelo NIF, vindo de outra
    // companhia): só preenche contactos em falta.
    await fillMissingContacts(supabase, clientId, {
      phone: policy.client.phone,
      email: policy.client.email,
    });
  }

  if (!clientId) {
    throw new Error(
      "Erro: clientId não definido",
    );
  }

  // ========================================
  // 4. CRIAR REFERÊNCIA PROVIDER
  // ========================================

  const { error: refError } =
    await supabase
      .from("client_external_refs")
      .upsert(
        {
          client_id: clientId,
          company_id: companyId,
          external_id:
            externalClientId,
          last_synced_at:
            new Date().toISOString(),
          ...(clientMetadata
            ? { provider_metadata: clientMetadata }
            : {}),
        },
        {
          onConflict:
            "company_id,external_id",
        },
      );

  if (refError) {
    throw new Error(
      `Erro ao criar referência externa do cliente: ${refError.message}`,
    );
  }

  return {
    clientId,
    created,
  };
}