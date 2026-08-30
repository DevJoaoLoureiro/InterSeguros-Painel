import { NextResponse } from "next/server";

import {
  getPrevoirReceipts,
} from "@/lib/insurance/providers/prevoir/receipts";

function increment(
  map: Map<string, number>,
  value: unknown,
) {
  const key =
    value === null ||
    value === undefined ||
    value === ""
      ? "(vazio)"
      : String(value).trim() || "(vazio)";

  map.set(
    key,
    (map.get(key) ?? 0) + 1,
  );
}

function toArray(
  map: Map<string, number>,
) {
  return Array.from(
    map.entries(),
  )
    .map(([value, count]) => ({
      value,
      count,
    }))
    .sort(
      (a, b) =>
        b.count - a.count,
    );
}

export async function GET() {
  try {
    const receipts =
      await getPrevoirReceipts();

    const situations =
      new Map<string, number>();

    const types =
      new Map<string, number>();

    const paymentMethods =
      new Map<string, number>();

    const natures =
      new Map<string, number>();

    const cancellationReasons =
      new Map<string, number>();

    const commissionTypes =
      new Map<string, number>();

    let withoutPolicy = 0;

    let commercialPremiumTotal = 0;
    let totalPremiumTotal = 0;

    for (const receipt of receipts) {
      increment(
        situations,
        receipt.situacao,
      );

      increment(
        types,
        receipt.tipo,
      );

      increment(
        paymentMethods,
        receipt.tipoPagamento,
      );

      increment(
        natures,
        receipt.natureza,
      );

      increment(
        cancellationReasons,
        receipt.motivoAnulacao,
      );

      increment(
        commissionTypes,
        receipt.tipoComissao,
      );

      if (
        receipt.apolice === null ||
        receipt.apolice === undefined ||
        receipt.modalidade === null ||
        receipt.modalidade === undefined
      ) {
        withoutPolicy += 1;
      }

      commercialPremiumTotal +=
        Number(receipt.premcom) || 0;

      totalPremiumTotal +=
        Number(receipt.premtot) || 0;
    }

    return NextResponse.json({
      ok: true,

      totalReceipts:
        receipts.length,

      withoutPolicy,

      situations:
        toArray(situations),

      receiptTypes:
        toArray(types),

      paymentMethods:
        toArray(paymentMethods),

      natures:
        toArray(natures),

      cancellationReasons:
        toArray(
          cancellationReasons,
        ),

      commissionTypes:
        toArray(
          commissionTypes,
        ),

      totals: {
        commercialPremium:
          Number(
            commercialPremiumTotal.toFixed(
              2,
            ),
          ),

        totalPremium:
          Number(
            totalPremiumTotal.toFixed(
              2,
            ),
          ),
      },
    });
  } catch (error) {
    console.error(
      "Erro análise recibos Prévoir:",
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