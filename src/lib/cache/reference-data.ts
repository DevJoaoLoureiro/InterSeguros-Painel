import { revalidateTag, unstable_cache } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Dados de referência em cache: lojas, companhias, ramos,
 * utilizadores ativos e parceiros.
 *
 * Mudam raramente mas eram lidos em quase todas as páginas (o layout
 * lia todas as lojas em cada pedido). Ficam em cache 5 minutos e são
 * invalidados na hora quando alguém os altera (lojas, utilizadores,
 * parceiros) — ver invalidateReference().
 *
 * Nota: dados sem permissões aqui — quem chama continua responsável
 * por filtrar o que cada utilizador pode ver.
 */

const REVALIDATE_SECONDS = 300;

export const REFERENCE_TAGS = {
  stores: "ref:stores",
  companies: "ref:companies",
  lines: "ref:insurance-lines",
  profiles: "ref:profiles",
  partners: "ref:partners",
} as const;

export type ReferenceKind = keyof typeof REFERENCE_TAGS;

export type CachedStore = { id: string; name: string; code: string | null };
export type CachedCompany = { id: string; code: string; name: string };
export type CachedLine = {
  id: string;
  code: string;
  name: string;
  plan_type: string | null;
  active: boolean;
};
export type CachedProfile = {
  id: string;
  full_name: string;
  store_id: string | null;
  role: string;
  active: boolean;
};
export type CachedPartner = {
  id: string;
  name: string;
  partner_type: string | null;
  active: boolean;
};

function fail(what: string, message: string): never {
  throw new Error(`Erro ao carregar ${what}: ${message}`);
}

export const getCachedStores = unstable_cache(
  async (): Promise<CachedStore[]> => {
    const { data, error } = await createAdminClient()
      .from("stores")
      .select("id, name, code")
      .order("name", { ascending: true });

    if (error) fail("lojas", error.message);
    return data ?? [];
  },
  ["ref-stores-v1"],
  { revalidate: REVALIDATE_SECONDS, tags: [REFERENCE_TAGS.stores] },
);

export const getCachedCompanies = unstable_cache(
  async (): Promise<CachedCompany[]> => {
    const { data, error } = await createAdminClient()
      .from("companies")
      .select("id, code, name")
      .eq("active", true)
      .order("name", { ascending: true });

    if (error) fail("companhias", error.message);
    return data ?? [];
  },
  ["ref-companies-v1"],
  { revalidate: REVALIDATE_SECONDS, tags: [REFERENCE_TAGS.companies] },
);

export const getCachedInsuranceLines = unstable_cache(
  async (): Promise<CachedLine[]> => {
    const { data, error } = await createAdminClient()
      .from("insurance_lines")
      .select("id, code, name, plan_type, active")
      .order("name", { ascending: true });

    if (error) fail("ramos", error.message);
    return data ?? [];
  },
  ["ref-insurance-lines-v1"],
  { revalidate: REVALIDATE_SECONDS, tags: [REFERENCE_TAGS.lines] },
);

/* Todos os utilizadores (com "active"): os inativos continuam a
 * precisar do nome (ex.: gestor de uma apólice antiga). Para listas
 * de escolha usar getCachedActiveProfiles. */
export const getCachedProfiles = unstable_cache(
  async (): Promise<CachedProfile[]> => {
    const { data, error } = await createAdminClient()
      .from("profiles")
      .select("id, full_name, store_id, role, active")
      .order("full_name", { ascending: true });

    if (error) fail("utilizadores", error.message);
    return data ?? [];
  },
  ["ref-profiles-v1"],
  { revalidate: REVALIDATE_SECONDS, tags: [REFERENCE_TAGS.profiles] },
);

export async function getCachedActiveProfiles() {
  return (await getCachedProfiles()).filter((p) => p.active);
}

/* Todos os parceiros (ativos e inativos): o atual de uma apólice
 * pode estar desativado e tem de continuar a aparecer. */
export const getCachedPartners = unstable_cache(
  async (): Promise<CachedPartner[]> => {
    const { data, error } = await createAdminClient()
      .from("partners")
      .select("id, name, partner_type, active")
      .order("name", { ascending: true });

    if (error) fail("parceiros", error.message);
    return data ?? [];
  },
  ["ref-partners-v1"],
  { revalidate: REVALIDATE_SECONDS, tags: [REFERENCE_TAGS.partners] },
);

/*
 * Chamar depois de alterar lojas/utilizadores/parceiros (em server
 * actions): expira já, para quem fez a alteração a ver logo.
 */
export function invalidateReference(...kinds: ReferenceKind[]) {
  for (const kind of kinds) {
    revalidateTag(REFERENCE_TAGS[kind], { expire: 0 });
  }
}
