import { NextResponse } from "next/server";

import {
  parseDat,
} from "@/lib/insurance/providers/generali/dat-parser";

import {
  buildGeneraliDryRun,
} from "@/lib/insurance/providers/generali/dry-run";

export const runtime = "nodejs";

export async function POST(
  request: Request,
) {
  try {
    const formData =
      await request.formData();

    const entries =
      formData.getAll("files");

    const files =
      entries.filter(
        (entry): entry is File =>
          entry instanceof File,
      );

    if (!files.length) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Nenhum ficheiro recebido.",
        },
        {
          status: 400,
        },
      );
    }

    const parsedFiles = [];

    for (const file of files) {
      const buffer =
        Buffer.from(
          await file.arrayBuffer(),
        );

      const content =
        buffer.toString("latin1");

      const parsed =
        parseDat(
          file.name,
          content,
        );

      parsedFiles.push(parsed);
    }

    const result =
      buildGeneraliDryRun(
        parsedFiles,
      );

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error(
      "GENERALI IMPORT ERROR:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,
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