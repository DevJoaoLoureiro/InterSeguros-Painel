import type { ProspectGrade } from "./types";

/*
 * Avaliação de uma empresa encontrada na prospeção.
 *
 * Regras explícitas, sem IA: o encaixe vem do tipo de negócio (que
 * seguros esse tipo costuma precisar) e de sinais de dimensão. O Google
 * não diz quantos trabalhadores a empresa tem nem que seguros tem — a
 * nota é uma ESTIMATIVA de encaixe, não uma necessidade confirmada.
 *
 * Para afinar ao negócio: mexer em SECTORS (base e seguros por setor).
 */

export const AT = "Acidentes de trabalho";
export const MR = "Multirriscos";
export const FROTA = "Frota automóvel";
export const RC = "Responsabilidade civil";
export const AP = "Acidentes pessoais";

/* Tipo de seguro da lead (lista do CRM) para cada seguro a propor. */
const LEAD_INSURANCE_TYPE: Record<string, string> = {
  [AT]: "Acidentes de trabalho",
  [MR]: "Multirriscos",
  [FROTA]: "Automóvel",
  [AP]: "Acidentes pessoais",
  [RC]: "Outros",
};

export function leadInsuranceType(products: string[]) {
  return LEAD_INSURANCE_TYPE[products[0] ?? ""] ?? "Outros";
}

type Sector = {
  key: string;
  label: string;
  /* Encaixe de partida (0-100) antes dos sinais de dimensão. */
  base: number;
  products: string[];
  why: string;
  types: string[];
  partnerHint?: boolean;
};

const SECTORS: Sector[] = [
  {
    key: "construcao",
    label: "Construção e obras",
    base: 80,
    products: [AT, RC, FROTA],
    why: "atividade de risco, com trabalhadores e viaturas",
    types: ["general_contractor", "electrician", "plumber", "roofing_contractor", "painter"],
  },
  {
    key: "transportes",
    label: "Transportes e logística",
    base: 80,
    products: [FROTA, AT, RC],
    why: "depende de viaturas e de motoristas",
    types: ["moving_company", "courier_service", "taxi_service", "storage", "car_rental"],
  },
  {
    key: "automovel",
    label: "Oficinas e automóvel",
    base: 75,
    products: [AT, MR, RC],
    why: "tem trabalhadores, instalações e viaturas de clientes à guarda",
    types: ["car_repair", "car_dealer", "car_wash", "auto_parts_store", "gas_station"],
  },
  {
    key: "alojamento",
    label: "Alojamento",
    base: 70,
    products: [MR, AT, RC],
    why: "tem instalações, trabalhadores e hóspedes",
    types: ["hotel", "lodging", "guest_house", "bed_and_breakfast", "hostel", "motel", "resort_hotel"],
  },
  {
    key: "restauracao",
    label: "Restauração",
    base: 65,
    products: [MR, AT, RC],
    why: "tem espaço aberto ao público e trabalhadores",
    types: ["restaurant", "cafe", "bar", "bakery", "coffee_shop", "meal_takeaway", "fast_food_restaurant", "pizza_restaurant"],
  },
  {
    key: "saude",
    label: "Saúde",
    base: 60,
    products: [MR, RC, AT],
    why: "tem instalações, equipamento e responsabilidade profissional",
    types: ["dentist", "dental_clinic", "doctor", "physiotherapist", "veterinary_care", "medical_lab", "pharmacy", "hospital"],
  },
  {
    key: "ensino",
    label: "Ensino e crianças",
    base: 55,
    products: [AT, AP, MR],
    why: "tem trabalhadores e alunos a cargo",
    types: ["school", "preschool", "primary_school", "secondary_school", "child_care_agency", "driving_school"],
  },
  {
    key: "comercio",
    label: "Comércio",
    base: 55,
    products: [MR, AT],
    why: "tem loja e stock para proteger",
    types: [
      "store", "supermarket", "grocery_store", "clothing_store", "hardware_store", "furniture_store",
      "electronics_store", "home_goods_store", "shoe_store", "jewelry_store", "pet_store", "florist",
      "convenience_store", "butcher_shop", "book_store", "sporting_goods_store",
    ],
  },
  {
    key: "beleza",
    label: "Beleza e fitness",
    base: 50,
    products: [MR, AT, RC],
    why: "tem espaço aberto ao público",
    types: ["hair_salon", "hair_care", "beauty_salon", "barber_shop", "gym", "fitness_center", "spa", "nail_salon"],
  },
  {
    key: "contabilidade",
    label: "Contabilidade",
    base: 40,
    products: [MR, AT],
    why: "escritório pequeno, mas aconselha muitas empresas",
    types: ["accounting"],
    partnerHint: true,
  },
  {
    key: "servicos",
    label: "Serviços de escritório",
    base: 40,
    products: [MR, AT],
    why: "escritório com poucas necessidades de seguro",
    types: ["lawyer", "real_estate_agency", "travel_agency", "consultant", "corporate_office"],
  },
];

