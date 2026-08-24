import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      return NextResponse.json(
        {
          success: false,
          error: "CRON_SECRET não configurado.",
        },
        { status: 500 },
      );
    }

    // =========================================
    // Validar pedido recebido pelo Cron
    // =========================================

    const authorization =
      request.headers.get("authorization");

    if (authorization !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized",
        },
        { status: 401 },
      );
    }

    // =========================================
    // Descobrir URL da própria aplicação
    // =========================================

    const url = new URL(request.url);

    const importUrl =
      `${url.origin}/api/libax/import`;

    console.log(
      "Cron Libax → chamar:",
      importUrl,
    );

    // =========================================
    // Executar importador
    // =========================================

    const response = await fetch(importUrl, {
      method: "POST",

      headers: {
        Authorization:
          `Bearer ${cronSecret}`,

        "Content-Type":
          "application/json",
      },

      cache: "no-store",

      redirect: "manual",
    });

    // =========================================
    // DEBUG
    // =========================================

    const contentType =
      response.headers.get(
        "content-type",
      );

    const location =
      response.headers.get(
        "location",
      );

    console.log(
      "Importador status:",
      response.status,
    );

    console.log(
      "Importador content-type:",
      contentType,
    );

    console.log(
      "Importador location:",
      location,
    );

    // Se houver redirect, queremos vê-lo
    // em vez de seguir até ao HTML do login.

    if (
      response.status >= 300 &&
      response.status < 400
    ) {
      return NextResponse.json(
        {
          success: false,

          error:
            "O importador foi redirecionado.",

          status:
            response.status,

          location,
        },
        {
          status: 500,
        },
      );
    }

    // =========================================
    // LER RESPOSTA
    // =========================================

    const text =
      await response.text();

    let data;

    try {
      data =
        JSON.parse(text);
    } catch {
      throw new Error(
        `O importador não devolveu JSON. ` +
          `Status: ${response.status}. ` +
          `Content-Type: ${contentType}. ` +
          `Resposta: ${text.slice(0, 500)}`,
      );
    }

    // =========================================
    // IMPORTADOR DEVOLVEU ERRO
    // =========================================

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,

          error:
            "Erro ao executar importador.",

          status:
            response.status,

          import: data,
        },
        {
          status: response.status,
        },
      );
    }

    // =========================================
    // SUCESSO
    // =========================================

    return NextResponse.json({
      success: true,
      cron: true,
      executedAt:
        new Date().toISOString(),
      import: data,
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