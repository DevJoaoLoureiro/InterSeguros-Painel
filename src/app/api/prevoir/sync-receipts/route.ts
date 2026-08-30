import {
  NextResponse,
} from "next/server";

import {
  syncPrevoirReceipts,
} from "@/lib/insurance/providers/prevoir/receipt-sync";

export async function POST() {
  try {
    const result =
      await syncPrevoirReceipts({
        limit: 5343,
      });

    return NextResponse.json(
      result,
    );
  } catch (error) {
    console.error(
      "Erro route sync recibos Prévoir:",
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