import type { NormalizedPrevoirReceipt } from "@/lib/insurance/providers/prevoir/receipt-mapper";
import { compactMetadata } from "@/lib/insurance/sync/client-metadata";

import { date, decimal, text } from "./mapper";
import type { GeneraliRecibo } from "./types";

/*
 * Recibo da Generali -> formato comum (o de batchUpsertReceipts).
 *
 * Comissões como na Zurich, por partes (sem linha TOTAL):
 *   ComissaoMediacao -> ACQUISITION
 *   ComissaoCobranca -> COLLECTION
 * (ver lib/insurance/commissions.ts: sem TOTAL, somam-se as partes).
 *
 * Estado e forma de pagamento reconhecidos pela descrição; o código e
 * a descrição originais ficam em provider_metadata.
 */

export type NormalizedGeneraliReceipt = NormalizedPrevoirReceipt;

function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/*
 * Recibo.EstadoRecibo, códigos da operação /listas (2026-11-17).
 * "No mediador" = o cliente pagou ao mediador: para o CRM está pago.
 * Os que ficam de fora (ex.: CH "Carta Cheque Emitida") caem na
 * descrição e, no fim, na data de pagamento.
 */
const RECEIPT_STATUS: Record<string, NormalizedGeneraliReceipt["status"]> = {
  RC: "PAID", // Reconciliado ou pago
  PL: "PAID", // Pré-Liquidado
  PM: "PAID", // Pagamento no Mediador
  CM: "PAID", // Cobrança no Mediador
  CC: "PAID", // Crédito em conta bancária
  OK: "PENDING", // Em Existência
  CR: "PENDING", // Recibo Criado
  PI: "PENDING", // Preparado para Impressão
  IM: "PENDING", // Recibo Impresso
  PP: "PENDING", // Em Gestão de Recebimentos
  PD: "PENDING", // Pagamento em Diferido
  CD: "PENDING", // Cobrança em diferido
  AN: "CANCELLED", // Anulado
  AD: "CANCELLED", // Anulação em Diferido
  DA: "CANCELLED", // Anulado Tecnicamente
  CT: "CANCELLED", // Cancelado Tecnicamente
  CA: "CANCELLED", // Recibo Cancelado
  CI: "CANCELLED", // Cancel. p/ inclusão no próx.
  DV: "RETURNED", // Devolvido por Falta Pagamento
  DM: "RETURNED", // Devolvido p/ Tratamento Manual
  DE: "RETURNED", // Devolvido para Esclarecimento
  CO: "OVERDUE", // Contencioso
  DC: "OVERDUE", // Dívida em Contencioso
};

function mapStatus(recibo: GeneraliRecibo): NormalizedGeneraliReceipt["status"] {
  const code = text(recibo.EstadoRecibo)?.toUpperCase();
  if (code && RECEIPT_STATUS[code]) return RECEIPT_STATUS[code];

  const desc = normalize(recibo.EstadoReciboDesc);

  if (desc.includes("estorn") || desc.includes("devolv")) return "RETURNED";
  if (desc.includes("anulad") || desc.includes("cancelad")) return "CANCELLED";
  if (desc.includes("contencios")) return "OVERDUE";
  if (desc.includes("cobrad") || desc.includes("pago") || desc.includes("liquidad"))
    return "PAID";
  if (
    desc.includes("pendente") ||
    desc.includes("por cobrar") ||
    desc.includes("emitid") ||
    desc.includes("em cobranca") ||
    desc.includes("aviso")
  )
    return "PENDING";

  // Sem descrição reconhecida mas com data de pagamento: está pago.
  if (date(recibo.DtPagamento)) return "PAID";

  return "UNKNOWN";
}

/* Recibo.TipoRecebimento (/listas). Multibanco não tem tipo no CRM: OTHER. */
const PAYMENT_METHOD: Record<string, NonNullable<NormalizedGeneraliReceipt["paymentMethod"]>> = {
  "01": "CASH",
  "02": "CHEQUE",
  "03": "CARD",
  "15": "CARD",
  "04": "DIRECT_DEBIT",
  "05": "DIRECT_DEBIT",
  "12": "MBWAY",
};

