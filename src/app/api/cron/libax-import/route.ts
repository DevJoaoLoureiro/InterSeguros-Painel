import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    // ==========================================
    // 1. VALIDAR CRON_SECRET
    // ==========================================

    const authHeader =
      request.headers.get("authorization");

    const cronSecret =
      process.env.CRON_SECRET;

    if (!cronSecret) {
      console.error(
        "CRON_SECRET não está configurado.",
      );

      return NextResponse.json(
        {
          success: false,
          error: "CRON_SECRET não configurado.",
        },
        {
          status: 500,
        },
      );
    }

    if (
      authHeader !==
      `Bearer ${cronSecret}`
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    // ==========================================
    // 2. DESCOBRIR URL DA APLICAÇÃO
    // ==========================================

    const url =
      new URL(request.url);

    const baseUrl =
      url.origin;

    // ==========================================
    // 3. CHAMAR IMPORTADOR LIBAX
    // ==========================================

    const response =
      await fetch(
        `${baseUrl}/api/libax/import`,
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${cronSecret}`,
          },

          cache: "no-store",
        },
      );

    const text =
      await response.text();

    let result: unknown;

    try {
      result =
        JSON.parse(text);
    } catch {
      throw new Error(
        `O importador não devolveu JSON. Resposta: ${text.slice(
          0,
          300,
        )}`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `Importação Libax falhou (${response.status}): ${JSON.stringify(
          result,
        )}`,
      );
    }

    // ==========================================
    // 4. RESULTADO
    // ==========================================

    return NextResponse.json({
      success: true,
      cron: true,
      executedAt:
        new Date().toISOString(),
      import: result,
    });
  } catch (error) {
    console.error(
      "Erro Cron Libax:",
      error,
    );

    return NextResponse.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Erro desconhecido.",
      },
      {
        status: 500,
      },
    );
  }
}