const DEFAULT_SECTOR: Sector = {
  key: "outro",
  label: "Outra atividade",
  base: 45,
  products: [MR, AT],
  why: "atividade sem perfil de seguros definido",
  types: [],
};

/* Concorrentes e entidades a quem não faz sentido vender. */
const EXCLUDED_TYPES = new Set([
  "insurance_agency",
  "bank",
  "atm",
  "city_hall",
  "courthouse",
  "embassy",
  "police",
  "fire_station",
  "post_office",
  "local_government_office",
  "government_office",
]);

const SECTOR_BY_TYPE = new Map<string, Sector>(
  SECTORS.flatMap((sector) => sector.types.map((type) => [type, sector] as const)),
);

/* Setores que a pesquisa na web pode atribuir a uma empresa. */
export const SECTOR_KEYS = [...SECTORS.map((sector) => sector.key), DEFAULT_SECTOR.key];

export const SECTOR_GUIDE = [...SECTORS, DEFAULT_SECTOR]
  .map((sector) => `${sector.key} = ${sector.label}`)
  .join("; ");

const SECTOR_BY_KEY = new Map<string, Sector>(SECTORS.map((sector) => [sector.key, sector] as const));

/*
 * Dimensão estimada pela pesquisa na web. "grande" inclui cadeias
 * nacionais, franchisings, grupos e multinacionais: têm corretor
 * próprio e não compram a um mediador local — ficam sempre de fora.
 */
export const SIZE_CLASSES = ["micro", "pequena", "media", "grande", "desconhecida"] as const;

export type SizeClass = (typeof SIZE_CLASSES)[number];

/* Seguros que o comercial pode escolher como alvo da pesquisa. */
export const TARGET_PRODUCTS = [AT, MR, FROTA, RC] as const;

/*
 * Rede de segurança: marcas que nunca são lead, mesmo que a pesquisa
 * as devolva como "pequenas" (uma loja Continente continua a ser Sonae).
 */
const BIG_BRANDS = [
  // Só nomes inconfundíveis: palavras comuns ("dia", "era", "avis",
  // "brisa") apanhavam pequenos negócios com esse nome.
  "sonae", "continente", "worten", "sport zone", "pingo doce", "jeronimo martins", "lidl", "aldi",
  "auchan", "intermarche", "bricomarche", "mercadona", "minipreco", "el corte ingles", "makro",
  "ikea", "leroy merlin", "maxmat", "conforama", "decathlon", "fnac", "media markt",
  "radio popular", "staples", "primark", "zara", "inditex", "h&m", "c&a",
  "mcdonalds", "mcdonald", "burger king", "kfc", "pizza hut", "telepizza", "dominos", "starbucks",
  "subway", "padaria portuguesa", "ibersol",
  "galp", "repsol", "cepsa", "edp", "meo", "altice", "vodafone", "ctt",
  "mota engil", "teixeira duarte", "norauto", "midas", "feu vert",
  "europcar", "hertz", "sixt", "remax", "century 21",
  "cgd", "caixa geral de depositos", "bcp", "santander", "novo banco", "bpi",
  "fidelidade", "tranquilidade", "allianz", "ageas", "generali", "zurich", "mapfre",
];

function normalizeName(value: string) {
  return ` ${value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9&]+/g, " ")
    .trim()} `;
}

const BIG_BRAND_NAMES = BIG_BRANDS.map(normalizeName);

export function isBigBrand(name: string) {
  const normalized = normalizeName(name);

  return BIG_BRAND_NAMES.some((brand) => normalized.includes(brand));
}

