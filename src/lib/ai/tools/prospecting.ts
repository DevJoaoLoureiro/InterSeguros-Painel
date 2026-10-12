import type { AiUserContext } from "@/lib/ai/context";
import { searchPlaces } from "@/lib/prospecting/google-places";
import { scoreProspect, TARGET_PRODUCTS, type SizeClass } from "@/lib/prospecting/scoring";
import type { Prospect } from "@/lib/prospecting/types";
import { searchWebCompanies } from "@/lib/prospecting/web-search";

/* Referência da lead no CRM: evita guardar a mesma empresa duas vezes. */
export function prospectSourceReference(placeId: string) {
  return `prospecao:${placeId}`;
}

/* Últimos 9 dígitos: "+351 912 345 678" e "912345678" são o mesmo. */
export function phoneKey(phone: string | null | undefined) {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : null;
}

/* Apanha o número guardado com ou sem espaços ("912 345 678"). */
function phoneFilter(key: string) {
  return `phone.ilike.%${key.slice(0, 3)}%${key.slice(3, 6)}%${key.slice(6)}%`;
}

/* Empresa encontrada, venha do Google ou da pesquisa na web. */
type Candidate = {
  source: Prospect["source"];
  placeId: string;
  name: string;
  activity: string | null;
  address: string;
  locality: string | null;
  phone: string | null;
  phoneVerified: boolean;
  website: string | null;
  mapsUrl: string | null;
  rating: number | null;
  reviews: number | null;
  primaryType: string | null;
  types: string[];
  sectorKey: string | null;
  sizeClass: SizeClass | null;
  sizeEvidence: string | null;
  operational: boolean;
};

/*
 * Fonte das empresas:
 * - Google Places, se GOOGLE_PLACES_API_KEY estiver configurada e a
 *   responder (telefone e avaliações de quase todas as empresas);
 * - senão, pesquisa na web pelo modelo da OpenAI (sem conta Google).
 */
async function findCandidates(business: string, zone: string): Promise<Candidate[]> {
  if (process.env.GOOGLE_PLACES_API_KEY) {
    try {
      const places = await searchPlaces(`${business} em ${zone}`);

      return places.map((place) => ({
        ...place,
        source: "google",
        phoneVerified: true,
        sectorKey: null,
        sizeClass: null,
        sizeEvidence: null,
      }));
    } catch (error) {
      console.error("[PROSPEÇÃO] Google Places falhou, a usar a pesquisa na web:", error);
    }
  }

  const companies = await searchWebCompanies(business, zone);

  return companies.map((company) => ({
    source: "web",
    placeId: `tel-${phoneKey(company.phone)}`,
    name: company.name,
    activity: company.activity,
    address: company.address,
    locality: company.locality,
    phone: company.phone,
    phoneVerified: company.phoneVerified,
    website: company.website,
    mapsUrl: company.sourceUrl,
    rating: null,
    reviews: null,
    primaryType: null,
    types: [],
    sectorKey: company.sectorKey,
    sizeClass: company.sizeClass,
    sizeEvidence: company.sizeEvidence,
    operational: true,
  }));
}

type SearchProspectsArgs = {
  business: string;
  zone: string;
  /* Seguro que o comercial quer vender, ou null para qualquer um. */
  product: string | null;
};

/* Pedidos demasiado vagos trazem as empresas mais conhecidas do país. */
const VAGUE_BUSINESS = /^(empresas?|negocios?|leads?|clientes?|pme|pmes|tudo|qualquer( coisa)?)$/i;
const WHOLE_COUNTRY = /^(portugal( continental)?|pais|todo o pais|nacional)$/i;

