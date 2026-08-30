import type {
  PrevoirReceipt,
} from "./receipts";

export type NormalizedPrevoirReceipt = {
  externalId: string;
  receiptNumber: string;

  policyExternalId: string;

  receiptType: string | null;

  periodStart: string | null;
  periodEnd: string | null;

  issueDate: string | null;
  dueDate: string | null;

  commercialPremium: number | null;
  totalPremium: number | null;

  status:
    | "PENDING"
    | "PAID"
    | "CANCELLED"
    | "RETURNED"
    | "OVERDUE"
    | "UNKNOWN";

  paymentDate: string | null;

  paymentMethod:
    | "CASH"
    | "CARD"
    | "BANK_TRANSFER"
    | "DIRECT_DEBIT"
    | "MBWAY"
    | "CHEQUE"
    | "OTHER"
    | "UNKNOWN"
    | null;

  situationDate: string | null;
  cancellationDate: string | null;
  cancellationReason: string | null;

  externalVersion: string | null;
  externalNature: string | null;
  externalPaymentMethod: string | null;

  commissions: Array<{
    type:
      | "TOTAL"
      | "ACQUISITION"
      | "COLLECTION"
      | "BROKER"
      | "OTHER";

    amount: number;
    externalType: string | null;
  }>;

  providerMetadata: Record<
    string,
    unknown
  >;
};

function toNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function toPrevoirDate(
  value: unknown,
): string | null {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    value === 0 ||
    value === "0"
  ) {
    return null;
  }

  const raw =
    String(value).trim();

  // Formato real observado:
  // 20260828 -> 2026-08-28
  if (/^\d{8}$/.test(raw)) {
    const year =
      raw.slice(0, 4);

    const month =
      raw.slice(4, 6);

    const day =
      raw.slice(6, 8);

    return `${year}-${month}-${day}`;
  }

  // Suporte defensivo caso algum
  // endpoint devolva ISO.
  if (
    /^\d{4}-\d{2}-\d{2}/.test(
      raw,
    )
  ) {
    return raw.slice(0, 10);
  }

  return null;
}

function normalizeStatus(
  value: string | null,
): NormalizedPrevoirReceipt["status"] {
  const status =
    value
      ?.trim()
      .toLowerCase() ?? "";

  switch (status) {
    case "cobrado":
      return "PAID";

    case "pendente":
      return "PENDING";

    case "devolvido":
      return "RETURNED";

    case "anulado":
    case "anulada":
    case "cancelado":
    case "cancelada":
      return "CANCELLED";

    default:
      return "UNKNOWN";
  }
}

function normalizePaymentMethod(
  value: string | null,
): NormalizedPrevoirReceipt["paymentMethod"] {
  const method =
    value
      ?.trim()
      .toUpperCase() ?? "";

  switch (method) {
    case "B":
      return "DIRECT_DEBIT";

    /*
     * T = Tesouraria na Prévoir.
     *
     * NÃO significa necessariamente
     * numerário recebido pela Inter.
     */
    case "T":
      return "UNKNOWN";

    case "":
      return null;

    default:
      return "UNKNOWN";
  }
}

export function mapPrevoirReceipt(
  source: PrevoirReceipt,
): NormalizedPrevoirReceipt {
  const receiptNumber =
    String(source.recibo);

  const modalidade =
    String(source.modalidade);

  const policyNumber =
    String(source.apolice);

  const commissions: NormalizedPrevoirReceipt["commissions"] =
    [];

  const commissionValues = [
    {
      type: "TOTAL" as const,
      value: source.comtot,
    },
    {
      type: "ACQUISITION" as const,
      value: source.comang,
    },
    {
      type: "COLLECTION" as const,
      value: source.comcob,
    },
    {
      type: "BROKER" as const,
      value: source.comcor,
    },
    {
      type: "OTHER" as const,
      value: source.comout,
    },
  ];

  for (
    const commission
    of commissionValues
  ) {
    const amount =
      toNumber(
        commission.value,
      );

    if (
    amount !== null &&
    amount !== 0
    ) {
    commissions.push({
        type: commission.type,
        amount,
        externalType:
        source.tipoComissao ??
        null,
    });
    }
  }

  const status =
    normalizeStatus(
      source.situacao,
    );

  const situationDate =
    toPrevoirDate(
      source.dataSituacao,
    );

  return {
    externalId:
      receiptNumber,

    receiptNumber,

    policyExternalId:
      `${modalidade}:${policyNumber}`,

    receiptType:
      source.tipo?.trim() ||
      null,

    periodStart:
      toPrevoirDate(
        source.dataInicioRecibo,
      ),

    periodEnd:
      toPrevoirDate(
        source.dataFimRecibo,
      ),

    issueDate:
      toPrevoirDate(
        source.dataEmissaoRecibo,
      ),

    dueDate:
      toPrevoirDate(
        source.dataVencimentoRecibo,
      ),

    commercialPremium:
      toNumber(
        source.premcom,
      ),

    totalPremium:
      toNumber(
        source.premtot,
      ),

    status,

    /*
     * A Prévoir não nos deu nestes
     * exemplos uma data explícita
     * chamada "dataPagamento".
     *
     * Não assumimos que dataSituacao
     * seja sempre data de pagamento.
     */
    paymentDate: null,

    paymentMethod:
      normalizePaymentMethod(
        source.tipoPagamento,
      ),

    situationDate,

    cancellationDate:
      toPrevoirDate(
        source.dataCancelamento,
      ),

    cancellationReason:
      source.motivoAnulacao ===
        null ||
      source.motivoAnulacao ===
        undefined
        ? null
        : String(
            source.motivoAnulacao,
          ),

    externalVersion:
      source.versao === null ||
      source.versao === undefined
        ? null
        : String(source.versao),

    externalNature:
      source.natureza === null ||
      source.natureza === undefined
        ? null
        : String(
            source.natureza,
          ),

    externalPaymentMethod:
      source.tipoPagamento
        ?.trim() || null,

    commissions,

    providerMetadata: {
      tipo:
        source.tipo,

      modalidade:
        source.modalidade,

      modalidadeDescricao:
        source.modalidadeDescricao,

      dataInicioApolice:
        source.dataInicioApolice,

      fracionamento:
        source.fracionamento,

      prmsim:
        source.prmsim,

      parceiro:
        source.parceiro,

      tipoComissao:
        source.tipoComissao,

      motivoAnulacao:
        source.motivoAnulacao,

      natureza:
        source.natureza,
    },
  };
}