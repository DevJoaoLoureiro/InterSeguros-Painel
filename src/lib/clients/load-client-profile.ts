import { createAdminClient } from "@/lib/supabase/admin";

export type ClientProviderData = {
  company_id: string;
  company_name: string;
  company_code: string | null;
  external_id: string;
  last_synced_at: string | null;
  metadata: Record<string, unknown>;
};

export type ClientProfile = {
  id: string;
  name: string;
  nif: string | null;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  created_at: string;
  updated_at: string;

  // Uma entrada por companhia que tem este cliente.
  providers: ClientProviderData[];
};

function first<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/*
 * Carrega a ficha do cliente SEM verificar acesso — só para usar
 * depois de o chamador já ter validado (assertClientAccess).
 * O ponto de entrada público é getClientProfile (server action).
 */
export async function loadClientProfile(
  clientId: string,
): Promise<ClientProfile> {
  const admin = createAdminClient();

  const [clientResult, refsResult] = await Promise.all([
    admin
      .from("clients")
      .select(
        "id, name, nif, email, phone, birth_date, street, postal_code, city, country, created_at, updated_at",
      )
      .eq("id", clientId)
      .single(),
    admin
      .from("client_external_refs")
      .select(
        "company_id, external_id, last_synced_at, provider_metadata, company:companies ( name, code )",
      )
      .eq("client_id", clientId)
      .order("last_synced_at", { ascending: false, nullsFirst: false }),
  ]);

  if (clientResult.error || !clientResult.data) {
    throw new Error(
      `Erro ao carregar cliente: ${clientResult.error?.message ?? "não encontrado"}`,
    );
  }

  // Se a migração ainda não correu, provider_metadata não existe:
  // mostramos na mesma os dados base do cliente.
  if (refsResult.error) {
    console.error("[clientes] client_external_refs", refsResult.error.message);
  }

  return {
    ...clientResult.data,
    providers: (refsResult.data ?? []).map((ref) => {
      const company = first<{ name: string; code: string | null }>(
        ref.company,
      );

      return {
        company_id: ref.company_id,
        company_name: company?.name ?? "Companhia",
        company_code: company?.code ?? null,
        external_id: ref.external_id,
        last_synced_at: ref.last_synced_at,
        metadata: (ref.provider_metadata ?? {}) as Record<string, unknown>,
      };
    }),
  };
}
