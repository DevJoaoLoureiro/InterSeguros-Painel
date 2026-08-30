import { NextResponse } from "next/server";

import {
  getPrevoirReceipts,
} from "@/lib/insurance/providers/prevoir/receipts";

function getReceiptTimestamp(
  value: string | number | null,
) {
  if (!value) {
    return 0;
  }

  const raw = String(value).trim();

  if (/^\d{8}$/.test(raw)) {
    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(4, 6)) - 1;
    const day = Number(raw.slice(6, 8));

    return new Date(
      year,
      month,
      day,
    ).getTime();
  }

  const timestamp =
    new Date(raw).getTime();

  return Number.isFinite(timestamp)
    ? timestamp
    : 0;
}

export async function GET() {
  try {
    const receipts =
      await getPrevoirReceipts();

    /*
     * Para este primeiro teste queremos
     * apenas os 5 recibos mais recentes.
     *
     * Ordenamos pela data de emissão
     * em vez de assumir que a API já
     * vem ordenada.
     */
    const lastFive =
      [...receipts]
        .sort(
          (a, b) =>
            getReceiptTimestamp(
              b.dataEmissaoRecibo,
            ) -
            getReceiptTimestamp(
              a.dataEmissaoRecibo,
            ),
        )
        .slice(0, 5);

    return NextResponse.json({
      ok: true,

      totalReceived:
        receipts.length,

      showing:
        lastFive.length,

      data:
        lastFive,
    });
  } catch (error) {
    console.error(
      "Erro teste recibos Prévoir:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Erro desconhecido",
      },
      {
        status: 500,
      },
    );
  }
}