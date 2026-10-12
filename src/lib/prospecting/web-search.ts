import { openai } from "@/lib/ai/openai";

import { buildWebSearchRequest, parseWebCompanies, type WebCompany } from "./web-search-request";

export type VerifiedWebCompany = WebCompany & {
  /* O telefone foi encontrado por nós na página de origem. */
  phoneVerified: boolean;
};

const PAGE_TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;
const MAX_PAGE_CHARS = 1_500_000;

/* O endereço vem do modelo: só sites públicos, nunca a rede interna. */
function isPublicUrl(value: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();

  // Sem IPs diretos nem nomes internos: só domínios normais.
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":")) return false;

  return !/(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host);
}

async function fetchPage(startUrl: string) {
  let url = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isPublicUrl(url)) return null;

    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; InterSegurosCRM/1.0)" },
      cache: "no-store",
    });

    const location = response.headers.get("location");

    if (response.status >= 300 && response.status < 400 && location) {
      url = new URL(location, url).toString();
      continue;
    }

    if (!response.ok) return null;

    return (await response.text()).slice(0, MAX_PAGE_CHARS);
  }

  return null;
}

/*
 * Confirma que o telefone está mesmo na página que o modelo indicou.
 * Falso não quer dizer inventado (há sites que bloqueiam leituras
 * automáticas) — quer dizer que o comercial deve confirmar na fonte.
 */
async function phoneIsOnPage(company: WebCompany) {
  try {
    const page = await fetchPage(company.sourceUrl);

    if (!page) return false;

    const digits = company.phone.replace(/\D/g, "");

    // Na página o número pode vir com espaços, pontos, hífens ou &nbsp;.
    return page.replace(/&nbsp;|&#160;/g, "").replace(/[\s.\-()]/g, "").includes(digits);
  } catch {
    return false;
  }
}

export async function searchWebCompanies(business: string, zone: string): Promise<VerifiedWebCompany[]> {
  const response = await openai.responses.create(buildWebSearchRequest(business, zone));
  const companies = parseWebCompanies(response.output_text);

  const verified = await Promise.all(companies.map(phoneIsOnPage));

  return companies.map((company, index) => ({ ...company, phoneVerified: verified[index] }));
}
