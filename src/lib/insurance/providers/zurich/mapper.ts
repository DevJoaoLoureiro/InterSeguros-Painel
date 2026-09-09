import type { ZurichApoliceFicheiro, ZurichClienteFicheiro } from "./file-parser";
import { parseZurichFileDecimal } from "./file-parser";

/*
 * Mesma "forma" que NormalizedPrevoirPolicy / NormalizedPolicy
 * (@/lib/insurance/types) — TypeScript compara por estrutura,
 * por isso não precisa de ser literalmente o mesmo tipo importado
 * para passar em upsertPolicy().
 */
export type NormalizedZurichPolicy = {
  externalId: string;
  externalVersion: string | null;

  policyNumber: string;

  productCode: string;
  productName: string | null;

  insuranceLineCode: string | null;

  status:
    | "ACTIVE"
    | "PENDING"
    | "CANCELLED"
    | "EXPIRED"
    | "SUSPENDED"
    | "REDUCED"
    | "UNKNOWN";

  issueDate: string | null;
  startDate: string | null;
  renewalDate: string | null;

  commercialPremium: number | null;
  totalPremium: number | null;
  annualizedPremium: number | null;

  paymentFrequency:
    | "ANNUAL"
    | "SEMIANNUAL"
    | "QUARTERLY"
    | "MONTHLY"
    | "SINGLE"
    | "OTHER"
    | "UNKNOWN";

  agentCode: string | null;
  agentName: string | null;
  teamName: string | null;

  storeExternalCode: string | null;

  client: {
    name: string;
    nif: string | null;
    birthDate: string | null;
    street: string | null;
    postalCode: string | null;
    city: string | null;
  };

  providerMetadata: Record<string, unknown>;
};

function toDateOnly(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed || trimmed.startsWith("01-01-1900")) {
    return null;
  }

  const match = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})/);

  if (!match) {
    return null;
  }

  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function normalizeStatus(
  estado: string,
): NormalizedZurichPolicy["status"] {
  const status = estado.trim().toLowerCase();

  switch (status) {
    case "em vigor":
    case "revalidada":
    case "normal":
      return "ACTIVE";

    case "anulada":
      return "CANCELLED";

    case "proposta":
      return "PENDING";

    default:
      return "UNKNOWN";
  }
}

function normalizeFrequency(
  fraccionamento: string,
): NormalizedZurichPolicy["paymentFrequency"] {
  const frequency = fraccionamento.trim().toLowerCase();

  switch (frequency) {
    case "anual":
      return "ANNUAL";
    case "semestral":
      return "SEMIANNUAL";
    case "trimestral":
      return "QUARTERLY";
    case "mensal":
      return "MONTHLY";
    case "único":
    case "unico":
      return "SINGLE";
    case "":
      return "UNKNOWN";
    default:
      return "OTHER";
  }
}

/*
 * IMPORTANTE: heurística por agora — a Zurich não documenta um
 * mapeamento explícito de LinhaNegocioDesc para os teus códigos
 * internos de ramo. Confirma contra a tua tabela `insurance_lines`
 * e ajusta/estende esta função conforme os ramos reais que
 * encontrares (Auto, Multirriscos, Vida, etc.).
 */
function mapInsuranceLine(
  linhaNegocioDesc: string | null,
): string | null {
  const normalized = linhaNegocioDesc?.trim().toLowerCase() ?? "";

  if (normalized.includes("auto")) {
    return "AUTO";
  }

  return null;
}

export function mapZurichPolicy(
  source: ZurichApoliceFicheiro,
  cliente: ZurichClienteFicheiro | null,
): NormalizedZurichPolicy {
  const nif = source.NIF.trim() || null;

  return {
    externalId: source.NumeroApolice.trim(),

    // A Zurich não expõe um número de versão de apólice nos
    // dados que temos disponíveis.
    externalVersion: null,

    policyNumber: source.NumeroApolice.trim(),

    productCode: source.LinhaNegocioCod.trim(),
    productName: source.LinhaNegocioDesc.trim() || null,

    insuranceLineCode: mapInsuranceLine(source.LinhaNegocioDesc),

    status: normalizeStatus(source.Estado),

    issueDate: toDateOnly(source.DataCriacao),
    startDate: toDateOnly(source.DataInicio),
    renewalDate: toDateOnly(source.DataRevalidacao),

    // A Zurich só dá um valor de prémio (PremioApolice), sem
    // distinguir comercial/total/anualizado como a Prévoir.
    // A Zurich só dá um valor de prémio (PremioApolice). O nome do
    // campo, e o facto de o valor não mudar consoante o
    // Fraccionamento (Anual/Semestral/Trimestral só descreve como
    // se paga, não o valor em si), sugerem que já é o valor ANUAL
    // da apólice — por isso preenchemos os dois campos com o mesmo
    // valor. Se em algum caso real isto não bater certo (ex:
    // aparecer o valor por prestação em vez do anual), avisa-me
    // para ajustarmos com base no Fraccionamento.
    commercialPremium: null,
    totalPremium: parseZurichFileDecimal(source.PremioApolice),
    annualizedPremium: parseZurichFileDecimal(source.PremioApolice),

    paymentFrequency: normalizeFrequency(source.Fraccionamento),

    // Não temos dados de agente/equipa vindos da API da Zurich.
    agentCode: null,
    agentName: null,
    teamName: null,

    // AgenteAngariador é o candidato mais próximo de um
    // identificador de loja/agência — tal como o idUtlizador
    // na Prévoir, o mapping real para loja fica em
    // store_external_refs, não aqui.
    storeExternalCode: source.AgenteAngariador.trim() || null,

    client: {
      name: cliente?.NomeCliente.trim() || `Cliente NIF ${nif ?? "desconhecido"}`,
      nif,
      birthDate: cliente ? toDateOnly(cliente.DataNascimento) : null,
      street: cliente?.Morada.trim() || null,
      postalCode:
        cliente && cliente.CodigoPostal.trim()
          ? `${cliente.CodigoPostal.trim()}${
              cliente.OrdemPostal.trim() ? `-${cliente.OrdemPostal.trim()}` : ""
            }`
          : null,
      city:
        cliente?.LocalidadePostal.trim() ||
        cliente?.Localidade.trim() ||
        null,
    },

    providerMetadata: {
      ramo: source.Ramo,
      linhaNegocioCod: source.LinhaNegocioCod,
      estadoCod: source.EstadoCod,
      fraccionamentoCod: source.FraccionamentoCod,
      iban: source.IBAN || null,
      idCliente: source.IDCliente,
      agenteAngariador: source.AgenteAngariador,
      agenteCobrador: source.AgenteCobrador,
      dataCancelamento: toDateOnly(source.DataCancelamento),
      dataFim: toDateOnly(source.DataFim),
    },
  };
}