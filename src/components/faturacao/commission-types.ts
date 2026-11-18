/*
 * Tipos do quadro de comissões por loja (Zurich, Generali). Ficam fora
 * dos ficheiros "use server" para o quadro (cliente) os poder usar.
 */

export type StoreOption = {
  id: string;
  name: string;
};

export type CommissionReceiptRow = {
  receiptId: string;
  receiptNumber: string | null;
  policyNumber: string;
  clientName: string;
  companyName: string;
  commissionDate: string | null;
  planType: string | null;
  commissionCobranca: number;
  commissionAngariacao: number;
  commissionTotal: number;
};

export type StoreCommissionSummary = {
  storeId: string;
  storeName: string;
  vidaTotal: number;
  naoVidaTotal: number;
  financeirosTotal: number;
  totalGeral: number;
  receiptCount: number;
};
