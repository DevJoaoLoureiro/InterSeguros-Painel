import { NextResponse } from "next/server";

import { getPrevoirReceipts } from "@/lib/insurance/providers/prevoir/receipts";

export const dynamic = "force-dynamic";

/*
 * ROTA TEMPORÁRIA DE TESTE.
 *
 * Objetivo: ver TODOS os campos que a API oficial
 * da Prévoir devolve num recibo real, para
 * confirmar se existe comissão e imposto de selo.
 *
 * Apagar depois de confirmado.
 */

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Só em desenvolvimento." },
      { status: 404 },
    );
  }

  try {
    const receipts = await getPrevoirReceipts();

    if (receipts.length === 0) {
      return NextResponse.json({ error: "Sem recibos." });
    }

    return NextResponse.json({
      totalReceipts: receipts.length,
      allKeysFound: Array.from(
        new Set(receipts.flatMap((r) => Object.keys(r))),
      ).sort(),
      samples: receipts.slice(0, 3),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}