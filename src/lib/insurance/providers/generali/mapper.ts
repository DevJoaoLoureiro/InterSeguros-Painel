import type { NormalizedPolicy } from "@/lib/insurance/types";
import { compactMetadata } from "@/lib/insurance/sync/client-metadata";
import { pickEmail, pickPhone } from "@/lib/insurance/sync/client-contacts";
import { PLACEHOLDER_CLIENT_PREFIX } from "@/lib/insurance/sync/client-placeholder";

import type {
  GeneraliApolice,
  GeneraliCliente,
  GeneraliObjetoSeguro,
} from "./types";

/*
 * Apólices e clientes da Generali -> formato comum do CRM
 * (o mesmo que upsertClient / upsertPolicy usam para a Zurich e a
 * Prévoir).
 *
 * Estados, fracionamentos e ramos são reconhecidos pela DESCRIÇÃO
 * (campos "...Desc"), não pelo código: os códigos só se conhecem pela
 * operação /listas. O código e a descrição originais ficam sempre em
 * provider_metadata. Quando houver dados reais, rever o que caiu em
 * UNKNOWN/OTHER e acrescentar aqui.
 */

export type NormalizedGeneraliPolicy = NormalizedPolicy & {
  client: NormalizedPolicy["client"] & {
    phone?: string | null;
    email?: string | null;
    metadata?: Record<string, unknown>;
    dataMissing?: boolean;
  };
};

// -----------------------------------------------------
// VALORES
// -----------------------------------------------------