export type PlaceFacts = {
  name?: string;
  primaryType: string | null;
  types: string[];
  /* Setor já identificado (pesquisa na web); tem prioridade sobre os tipos. */
  sectorKey?: string | null;
  /* null = desconhecido (a pesquisa na web não dá avaliações). */
  reviews: number | null;
  /* Só na pesquisa na web: dimensão estimada e de onde vem essa estimativa. */
  sizeClass?: SizeClass | null;
  sizeEvidence?: string | null;
  hasWebsite: boolean;
};

export type ScoreOptions = {
  /* Seguro que o comercial quer vender nesta pesquisa. */
  product?: string | null;
};

export type ProspectScore = {
  excluded: boolean;
  /* Grande empresa, cadeia ou grupo: nunca é lead. */
  tooBig: boolean;
  sector: string;
  grade: ProspectGrade;
  score: number;
  reason: string;
  products: string[];
  partnerHint: boolean;
};

function findSector(facts: PlaceFacts) {
  const known = facts.sectorKey ? SECTOR_BY_KEY.get(facts.sectorKey) : undefined;
  if (known) return known;

  // O tipo principal manda; os restantes só servem de recurso.
  for (const type of [facts.primaryType, ...facts.types]) {
    const sector = type ? SECTOR_BY_TYPE.get(type) : undefined;
    if (sector) return sector;
  }

  return DEFAULT_SECTOR;
}

const SIZE_BY_CLASS: Record<SizeClass, { points: number; text: string }> = {
  pequena: { points: 10, text: "pequena empresa (10 a 49 trabalhadores)" },
  media: { points: 8, text: "média empresa (50 a 249 trabalhadores)" },
  micro: { points: -5, text: "microempresa (menos de 10 trabalhadores)" },
  grande: { points: -100, text: "grande empresa ou cadeia" },
  desconhecida: { points: 0, text: "dimensão por confirmar" },
};

/* Dimensão: avaliações no Google ou, na web, a classe estimada pela pesquisa. */
function sizeSignal(facts: PlaceFacts) {
  const { reviews } = facts;

  if (reviews === null) {
    const size = SIZE_BY_CLASS[facts.sizeClass ?? "desconhecida"];
    const evidence = facts.sizeEvidence?.trim();

    return evidence ? { points: size.points, text: `${size.text} — ${evidence}` } : size;
  }

  if (reviews >= 200) return { points: 12, text: `${reviews} avaliações no Google (negócio com muito movimento)` };
  if (reviews >= 50) return { points: 8, text: `${reviews} avaliações no Google (negócio estabelecido)` };
  if (reviews >= 10) return { points: 3, text: `${reviews} avaliações no Google` };
  if (reviews > 0) return { points: -3, text: `só ${reviews} avaliações no Google (negócio pequeno ou recente)` };
  return { points: -8, text: "sem avaliações no Google (negócio pequeno ou recente)" };
}

export function gradeFromScore(score: number): ProspectGrade {
  if (score >= 70) return "boa";
  if (score >= 50) return "media";
  return "ma";
}

export function scoreProspect(facts: PlaceFacts, options: ScoreOptions = {}): ProspectScore {
  const allTypes = [facts.primaryType, ...facts.types].filter(Boolean) as string[];
  const sector = findSector(facts);
  const size = sizeSignal(facts);

  // Seguro-alvo: sobe quem costuma precisar dele, desce quem não.
  const target = options.product ?? null;
  const fitsTarget = target ? sector.products.includes(target) : null;

  const products =
    target && fitsTarget ? [target, ...sector.products.filter((product) => product !== target)] : sector.products;

  const targetPoints = fitsTarget === null ? 0 : fitsTarget ? 5 : -15;

  const targetText =
    fitsTarget === false && target ? ` ${target} não é típico deste setor.` : "";

  const score = Math.max(
    0,
    Math.min(100, sector.base + size.points + targetPoints + (facts.hasWebsite ? 3 : 0)),
  );

  return {
    excluded: allTypes.some((type) => EXCLUDED_TYPES.has(type)),
    tooBig: facts.sizeClass === "grande" || (facts.name ? isBigBrand(facts.name) : false),
    sector: sector.label,
    grade: gradeFromScore(score),
    score,
    reason: `${sector.label}: ${sector.why}; ${size.text}.${targetText}`,
    products,
    partnerHint: sector.partnerHint ?? false,
  };
}
