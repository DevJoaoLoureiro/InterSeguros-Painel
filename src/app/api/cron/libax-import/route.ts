import {
  NextResponse,
} from "next/server";

import {
  runLibaxImport,
} from "@/lib/libax/import";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function GET(
  request: Request,
) {
  try {
    const cronSecret =
      process.env.CRON_SECRET;

    if (!cronSecret) {
      return NextResponse.json(
        {
          success: false,
          error:
            "CRON_SECRET não configurado.",
        },
        {
          status: 500,
        },
      );
    }

    const authorization =
      request.headers.get(
        "authorization",
      );

    if (
      authorization !==
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

    console.log(
      "Cron Libax iniciado.",
    );

    const result =
      await runLibaxImport();

    console.log(
      "Cron Libax concluído:",
      result,
    );

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