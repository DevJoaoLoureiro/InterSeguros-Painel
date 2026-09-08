import type { ZurichReciboFicheiro } from "./file-parser";
import { parseZurichFileDecimal } from "./file-parser";

/*
 * Mesma "forma" que NormalizedPrevoirReceipt — TypeScript compara
 * por estrutura, por isso encaixa em upsertReceipt/batchUpsertReceipts
 * sem precisar de ser literalmente o mesmo tipo importado.
 */
export type NormalizedZurichReceipt = {
  externalId: string;
  receiptNumber: string;

  policyExternalId: string;

  commissionTotal: number | null;
  commissionAcquisition: number | null;
  commissionCollection: number | null;
  commissionBrokerage: number | null;
  commissionOther: number | null;
  commissionType: string | null;

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
    type: "TOTAL" | "ACQUISITION" | "COLLECTION" | "BROKER" | "OTHER";
    amount: number;
    externalType: string | null;
  }>;

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

/*
 * Baseado no Anexo 2 (SituacaoCod / Situacao) do documento
 * funcional. "Contencioso" e "Cob. Del." não têm equivalente
 * óbvio no teu enum — revê se PENDING/OVERDUE fazem sentido
 * para o teu caso de uso, ou ajusta.
 */
function normalizeStatus(
  situacao: string,
): NormalizedZurichReceipt["status"] {
  const status = situacao.trim().toLowerCase();

  switch (status) {
    case "pago":
    case "cobrado":
      return "PAID";
    case "por pagar":
    case "por emitir":
      return "PENDING";
    case "anulado":
      return "CANCELLED";
    case "contencioso":
      return "OVERDUE";
    default:
      return "UNKNOWN";
  }
}

export function mapZurichReceipt(
  source: ZurichReciboFicheiro,
): NormalizedZurichReceipt {
  const commissions: NormalizedZurichReceipt["commissions"] = [];

  const comissaoCobranca = parseZurichFileDecimal(source.ComissaoCobranca);
  const comissaoAngariacao = parseZurichFileDecimal(
    source.ComissaoAngariacao,
  );

  if (comissaoCobranca !== null && comissaoCobranca !== 0) {
    commissions.push({
      type: "COLLECTION",
      amount: comissaoCobranca,
      externalType: source.TipoReciboCod.trim() || null,
    });
  }

  if (comissaoAngariacao !== null && comissaoAngariacao !== 0) {
    commissions.push({
      type: "ACQUISITION",
      amount: comissaoAngariacao,
      externalType: source.TipoReciboCod.trim() || null,
    });
  }

  return {
    externalId: source.NumRecibo.trim(),
    receiptNumber: source.NumRecibo.trim(),

    policyExternalId: source.NumeroApolice.trim(),

    receiptType: source.TipoRecibo.trim() || null,

    periodStart: toDateOnly(source.DataInicio),
    periodEnd: toDateOnly(source.DataTermo),

    issueDate: toDateOnly(source.DataEmissao),
    // A Zurich não tem um campo explícito de "data de vencimento"
    // (ao contrário da Prévoir, que tem dataVencimentoRecibo). Uso
    // DataInicio (início do período coberto) como aproximação —
    // é o ponto mais próximo de "quando este pagamento é esperado".
    // Se isto não bater certo na prática, ajusta para outro campo
    // (ex: DataEmissao).
    dueDate: toDateOnly(source.DataInicio),

    commercialPremium: parseZurichFileDecimal(source.PremioComercial),
    totalPremium: parseZurichFileDecimal(source.TotalRecibo),

    status: normalizeStatus(source.Situacao),

    paymentDate: toDateOnly(source.DataPagamento),

    // A Zurich não indica método de pagamento nos campos que
    // temos disponíveis no ficheiro de recibos.
    paymentMethod: null,

    situationDate: null,

    cancellationDate: toDateOnly(source.DataAnulacao),
    cancellationReason: source.CodDevolucao.trim() || null,

    externalVersion: null,
    externalNature: null,
    externalPaymentMethod: null,

    commissions,

    commissionTotal: null,
    commissionAcquisition: comissaoAngariacao,
    commissionCollection: comissaoCobranca,
    commissionBrokerage: null,
    commissionOther: null,
    commissionType: source.TipoReciboCod.trim() || null,

    providerMetadata: {
      ramo: source.Ramo,
      tipoReciboCod: source.TipoReciboCod,
      agenteCobrador: source.AgenteCobrador,
      tipoAgenteCobrador: source.TipoAgenteCobrador,
      agenteAngariador: source.AgenteAngariador,
      situacaoCod: source.SituacaoCod,
      motivoDevolucao: source.MotivoDevolucao || null,
      numeroBoletim: source.NumeroBoletim || null,
      idCliente: source.IDCliente,
    },
  };
}