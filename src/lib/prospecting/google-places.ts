/*
 * Pesquisa de empresas no Google Places (Text Search, API nova).
 *
 * Precisa de GOOGLE_PLACES_API_KEY (Google Cloud, "Places API (New)"
 * ativa). Os campos de telefone e site põem o pedido no escalão mais
 * caro da API — por isso é um pedido por pesquisa, sem paginação.
 */

const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.rating",
  "places.userRatingCount",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.types",
  "places.businessStatus",
].join(",");

type LocalizedText = { text?: string };

type RawPlace = {
  id?: string;
  displayName?: LocalizedText;
  formattedAddress?: string;
  addressComponents?: { longText?: string; types?: string[] }[];
  nationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  primaryType?: string;
  primaryTypeDisplayName?: LocalizedText;
  types?: string[];
  businessStatus?: string;
};

export type FoundPlace = {
  placeId: string;
  name: string;
  address: string;
  locality: string | null;
  phone: string | null;
  website: string | null;
  mapsUrl: string | null;
  rating: number | null;
  reviews: number;
  primaryType: string | null;
  activity: string | null;
  types: string[];
  operational: boolean;
};

export class PlacesNotConfiguredError extends Error {
  constructor() {
    super("GOOGLE_PLACES_API_KEY não configurada.");
  }
}

function locality(place: RawPlace) {
  const components = place.addressComponents ?? [];

  const find = (type: string) =>
    components.find((component) => component.types?.includes(type))?.longText ?? null;

  return find("locality") ?? find("administrative_area_level_2") ?? find("administrative_area_level_1");
}

export function mapPlace(place: RawPlace): FoundPlace | null {
  const name = place.displayName?.text?.trim();

  if (!place.id || !name) return null;

  return {
    placeId: place.id,
    name,
    address: place.formattedAddress ?? "",
    locality: locality(place),
    phone: place.nationalPhoneNumber?.trim() || null,
    website: place.websiteUri ?? null,
    mapsUrl: place.googleMapsUri ?? null,
    rating: typeof place.rating === "number" ? place.rating : null,
    reviews: place.userRatingCount ?? 0,
    primaryType: place.primaryType ?? null,
    activity: place.primaryTypeDisplayName?.text ?? null,
    types: place.types ?? [],
    // Sem estado, assume-se aberto; só sai o que o Google marca como fechado.
    operational: !place.businessStatus || place.businessStatus === "OPERATIONAL",
  };
}

export async function searchPlaces(textQuery: string): Promise<FoundPlace[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) throw new PlacesNotConfiguredError();

  const response = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery,
      languageCode: "pt-PT",
      regionCode: "PT",
      pageSize: 20,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("[PROSPEÇÃO] Google Places:", response.status, detail);
    throw new Error(`Google Places respondeu ${response.status}.`);
  }

  const data = (await response.json()) as { places?: RawPlace[] };

  return (data.places ?? []).map(mapPlace).filter((place): place is FoundPlace => place !== null);
}
