import {
  runLibaxImport,
} from "@/lib/libax/import";

export const runtime =
  "nodejs";

export async function POST() {
  try {
    const result =
      await runLibaxImport();

    return Response.json(
      result,
    );
  } catch (error) {
    console.error(
      "Libax import error:",
      error,
    );

    return Response.json(
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