export function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** "1234.56" -> 1234.56. Vazio ou inválido -> null. */
export function decimal(value: string | null | undefined): number | null {
  const raw = text(value);
  if (raw === null) return null;

  // A API usa sempre ponto; aceita vírgula por segurança.
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

/** AAAA-MM-DD (ignora hora e datas-sentinela como 0001-01-01). */
export function date(value: string | null | undefined): string | null {
  const match = text(value)?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  const year = Number(match[1]);
  if (year < 1900 || year > 2200) return null;

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

// -----------------------------------------------------
// ESTADO, FRACIONAMENTO, RAMO
// -----------------------------------------------------

/*
 * Apolice.EstadoApolice, códigos da operação /listas (2026-11-17).
 * "Provisional" = alteração em curso sobre uma apólice que existe.
 */
const POLICY_STATUS: Record<string, NormalizedPolicy["status"]> = {
  OK: "ACTIVE", // ACEITE
  RT: "ACTIVE", // CONTINUADO (renovada)
  CN: "CANCELLED", // ANULADA
  CT: "CANCELLED", // ANULADA
  CR: "CANCELLED", // ANULADA POR SUBSTITUIÇÃO
  LP: "CANCELLED", // CANCELADO
  NR: "CANCELLED", // CANCELADO
  NA: "CANCELLED", // NAO ACEITE
  DP: "EXPIRED", // CADUCADO
  SU: "SUSPENDED", // SUSPENSO
  CP: "PENDING", // ANULADA PROVISIONAL
  PR: "PENDING", // PROVISIONAL
  PT: "PENDING", // RENOVAÇÃO PROVISIONAL
  RE: "PENDING", // INVERSÃO PROVISIONAL
  RP: "PENDING", // REPOSIÇÃO PROVISIONAL
  RC: "PENDING", // SUBSTITUIÇÃO PROVISIONAL
  RR: "PENDING", // RENOVAÇÃO INVERTIDA
  MK: "UNKNOWN", // A MIGRAR
  SK: "UNKNOWN", // ESQUELETO
};

function mapPolicyStatus(
  apolice: GeneraliApolice,
): NormalizedPolicy["status"] {
  const code = text(apolice.EstadoApolice)?.toUpperCase();
  if (code && POLICY_STATUS[code]) return POLICY_STATUS[code];

  // Código novo, ainda não previsto: tenta pela descrição.
  const desc = normalize(apolice.EstadoApoliceDesc);

  if (!desc) return "UNKNOWN";
  if (desc.includes("provisional")) return "PENDING";
  if (desc.includes("anulad") || desc.includes("cancelad")) return "CANCELLED";
  if (desc.includes("suspens")) return "SUSPENDED";
  if (desc.includes("caducad")) return "EXPIRED";
  if (desc.includes("aceite") || desc.includes("continuad")) return "ACTIVE";

  return "UNKNOWN";
}

/*
 * Apolice.Fracionamento (/listas). A lista de /apolices não tem código
 * anual: vem VAZIO (confirmado com dados reais — essas apólices têm um
 * só recibo "Continuado" de um ano). O "AS" é o anual de /grupo.
 */
const FREQUENCY: Record<string, NormalizedPolicy["paymentFrequency"]> = {
  AS: "ANNUAL",
  SS: "SEMIANNUAL",
  SA: "SEMIANNUAL", // ATVAR
  TS: "QUARTERLY",
  TA: "QUARTERLY",
  MS: "MONTHLY",
  MA: "MONTHLY",
  BS: "OTHER", // Bimensal
};

function mapFrequency(
  apolice: GeneraliApolice,
): NormalizedPolicy["paymentFrequency"] {
  const code = text(apolice.Fracionamento)?.toUpperCase();
  if (!code) return "ANNUAL";
  if (FREQUENCY[code]) return FREQUENCY[code];

  const desc = normalize(apolice.FracionamentoDesc);

  if (!desc) return "UNKNOWN";
  if (desc.includes("anual")) return "ANNUAL";
  if (desc.includes("semestr")) return "SEMIANNUAL";
  if (desc.includes("trimestr")) return "QUARTERLY";
  if (desc.includes("mensal")) return "MONTHLY";
  if (desc.includes("unic")) return "SINGLE";

  return "OTHER";
}

/*
 * Código do ramo no CRM (tabela insurance_lines). Primeiro conta o
 * mapeamento em provider_products (por código de produto, ver sync.ts);
 * isto é só o recurso quando o produto ainda não está classificado.
 */
export function mapInsuranceLine(
  apolice: GeneraliApolice,
): string | null {
  const texts = [
    apolice.ProdutoDesc,
    apolice.Produto,
    ...(apolice.ObjetosSeguros ?? []).map((objeto) => objeto.LinhaNegocioDesc),
  ]
    .map(normalize)
    .join(" | ");

  if (!texts) return null;

  // A ordem importa: financeiros antes de vida; vida antes de
  // habitação ("VIDA CRÉDITO CASA", "VR Crédito Habitação" são Vida).
  if (/\bppr\b|poupanc|capitaliz|unit.?link|reforma|investiment/.test(texts))
    return "FINANCEIROS";
  if (/\bvida\b|credito habitac|funeral/.test(texts)) return "VIDA";
  if (/automov|\bauto\b|viatura|motocicl|ciclomotor/.test(texts)) return "AUTO";
  if (/acidentes de trabalho|\bat\b/.test(texts)) return "AT";
  if (/acidentes pessoais/.test(texts)) return "AP";
  if (/saude/.test(texts)) return "SAUDE";
  if (/viage/.test(texts)) return "VIAGEM";
  if (/embarcac|barco|nautic/.test(texts)) return "EMBARCACOES";
  if (/responsabilidade civil|\brc\b/.test(texts)) return "RC";
  if (/habitac|\blar\b|casa/.test(texts)) return "MRH";
  // Engenharia (máquinas, equipamento eletrónico, bens em leasing): é
  // seguro de bens de empresas, o ramo mais próximo no CRM.
  if (
    /multirrisco|comercio|empresa|industri|negocio|estabelecimento|maquinas|equipamento electronico|equipamento eletronico|leasing/.test(
      texts,
    )
  )
    return "MULTIRRISCOS_EMPRESARIAL";

  // Sem ramo no CRM (ex.: PETSS "Cães e Gatos"): fica por classificar e
  // o admin escolhe em Configurações > Classificação de produtos
  // (provider_products tem prioridade sobre este mapeamento).
  return null;
}

/** "00123-Auto Clássico" -> { code: "00123", name: "Auto Clássico" }. */
function splitProduto(apolice: GeneraliApolice) {
  const produto = text(apolice.Produto) ?? "";
  const match = produto.match(/^\s*([^-\s]+)\s*-\s*(.*)$/);

  return {
    code: match?.[1] ?? (produto || "DESCONHECIDO"),
    name: text(apolice.ProdutoDesc) ?? text(match?.[2]) ?? null,
  };
}

// -----------------------------------------------------
// OBJETOS SEGUROS
// -----------------------------------------------------

/*
 * "Matricula" nem sempre é uma matrícula: conforme TipoMatricula pode
 * ser uma carta de condução (C/S), o nome de um cavalo (H), o nº do
 * motor (M), etc. Só contam estes tipos (/listas):
 *   N nacional, E estrangeira, R reboque, D corpo diplomático,
 *   F forças armadas, A/W angolana, J Moçambique, I tunisina.
 * Sem TipoMatricula, aceita-se se tiver o formato português.
 */
const VEHICLE_PLATE_TYPES = new Set(["N", "E", "R", "D", "F", "A", "W", "J", "I"]);

function isVehicle(objeto: GeneraliObjetoSeguro) {
  const plate = text(objeto.Matricula);
  if (!plate) return false;

  const type = text(objeto.TipoMatricula)?.toUpperCase();
  if (type) return VEHICLE_PLATE_TYPES.has(type);

  return /^[A-Z0-9]{2}-?[A-Z0-9]{2}-?[A-Z0-9]{2}$/i.test(plate);
}

/** Matrícula do 1.º veículo, em maiúsculas (ex.: "AA-00-BB"). */
function vehicleRegistration(objetos: GeneraliObjetoSeguro[]): string | null {
  const veiculo = objetos.find(isVehicle);
  return veiculo ? text(veiculo.Matricula)!.toUpperCase() : null;
}

function mapObjects(objetos: GeneraliObjetoSeguro[]) {
  return objetos.map((objeto) =>
    compactMetadata({
      number: objeto.NrObjeto,
      type: objeto.TipoObjetoDesc ?? objeto.TipoObjeto,
      subtype: objeto.SubTipoObjetoDesc ?? objeto.SubTipoObjeto,
      lineOfBusiness: objeto.LinhaNegocioDesc ?? objeto.LinhaNegocio,
      capital: decimal(objeto.Capital),
      commercialPremium: decimal(objeto.PremioComercial),
      insuredPerson: objeto.NomePessoaSegura,
      registration: objeto.Matricula?.toUpperCase(),
      registrationType: objeto.TipoMatriculaDesc ?? objeto.TipoMatricula,
      registrationDate: date(objeto.DtMatricula),
      make: objeto.Marca,
      model: objeto.Modelo,
      version: objeto.Versao,
      category: objeto.CategoriaDesc ?? objeto.Categoria,
      seats: objeto.NrLugares,
      power: objeto.Potencia,
      riskAddress: objeto.LocalRisco
        ? compactMetadata({ ...objeto.LocalRisco })
        : undefined,
      constructionDate: date(objeto.DtConstrucao),
      renewalMode: objeto.ModoRenovacaoDesc ?? objeto.ModoRenovacao,
      mediationCode: objeto.CodigoMediacao,
      creditors:
        objeto.Credores && objeto.Credores.length > 0
          ? objeto.Credores.map((credor) => compactMetadata({ ...credor }))
          : undefined,
    }),
  );
}

// -----------------------------------------------------
// CLIENTE
// -----------------------------------------------------

/**
 * Dados do cliente. A ficha completa (/clientes) é opcional: sem ela
 * usam-se os dados do tomador que vêm na própria apólice (nome, NIF,
 * morada de correspondência), que normalmente chegam.
 */
export function mapGeneraliClient(
  cliente: GeneraliCliente | null,
  apolice: GeneraliApolice | null,
): NormalizedGeneraliPolicy["client"] {
  const nif =
    text(cliente?.NrContribuinte)?.replace(/\D/g, "") ||
    text(apolice?.NrContribuinte)?.replace(/\D/g, "") ||
    null;

  const name = text(cliente?.Nome) ?? text(apolice?.NomeTomador);
  const morada = cliente?.MoradaResidencia ?? apolice?.MoradaCorrespondencia;

  return {
    name: name ?? `${PLACEHOLDER_CLIENT_PREFIX}${nif ?? "desconhecido"}`,
    nif,
    birthDate: date(cliente?.DtNascimento),
    street: text(morada?.Morada),
    postalCode: text(morada?.CodPostal),
    city: text(morada?.LocalidadePostal) ?? text(morada?.Localidade),
    phone: pickPhone(...(cliente?.Contactos ?? []).map((c) => c.Contacto)),
    email:
      (cliente?.Emails ?? [])
        .map((e) => pickEmail(e.Email))
        .find((email) => email !== null) ?? null,
    metadata: cliente
      ? compactMetadata({
          nrCliente: cliente.NrCliente,
          tipo: cliente.TipoDesc ?? cliente.Tipo,
          sexo: cliente.SexoDesc ?? cliente.Sexo,
          estadoCivil: cliente.EstadoCivilDesc ?? cliente.EstadoCivil,
          nacionalidade: cliente.NacionalidadeDesc ?? cliente.Nacionalidade,
          profissao: cliente.ProfissaoDesc ?? cliente.Profissao,
          habilitacoes:
            cliente.HabilitacoesLiterariasDesc ?? cliente.HabilitacoesLiterarias,
          nrIdentificacao: cliente.NrIdentificacao,
          cartaConducao: cliente.CartaConducao?.NrCartaConducao,
          cae: cliente.CAE,
          nrEmpregados: cliente.NrEmpregados,
          anoInicioActividade: cliente.AnoInicioActividade,
          entidadeVerde: cliente.IndEntidadeVerde,
          contactos: (cliente.Contactos ?? [])
            .map((c) => text(c.Contacto))
            .filter(Boolean)
            .join(", "),
          emails: (cliente.Emails ?? [])
            .map((e) => text(e.Email))
            .filter(Boolean)
            .join(", "),
        })
      : apolice
        ? compactMetadata({ nrCliente: apolice.NrTomador })
        : undefined,
    // Só é "sem dados" quando nem a apólice trouxe o nome do tomador.
    dataMissing: name === null,
  };
}

/** Identificador externo do cliente (igual ao da Zurich: pelo NIF). */
export function generaliClientExternalId(
  client: { nif: string | null },
  apolice: GeneraliApolice,
): string {
  if (client.nif) return `NIF:${client.nif}`;

  const tomador = text(apolice.NrTomador);
  return tomador ? `GENERALI:${tomador}` : `POLICY:${text(apolice.NrApolice)}`;
}

// -----------------------------------------------------
// APÓLICE
// -----------------------------------------------------

export function mapGeneraliPolicy(
  apolice: GeneraliApolice,
  cliente: GeneraliCliente | null,
): NormalizedGeneraliPolicy {
  const policyNumber = text(apolice.NrApolice);

  if (!policyNumber) {
    throw new Error("Apólice Generali sem NrApolice.");
  }

  const objetos = apolice.ObjetosSeguros ?? [];
  const produto = splitProduto(apolice);

  // Prémios (confirmado com dados reais, 2026-11-17):
  // - PremioTotal da apólice é ANUAL (semestral de 1340,66 € -> recibos
  //   de ~671 €);
  // - o PremioComercial de CADA linha de ObjetosSeguros é o prémio
  //   comercial anual da APÓLICE INTEIRA, repetido: num Auto vem igual
  //   em RC/DP/PT/AS; numa Casa vem igual no imóvel e no recheio.
  //   Não se soma: usa-se esse valor (bate com o recibo anual).
  const objectPremiums = objetos
    .map((objeto) => decimal(objeto.PremioComercial))
    .filter((value): value is number => value !== null);

  const commercialPremium =
    objectPremiums.length > 0 ? Math.max(...objectPremiums) : null;

  const totalPremium = decimal(apolice.PremioTotal);
  const registration = vehicleRegistration(objetos);

  return {
    externalId: policyNumber,
    externalVersion: null,
    policyNumber,

    productCode: produto.code,
    productName: produto.name,

    insuranceLineCode: mapInsuranceLine(apolice),
    status: mapPolicyStatus(apolice),

    // DtEmissaoApolice é a emissão da ÚLTIMA versão (renovação ou
    // alteração), não a original: com ela, a carteira toda aparecia
    // emitida no ano corrente (Carteira > por ano). A data de início da
    // apólice é o mais próximo da emissão original (como a DataCriacao
    // da Zurich). A outra fica em provider_metadata.dataEmissaoVersao.
    issueDate: date(apolice.DtInicioApolice) ?? date(apolice.DtEmissaoApolice),
    startDate: date(apolice.DtInicioApolice),
    renewalDate: date(apolice.DtVencimentoApolice),

    commercialPremium,
    totalPremium,
    annualizedPremium: commercialPremium ?? totalPremium,

    paymentFrequency: mapFrequency(apolice),

    agentCode: text(apolice.UtilizadorEmissaoApolice),
    agentName: null,
    teamName: null,

    // A apólice não diz a conta de mediador; o código de mediação do
    // 1.º objeto é o mais próximo. A loja resolve-se por
    // store_external_refs (company GENERALI + este código).
    storeExternalCode:
      objetos.map((objeto) => text(objeto.CodigoMediacao)).find(Boolean) ??
      null,

    client: mapGeneraliClient(cliente, apolice),

    providerMetadata: compactMetadata({
      source: "GENERALI_API_V2",
      // Para a loja (ver sync.ts, storeRefKey) e para corrigir à mão.
      codigoMediacao:
        objetos.map((objeto) => text(objeto.CodigoMediacao)).find(Boolean) ?? null,
      utilizadorEmissao: text(apolice.UtilizadorEmissaoApolice),
      dataEmissaoVersao: date(apolice.DtEmissaoApolice),
      nrApoliceGrupo: apolice.NrApoliceGrupo,
      produto: apolice.Produto,
      opcao: apolice.OpcaoDesc ?? apolice.Opcao,
      nrTomador: apolice.NrTomador,
      estadoCod: apolice.EstadoApolice,
      estadoDesc: apolice.EstadoApoliceDesc,
      fracionamentoCod: apolice.Fracionamento,
      fracionamentoDesc: apolice.FracionamentoDesc,
      motivoAlteracao: apolice.MotivoAlteracaoDesc ?? apolice.MotivoAlteracao,
      motivoAnulacao: apolice.MotivoAnulacaoDesc ?? apolice.MotivoAnulacao,
      dataFim: date(apolice.DtFimApolice),
      inicioPeriodo: date(apolice.DtInicioPeriodo),
      fimPeriodo: date(apolice.DtFimPeriodo),
      capital: decimal(apolice.CapitalApolice),
      valorAnualComissao: decimal(apolice.ValorAnualComissao),
      contaCobranca: apolice.ContaCobranca,
      vehicleRegistration: registration ?? undefined,
      objects: objetos.length > 0 ? mapObjects(objetos) : undefined,
    }),
  };
}
