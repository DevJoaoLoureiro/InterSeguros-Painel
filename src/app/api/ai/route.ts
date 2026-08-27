import {
  NextResponse,
} from "next/server";

import {
  runAiAgent,
} from "@/lib/ai/agent";

export async function POST(
  request: Request,
) {
  try {
    const body =
      await request.json();

    const message =
      String(
        body.message ?? "",
      ).trim();

    const previousResponseId =
      body.previousResponseId
        ? String(
            body.previousResponseId,
          )
        : undefined;

    if (!message) {
      return NextResponse.json(
        {
          error:
            "Mensagem obrigatória.",
        },
        {
          status: 400,
        },
      );
    }

    const result =
      await runAiAgent(
        message,
        previousResponseId,
      );

    return NextResponse.json(
      result,
    );
  } catch (error) {
    console.error(
      "[AI AGENT]",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erro no assistente.",
      },
      {
        status: 500,
      },
    );
  }
}