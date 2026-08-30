import type {
  PrevoirPolicy,
} from "./client";

export type NormalizedPrevoirPolicy = {
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

  /*
   * Dados de agente/equipa.
   *
   * Estes campos podem ser preenchidos
   * por outras fontes/enriquecimentos,
   * mas a API oficial da Prévoir não nos
   * fornece atualmente o codAgente do portal.
   */
  agentCode: string | null;
  agentName: string | null;
  teamName: string | null;

  storeExternalCode: string | null;

  /*
   * Código externo usado exclusivamente
   * para resolver a loja.
   *
   * Na API oficial da Prévoir utilizamos
   * idUtlizador porque validámos a relação
   * na carteira atual:
   *
   * 04931 -> Rio Mau
   * 04932 -> Inter Seguros / Braga
   * 04933 -> Balazar
   *
   * Não assumimos que idUtlizador seja
   * semanticamente um "código de loja".
   */


  client: {
    name: string;
    nif: string | null;
    birthDate: string | null;
    street: string | null;
    postalCode: string | null;
    city: string | null;
  };

  providerMetadata:
    Record<string, unknown>;
};

function toDateOnly(
  value: unknown,
): string | null {
  if (
    typeof value !== "string" ||
    !value
  ) {
    return null;
  }

  return value.slice(0, 10);
}

function toNullableNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const numberValue =
    Number(value);

  return Number.isFinite(
    numberValue,
  )
    ? numberValue
    : null;
}

function toNullableString(
  value: unknown,
): string | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  return normalized || null;
}

function normalizeStatus(
  value: string | null,
): NormalizedPrevoirPolicy["status"] {
  const status =
    value
      ?.trim()
      .toLowerCase() ?? "";

  switch (status) {
    case "normal":
    case "activa":
    case "ativa":
    case "activo":
    case "ativo":
      return "ACTIVE";

    case "pendente":
      return "PENDING";

    case "anulada":
    case "anulado":
    case "cancelada":
    case "cancelado":
      return "CANCELLED";

    case "suspensa":
    case "suspenso":
      return "SUSPENDED";

    case "expirada":
    case "expirado":
      return "EXPIRED";

    case "reduzida":
    case "reduzido":
      return "REDUCED";

    default:
      return "UNKNOWN";
  }
}

function normalizeFrequency(
  value: string | null,
): NormalizedPrevoirPolicy["paymentFrequency"] {
  const frequency =
    value
      ?.trim()
      .toLowerCase() ?? "";

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

function mapInsuranceLine(
  modalidade: number,
  description: string | null,
): string | null {
  /*
   * IMPORTANTE:
   *
   * Estes mappings são específicos
   * da Prévoir.
   *
   * Nunca devem ser utilizados como
   * códigos universais das seguradoras.
   */

  if (modalidade === 50) {
    return "AP";
  }

  const normalized =
    description
      ?.trim()
      .toLowerCase() ?? "";

  if (
    normalized.includes(
      "acidentes pessoais",
    )
  ) {
    return "AP";
  }

  return null;
}

export function mapPrevoirPolicy(
  source: PrevoirPolicy,
): NormalizedPrevoirPolicy {
  const modalidade =
    Number(source.modalidade);

  const policyNumber =
    String(source.apolice);

  /*
   * Dentro da Prévoir, uma apólice
   * deve ser identificável de forma
   * estável incluindo modalidade.
   */
  const externalId =
    `${modalidade}:${policyNumber}`;

  /*
   * IMPORTANTE:
   *
   * idUtlizador vem da API oficial.
   *
   * Não afirmamos que este campo seja
   * oficialmente o código da loja.
   *
   * Apenas o utilizamos como identificador
   * externo para resolver uma relação que
   * foi validada na carteira atual.
   */
  const prevoirUserId =
    toNullableString(
      source.idUtlizador,
    );

  return {
    externalId,

    externalVersion:
      source.versao !==
        null &&
      source.versao !==
        undefined
        ? String(source.versao)
        : null,

    policyNumber,

    productCode:
      String(modalidade),

    productName:
      source.descricaoModalidade ??
      null,

    insuranceLineCode:
      mapInsuranceLine(
        modalidade,
        source.descricaoModalidade,
      ),

    status:
      normalizeStatus(
        source.situacaoContrato,
      ),

    issueDate:
      toDateOnly(
        source.dataEmissaoContrato,
      ),

    startDate:
      toDateOnly(
        source.dataInicioContrato,
      ),

    /*
     * A Prévoir não fornece aqui
     * uma data de renovação explícita.
     */
    renewalDate: null,

    /*
     * valorPremioActual não é
     * automaticamente igual a
     * prémio comercial ou prémio total.
     */
    commercialPremium: null,

    totalPremium: null,

    annualizedPremium:
      toNullableNumber(
        source.valorPremioAnualizado,
      ),

    paymentFrequency:
      normalizeFrequency(
        source.fracionamento,
      ),

    /*
     * A API oficial não fornece o
     * codAgente apresentado no portal.
     */
    agentCode: null,
    agentName: null,
    teamName: null,

    /*
     * Utilizado pelo nosso resolver de loja.
     *
     * O mapping real fica na BD em
     * store_external_refs, não hardcoded
     * neste mapper.
     */
      storeExternalCode:
        source.idUtlizador != null && String(source.idUtlizador).trim() 
        ? String(source.idUtlizador).trim() 
        : null,

    client: {
      name:
        source.nomeTitular?.trim() ||
        "Cliente sem nome",

      nif:
        source.nifTitular?.trim() ||
        null,

      birthDate:
        toDateOnly(
          source
            .dataNascimentoPessoaSegura1,
        ),

      street:
        source.ruaTitular?.trim() ||
        null,

      postalCode:
        source.codPostalTitular?.trim() ||
        null,

      city:
        source.localidadeTitular?.trim() ||
        null,
    },

    providerMetadata: {
      modalidade:
        source.modalidade,

      versao:
        source.versao,

      situacaoContrato:
        source.situacaoContrato,

      dataSituacaoContrato:
        source.dataSituacaoContrato ??
        null,

      valorPremioActual:
        source.valorPremioActual,

      capitalMorte:
        source.capitalMorte,

      capitalVida:
        source.capitalVida,

      fracionamento:
        source.fracionamento,

      sexoTitular:
        source.sexoTitular,

      nomePessoaSegura1:
        source.nomePessoaSegura1,

      dataNascimentoPessoaSegura1:
        source
          .dataNascimentoPessoaSegura1,

      nomePessoaSegura2:
        source.nomePessoaSegura2,

      dataNascimentoPessoaSegura2:
        source
          .dataNascimentoPessoaSegura2,

      /*
       * Mantemos sempre o valor original
       * da API oficial para auditoria.
       */
      prevoirUserId,

      subAgente:
        source.subAgente ??
        null,

      descricaoSubagente:
        source.descricaoSubagente ??
        null,
    },
  };
}