function plain(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

/* O texto vem da conversa e segue para a pesquisa: só letras, números e espaços. */
function clean(value: string) {
  return value.replace(/[^\p{L}\p{N}\s.,'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export async function searchProspects(context: AiUserContext, args: SearchProspectsArgs) {
  const business = clean(args.business);
  const zone = clean(args.zone);

  const product = TARGET_PRODUCTS.find((target) => target === args.product) ?? null;

  if (!business || VAGUE_BUSINESS.test(plain(business))) {
    return {
      error:
        "Falta o tipo de negócio concreto (ex.: oficinas, empresas de construção, restaurantes). Pergunta ao utilizador.",
    };
  }

  if (!zone || WHOLE_COUNTRY.test(plain(zone))) {
    return {
      error:
        "Falta a zona concreta: concelho ou cidade (ex.: Braga, Guimarães). Pergunta ao utilizador.",
    };
  }

  let places: Candidate[];

  try {
    places = await findCandidates(business, zone);
  } catch (error) {
    console.error("[PROSPEÇÃO] Pesquisa falhou:", error);
    return { error: "Não foi possível pesquisar empresas neste momento." };
  }

  const open = places.filter((place) => place.operational);
  const contactable = open.filter((place) => phoneKey(place.phone));

  // ==========================================
  // EMPRESAS QUE JÁ SÃO LEADS OU CLIENTES
  // ==========================================

  const knownRefs = new Set<string>();
  const knownPhones = new Set<string>();

  if (contactable.length > 0) {
    const refs = contactable.map((place) => prospectSourceReference(place.placeId));
    const phoneFilters = contactable.map((place) => phoneFilter(phoneKey(place.phone)!)).join(",");

    const [leadsByRef, leadsByPhone, clientsByPhone] = await Promise.all([
      context.supabase.from("leads").select("source_reference").in("source_reference", refs),
      context.supabase.from("leads").select("phone").or(phoneFilters),
      context.supabase.from("clients").select("phone").or(phoneFilters),
    ]);

    for (const result of [leadsByRef, leadsByPhone, clientsByPhone]) {
      if (result.error) {
        throw new Error(`Erro ao verificar leads e clientes existentes: ${result.error.message}`);
      }
    }

    for (const row of leadsByRef.data ?? []) {
      if (row.source_reference) knownRefs.add(row.source_reference);
    }

    for (const row of [...(leadsByPhone.data ?? []), ...(clientsByPhone.data ?? [])]) {
      const key = phoneKey(row.phone);
      if (key) knownPhones.add(key);
    }
  }

  // ==========================================
  // AVALIAR
  // ==========================================

  let alreadyKnown = 0;
  let excluded = 0;
  let tooBig = 0;
  let weak = 0;

  const prospects: Prospect[] = [];

  for (const place of contactable) {
    if (
      knownRefs.has(prospectSourceReference(place.placeId)) ||
      knownPhones.has(phoneKey(place.phone)!)
    ) {
      alreadyKnown += 1;
      continue;
    }

    const score = scoreProspect(
      {
        name: place.name,
        primaryType: place.primaryType,
        types: place.types,
        sectorKey: place.sectorKey,
        reviews: place.reviews,
        sizeClass: place.sizeClass,
        sizeEvidence: place.sizeEvidence,
        hasWebsite: Boolean(place.website),
      },
      { product },
    );

    if (score.tooBig) {
      tooBig += 1;
      continue;
    }

    if (score.excluded) {
      excluded += 1;
      continue;
    }

    // Só segue o que vale a chamada: as fracas ficam de fora.
    if (score.grade === "ma") {
      weak += 1;
      continue;
    }

    prospects.push({
      source: place.source,
      placeId: place.placeId,
      name: place.name,
      activity: place.activity || score.sector,
      address: place.address,
      locality: place.locality,
      phone: place.phone!,
      phoneVerified: place.phoneVerified,
      website: place.website,
      mapsUrl: place.mapsUrl,
      rating: place.rating,
      reviews: place.reviews ?? 0,
      grade: score.grade,
      score: score.score,
      reason: score.reason,
      products: score.products,
      partnerHint: score.partnerHint,
    });
  }

  // Melhor nota primeiro; em empate, telefone confirmado à frente.
  prospects.sort((a, b) => b.score - a.score || Number(b.phoneVerified) - Number(a.phoneVerified));

  return {
    prospects,
    summary: {
      found: places.length,
      closed: places.length - open.length,
      withoutPhone: open.length - contactable.length,
      alreadyKnown,
      excluded,
      tooBig,
      weak,
    },
  };
}

export type SearchProspectsResult = Awaited<ReturnType<typeof searchProspects>>;
