import type {
  SupabaseClient,
} from "@supabase/supabase-js";

export async function resolveProviderStore({
  admin,
  companyId,
  externalCode,
}: {
  admin: SupabaseClient;
  companyId: string;
  externalCode:
    | string
    | number
    | null
    | undefined;
}) {
  if (
    externalCode === null ||
    externalCode === undefined ||
    String(externalCode).trim() === ""
  ) {
    return null;
  }

  const code =
    String(
      externalCode,
    ).trim();

  const {
    data,
    error,
  } = await admin
    .from(
      "store_external_refs",
    )
    .select(
      "store_id",
    )
    .eq(
      "company_id",
      companyId,
    )
    .eq(
      "external_code",
      code,
    )
    .maybeSingle();

  if (error) {
    throw new Error(
      `Erro ao resolver loja para código externo ${code}: ${error.message}`,
    );
  }

  return (
    data?.store_id ??
    null
  );
}