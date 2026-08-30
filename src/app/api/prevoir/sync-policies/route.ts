import {
  NextResponse,
} from "next/server";

import {
  syncPrevoirPolicies,
} from "@/lib/insurance/providers/prevoir/sync";

export async function POST() {
  try {
    /*
     * TRAVÃO DE SEGURANÇA.
     *
     * Por enquanto sincronizamos
     * APENAS 5.
     */
    const result =
      await syncPrevoirPolicies({
        limit: 490,
      });

    return NextResponse.json(
      result,
    );
  } catch (error) {
    console.error(
      "Erro sync Prévoir:",
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