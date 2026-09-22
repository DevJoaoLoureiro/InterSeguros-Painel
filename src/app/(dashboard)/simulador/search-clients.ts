import type { SupabaseClient } from "@supabase/supabase-js";

import { toDateInputValue } from "@/components/simulador/auto-values";
import type {
  SimulatorClient,
  SimulatorVehicle,
} from "@/components/simulador/types";

/*
 * Pesquisa de clientes do simulador, sem dependências do Next (cookies,
 * sessão): recebe o cliente Supabase e o âmbito já resolvido. Assim a mesma
 * lógica pode ser exercitada fora de um pedido HTTP.
 */

export const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 60;
const CLIENT_RESULTS = 8;
const CANDIDATE_PAGE_SIZE = 50;
const MAX_CANDIDATE_PAGES = 6;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export type StoreScope = { ok: true; storeId: string | null } | { ok: false };

/*
 * Loja a que o utilizador pode aceder, com as mesmas regras do resto da
 * app: OWNER/ADMIN seguem a loja escolhida no cabeçalho (cookie; "all" ou
 * ausente = todas), os restantes ficam presos à sua loja.
 */
export function computeStoreScope(input: {
  role: string;
  profileStoreId: string | null;
  selectedStoreCookie: string | null;
}): StoreScope {
  const canAccessAllStores =
    input.role === "OWNER" || input.role === "ADMIN";

  if (canAccessAllStores) {
    const selected = input.selectedStoreCookie ?? "all";

    return {
      ok: true,
      storeId: selected !== "all" && isUuid(selected) ? selected : null,
    };
  }

  return input.profileStoreId
    ? { ok: true, storeId: input.profileStoreId }
    : { ok: false };
}

