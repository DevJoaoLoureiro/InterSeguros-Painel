import { SECTOR_GUIDE, SECTOR_KEYS, SIZE_CLASSES, type SizeClass } from "./scoring";

/*
 * Pesquisa de empresas na web feita pelo modelo da OpenAI (ferramenta
 * web_search). Usa a chave que o CRM já tem — sem Google nem cartão.
 *
 * O risco é o modelo inventar contactos: por isso cada empresa tem de
 * trazer a página onde o telefone foi lido, e o telefone é validado
 * depois (formato português). Mesmo assim o contacto NÃO é verificado
 * por nós — o cartão diz ao comercial para confirmar na fonte.
 *
 * Este ficheiro só constrói o pedido e valida a resposta (sem rede),
 * para poder ser testado sozinho.
 */

export const WEB_SEARCH_MODEL = "gpt-5-mini";

export type WebCompany = {
  name: string;
  activity: string;
  sectorKey: string;
  address: string;
  locality: string | null;
  phone: string;
  website: string | null;
  sourceUrl: string;
  sizeClass: SizeClass;
  sizeEvidence: string | null;
};

export function buildWebSearchRequest(business: string, zone: string) {
  const instructions = `
Procuras empresas reais em Portugal para a equipa comercial de uma mediadora de seguros.
Usa a pesquisa na web (diretórios de empresas, páginas amarelas, sites das próprias empresas, mapas).

TAREFA
Encontra até 12 empresas do tipo pedido, com sede ou instalações na zona pedida, cada uma com telefone.

QUE EMPRESAS INTERESSAM
- Só PME independentes, de dono local: o tipo de empresa em que se fala com o dono ou o gerente e é ele que decide os seguros.
- NUNCA incluas grandes empresas, cadeias nacionais ou internacionais, franchisings, lojas ou filiais de um grupo, multinacionais, empresas cotadas, hipermercados e supermercados de insígnia (ex.: Sonae, Continente, Pingo Doce, Lidl, Worten, Galp, EDP, McDonald's, Norauto, Remax). Têm corretor próprio e nunca são lead.
- Na dúvida entre uma empresa conhecida e uma pequena empresa local, escolhe sempre a local.
- Dá preferência a empresas com trabalhadores, instalações próprias ou viaturas.

REGRAS
- Só empresas que encontraste MESMO nos resultados da pesquisa. Nunca inventes nem completes dados.
- "phone": o número tal como aparece na página, com 9 dígitos. Se a página não mostra telefone, NÃO incluas a empresa.
- "sourceUrl": o endereço da página onde leste o telefone dessa empresa.
- "website": o site da própria empresa, ou null se não o viste.
- "address" e "locality": como aparecem na página; "locality" é null se não souberes.
- "activity": a atividade em poucas palavras, em português (ex.: "Oficina de automóveis").
- "sectorKey": o setor que melhor descreve a empresa. Opções: ${SECTOR_GUIDE}.
- "sizeClass": a dimensão da empresa — micro (menos de 10 trabalhadores), pequena (10 a 49), media (50 a 249), grande (250 ou mais, OU qualquer cadeia, franchising, grupo ou multinacional). Usa "desconhecida" se a página não der nenhuma pista: não adivinhes.
- "sizeEvidence": a pista que viste na página, em poucas palavras (ex.: "12 trabalhadores segundo o diretório", "frota de 8 camiões", "3 oficinas"). null se "sizeClass" for "desconhecida".
- Não incluas mediadores de seguros, seguradoras, bancos nem entidades públicas.
- Não repitas empresas. Se encontrares menos de 12, devolve só as que encontraste.
`;

  const companySchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string" },
      activity: { type: "string" },
      sectorKey: { type: "string", enum: SECTOR_KEYS },
      address: { type: "string" },
      locality: { type: ["string", "null"] },
      phone: { type: "string" },
      website: { type: ["string", "null"] },
      sourceUrl: { type: "string" },
      sizeClass: { type: "string", enum: [...SIZE_CLASSES] },
      sizeEvidence: { type: ["string", "null"] },
    },
    required: [
      "name",
      "activity",
      "sectorKey",
      "address",
      "locality",
      "phone",
      "website",
      "sourceUrl",
      "sizeClass",
      "sizeEvidence",
    ],
  };

  return {
    model: WEB_SEARCH_MODEL,
    reasoning: { effort: "low" as const },
    instructions,
    input: `Tipo de negócio: ${business}\nZona: ${zone}`,
    tools: [
      {
        type: "web_search" as const,
        user_location: { type: "approximate" as const, country: "PT" },
      },
    ],
    text: {
      format: {
        type: "json_schema" as const,
        name: "empresas",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { companies: { type: "array", items: companySchema } },
          required: ["companies"],
        },
      },
    },
  };
}

/* Fixos (2), móveis (9) e números não geográficos (3, 7, 8), com 9 dígitos. */
export function portuguesePhone(value: string) {
  const digits = value.replace(/\D/g, "").replace(/^(00)?351(?=\d{9}$)/, "");

  return /^[23789]\d{8}$/.test(digits) ? digits : null;
}

function httpUrl(value: unknown) {
  return typeof value === "string" && /^https?:\/\/\S+$/i.test(value.trim()) ? value.trim() : null;
}

/* Só passa o que tem nome, telefone português válido e página de origem. */
export function parseWebCompanies(outputText: string): WebCompany[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(outputText);
  } catch {
    return [];
  }

  const list = (parsed as { companies?: unknown })?.companies;

  if (!Array.isArray(list)) return [];

  const seen = new Set<string>();
  const companies: WebCompany[] = [];

  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;

    const raw = item as Record<string, unknown>;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const phone = typeof raw.phone === "string" ? portuguesePhone(raw.phone) : null;
    const sourceUrl = httpUrl(raw.sourceUrl);

    if (name.length < 2 || !phone || !sourceUrl || seen.has(phone)) continue;

    seen.add(phone);

    companies.push({
      name,
      activity: typeof raw.activity === "string" ? raw.activity.trim() : "",
      sectorKey: typeof raw.sectorKey === "string" ? raw.sectorKey : "outro",
      address: typeof raw.address === "string" ? raw.address.trim() : "",
      locality: typeof raw.locality === "string" && raw.locality.trim() ? raw.locality.trim() : null,
      phone: `${phone.slice(0, 3)} ${phone.slice(3, 6)} ${phone.slice(6)}`,
      website: httpUrl(raw.website),
      sourceUrl,
      sizeClass: SIZE_CLASSES.includes(raw.sizeClass as SizeClass) ? (raw.sizeClass as SizeClass) : "desconhecida",
      sizeEvidence:
        typeof raw.sizeEvidence === "string" && raw.sizeEvidence.trim()
          ? raw.sizeEvidence.trim().slice(0, 120)
          : null,
    });
  }

  return companies;
}