function mapPaymentMethod(
  recibo: GeneraliRecibo,
): NormalizedGeneraliReceipt["paymentMethod"] {
  const code = text(recibo.TipoRecebimento);
  if (code && PAYMENT_METHOD[code]) return PAYMENT_METHOD[code];

  const desc = normalize(recibo.TipoRecebimentoDesc ?? recibo.TipoRecebimento);

  if (!desc) return null;
  if (desc.includes("debito") || desc.includes("sepa")) return "DIRECT_DEBIT";
  if (desc.includes("mb way") || desc.includes("mbway")) return "MBWAY";
  if (desc.includes("transfer")) return "BANK_TRANSFER";
  if (desc.includes("cheque")) return "CHEQUE";
  if (desc.includes("cartao")) return "CARD";
  if (desc.includes("numerario") || desc.includes("dinheiro")) return "CASH";

  return "OTHER";
}

function negate(value: number | null): number | null {
  return value === null || value === 0 ? value : -value;
}

export function mapGeneraliReceipt(recibo: GeneraliRecibo): NormalizedGeneraliReceipt {
  const receiptNumber = text(recibo.NrRecibo);
  const policyNumber = text(recibo.NrApolice);

  if (!receiptNumber || !policyNumber) {
    throw new Error("Recibo Generali sem NrRecibo ou NrApolice.");
  }

  // A Generali escreve as comissões do lado dela: negativas num recibo
  // normal (ex.: prémio 58,53 / ComissaoMediacao -9,30) e positivas num
  // estorno. Para o CRM (lado do mediador) troca-se o sinal.
  const acquisition = negate(decimal(recibo.ComissaoMediacao));
  const collection = negate(decimal(recibo.ComissaoCobranca));

  const commissions: NormalizedGeneraliReceipt["commissions"] = [];

  if (acquisition !== null && acquisition !== 0) {
    commissions.push({
      type: "ACQUISITION",
      amount: acquisition,
      externalType: text(recibo.TipoRecibo),
    });
  }

  if (collection !== null && collection !== 0) {
    commissions.push({
      type: "COLLECTION",
      amount: collection,
      externalType: text(recibo.TipoRecibo),
    });
  }

  return {
    externalId: receiptNumber,
    receiptNumber,
    policyExternalId: policyNumber,

    commissionTotal: null,
    commissionAcquisition: acquisition,
    commissionCollection: collection,
    commissionBrokerage: null,
    commissionOther: null,
    commissionType: text(recibo.TipoRecibo),

    receiptType: text(recibo.TipoReciboDesc) ?? text(recibo.TipoRecibo),

    periodStart: date(recibo.DtInicio),
    periodEnd: date(recibo.DtFim),

    issueDate: date(recibo.DtEmissao),
    // Como na Zurich: o pagamento espera-se no início do período. A
    // data-limite de cobrança fica em provider_metadata.
    dueDate: date(recibo.DtInicio),

    commercialPremium: decimal(recibo.PremioComercial),
    totalPremium: decimal(recibo.PremioTotal),

    status: mapStatus(recibo),
    paymentDate: date(recibo.DtPagamento),
    paymentMethod: mapPaymentMethod(recibo),

    situationDate: date(recibo.DtAlteracaoEstado),
    cancellationDate: date(recibo.DtAnulacao),
    cancellationReason: text(recibo.MotivoAnulacao),

    externalVersion: null,
    externalNature: text(recibo.TipoRecibo),
    externalPaymentMethod: text(recibo.TipoRecebimentoDesc) ?? text(recibo.TipoRecebimento),

    commissions,

    providerMetadata: compactMetadata({
      source: "GENERALI_API_V2",
      estadoCod: recibo.EstadoRecibo,
      estadoDesc: recibo.EstadoReciboDesc,
      tipoReciboCod: recibo.TipoRecibo,
      dataLimiteCobranca: date(recibo.DtLimiteCobranca),
      premioLiquido: decimal(recibo.PremioLiquido),
      custoApolice: decimal(recibo.CustoApolice),
      codMediador: recibo.CodMediador,
      codCobrador: recibo.CodCobrador,
      irsRetidoMediacao: decimal(recibo.IrsRetidoMediacao),
      irsRetidoCobranca: decimal(recibo.IrsRetidoCobranca),
      nrExtrato: recibo.NrExtrato,
      nrTomador: recibo.NrTomador,
      tipoRecebimentoCod: recibo.TipoRecebimento,
      atmEntidade: recibo.ATM?.Entidade,
      atmReferencia: recibo.ATM?.Referencia,
      documento: recibo.Documento,
      autorizado: recibo.Autorizado,
    }),
  };
}