/** Remove caracteres com significado em padrões LIKE / filtros PostgREST. */
export function toSearchTerm(query: unknown): string {
  return (typeof query === "string" ? query : "")
    .slice(0, MAX_QUERY_LENGTH)
    .replace(/[\\%_,()*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type ClientRow = {
  id: string;
  name: string | null;
  nif: string | null;
  birth_date: string | null;
  postal_code: string | null;
  city: string | null;
};

type PolicyVehicleRow = {
  client_id: string;
  status: string | null;
  vehicle_registration: string | null;
};

function normalizeRegistration(value: string): string | null {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");

  return compact.length === 6
    ? `${compact.slice(0, 2)}-${compact.slice(2, 4)}-${compact.slice(4)}`
    : null;
}

/** Mensagens de erro do Supabase podem ser páginas HTML inteiras (WAF). */
function databaseError(message: string): Error {
  return new Error(message.replace(/\s+/g, " ").slice(0, 200));
}

/**
 * Procura clientes por nome (e por NIF, se o termo parecer um NIF).
 *
 * Com `storeId`, um cliente é visível se tiver pelo menos uma apólice dessa
 * loja OU sem loja atribuída. É a mesma regra da página Clientes
 * (search_clients_portfolio): as apólices Zurich chegam sem
 * `issuing_store_id` e ficam abertas a qualquer loja até alguém se associar
 * (ver assignCurrentUserToPolicy). As matrículas vêm só dessas apólices.
 *
 * Os candidatos (por nome, ordem estável) são lidos por páginas e filtrados
 * por visibilidade até haver `CLIENT_RESULTS` clientes; assim um termo comum
 * não fica sem resultados só porque os primeiros nomes são de outras lojas.
 *
 * Lança em caso de erro da base de dados.
 */
export async function findSimulatorClients(
  admin: SupabaseClient,
  term: string,
  storeId: string | null,
): Promise<SimulatorClient[]> {
  if (term.length < MIN_QUERY_LENGTH) return [];

  // O id entra num filtro textual do PostgREST: só aceita UUIDs.
  if (storeId && !isUuid(storeId)) throw new Error("Loja inválida.");

  const results = new Map<string, SimulatorClient>();

  for (let page = 0; page < MAX_CANDIDATE_PAGES; page++) {
    const candidates = await fetchCandidatePage(admin, term, page);

    if (candidates.length === 0) break;

    for (const client of await withVisiblePolicies(admin, candidates, storeId)) {
      if (results.size < CLIENT_RESULTS) results.set(client.id, client);
    }

    if (results.size >= CLIENT_RESULTS || candidates.length < CANDIDATE_PAGE_SIZE) {
      break;
    }
  }

  return Array.from(results.values());
}

async function fetchCandidatePage(
  admin: SupabaseClient,
  term: string,
  page: number,
): Promise<ClientRow[]> {
  const columns = "id, name, nif, birth_date, postal_code, city";
  const from = page * CANDIDATE_PAGE_SIZE;
  const to = from + CANDIDATE_PAGE_SIZE - 1;

  const searches = [
    admin
      .from("clients")
      .select(columns)
      .ilike("name", `%${term}%`)
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  ];

  // Um NIF só precisa da primeira página (raramente há mais que um cliente).
  if (page === 0 && /^d{3,}$/.test(term)) {
    searches.push(
      admin
        .from("clients")
        .select(columns)
        .ilike("nif", `${term}%`)
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(0, CANDIDATE_PAGE_SIZE - 1),
    );
  }

  const found = await Promise.all(searches);
  const candidates = new Map<string, ClientRow>();

  for (const result of found) {
    if (result.error) throw databaseError(result.error.message);

    for (const row of (result.data ?? []) as unknown as ClientRow[]) {
      candidates.set(row.id, row);
    }
  }

  // Tamanho da página de nomes (não do conjunto unido) decide se há mais.
  const nameRows = found[0].data?.length ?? 0;

  return nameRows === 0 && candidates.size === 0
    ? []
    : Array.from(candidates.values()).slice(0, CANDIDATE_PAGE_SIZE * 2);
}

/** Apólices dos candidatos: definem a visibilidade (loja) e as matrículas. */
async function withVisiblePolicies(
  admin: SupabaseClient,
  candidates: ClientRow[],
  storeId: string | null,
): Promise<SimulatorClient[]> {
  let policiesQuery = admin
    .from("policies")
    .select(
      "client_id, status, vehicle_registration:provider_metadata->>vehicleRegistration",
    )
    .in(
      "client_id",
      candidates.map((row) => row.id),
    );

  if (storeId) {
    policiesQuery = policiesQuery.or(
      `issuing_store_id.eq.${storeId},issuing_store_id.is.null`,
    );
  }

  const { data: policyData, error: policiesError } = await policiesQuery;

  if (policiesError) throw databaseError(policiesError.message);

  const vehiclesByClient = new Map<string, Map<string, SimulatorVehicle>>();
  const visibleClientIds = new Set<string>();

  for (const policy of (policyData ?? []) as unknown as PolicyVehicleRow[]) {
    visibleClientIds.add(policy.client_id);

    const registration = policy.vehicle_registration
      ? normalizeRegistration(policy.vehicle_registration)
      : null;

    if (!registration) continue;

    const vehicles =
      vehiclesByClient.get(policy.client_id) ??
      new Map<string, SimulatorVehicle>();
    const existing = vehicles.get(registration);

    vehicles.set(registration, {
      registration,
      active: (existing?.active ?? false) || policy.status === "ACTIVE",
    });
    vehiclesByClient.set(policy.client_id, vehicles);
  }

  return (
    candidates
      // Sem âmbito de loja, qualquer cliente é visível (mesmo sem apólices).
      // Com âmbito, exige-se pelo menos uma apólice visível (ver acima).
      .filter((row) => !storeId || visibleClientIds.has(row.id))
      .map((row) => ({
        id: row.id,
        name: row.name?.trim() || "Sem nome",
        nif: row.nif,
        birthDate: toDateInputValue(row.birth_date) || null,
        postalCode: row.postal_code,
        city: row.city,
        vehicles: Array.from(vehiclesByClient.get(row.id)?.values() ?? []).sort(
          (a, b) => Number(b.active) - Number(a.active),
        ),
      }))
  );
}
