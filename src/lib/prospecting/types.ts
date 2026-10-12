/*
 * Prospeção: empresas encontradas fora do CRM (pesquisa na web ou
 * Google Places) e avaliadas por regras. Sem imports de servidor: usado também no painel
 * do assistente.
 */

export type ProspectGrade = "boa" | "media" | "ma";

export type Prospect = {
  /* De onde veio: Google Places ou pesquisa na web feita pela IA. */
  source: "google" | "web";
  placeId: string;
  name: string;
  /* Atividade como o Google a descreve (ex.: "Oficina de automóveis"). */
  activity: string;
  address: string;
  locality: string | null;
  phone: string;
  /* Google: sempre. Web: só se o número foi encontrado na página de origem. */
  phoneVerified: boolean;
  website: string | null;
  /* Ficha no Google Maps ou, na pesquisa web, a página onde está o contacto. */
  mapsUrl: string | null;
  rating: number | null;
  reviews: number;
  grade: ProspectGrade;
  score: number;
  reason: string;
  /* Seguros a propor, do mais para o menos provável. */
  products: string[];
  /* Contabilistas e afins: valem mais como parceiros do que como clientes. */
  partnerHint: boolean;
};

export const PROSPECT_GRADE_LABELS: Record<ProspectGrade, string> = {
  boa: "Boa",
  media: "Média",
  ma: "Fraca",
};
