import { loginPrevoir } from "./client";

export type PrevoirReceipt = {
  recibo: string | number;
  tipo: string | null;

  apolice: string | number;
  modalidade: string | number;
  versao: string | number | null;
  modalidadeDescricao: string | null;

  dataInicioApolice: number | string | null;

  fracionamento: string | null;

  dataCancelamento: number | string | null;
  dataEmissaoRecibo: number | string | null;
 dataInicioRecibo: number | string | null;
  dataFimRecibo: number | string | null;
  dataVencimentoRecibo: number | string | null;

  prmsim: number | null;
  premcom: number | null;
  premtot: number | null;

  situacao: string | null;
  dataSituacao: number | string | null;

  comtot: number | null;
  comang: number | null;
  comcob: number | null;
  comcor: number | null;
  comout: number | null;

  parceiro: string | null;
  tipoComissao: string | null;
  tipoPagamento: string | null;

  motivoAnulacao: string | number | null;
  natureza: string | number | null;

  [key: string]: unknown;
};

function getPrevoirApiUrl() {
  const apiUrl =
    process.env.PREVOIR_API_URL;

  if (!apiUrl) {
    throw new Error(
      "PREVOIR_API_URL não configurado.",
    );
  }

  return apiUrl.replace(/\/$/, "");
}

export async function getPrevoirReceipts(): Promise<
  PrevoirReceipt[]
> {
  const apiUrl =
    getPrevoirApiUrl();

  const login =
    await loginPrevoir();

  const mediatorNumber =
    process.env.PREVOIR_MEDIATOR_NUMBER ||
    String(login.user.nAgente);

  if (!mediatorNumber) {
    throw new Error(
      "Não foi possível determinar o número de mediador Prévoir.",
    );
  }

  const response = await fetch(
    `${apiUrl}/v1/export/recibos/prevoir/${encodeURIComponent(
      mediatorNumber,
    )}`,
    {
      method: "GET",

      headers: {
        Authorization:
          `Bearer ${login.token}`,
        Accept: "application/json",
      },

      cache: "no-store",
    },
  );

  if (!response.ok) {
    const body =
      await response.text();

    throw new Error(
      `Erro ao obter recibos Prévoir (${response.status}): ${body.slice(
        0,
        500,
      )}`,
    );
  }

  const data =
    await response.json();

  if (!Array.isArray(data)) {
    throw new Error(
      "A resposta de recibos da Prévoir não é uma lista.",
    );
  }

  return data as PrevoirReceipt[];
}