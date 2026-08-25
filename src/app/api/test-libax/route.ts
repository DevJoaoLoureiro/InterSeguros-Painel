import {
  runLibaxImport,
} from "@/lib/libax/import";

export async function GET() {
  try {
    const result =
      await runLibaxImport();

    return Response.json(
      result,
    );
  } catch (error) {
    console.error(
      "LIBAX IMPORT TEST ERROR:",
      error,
    );

    return Response.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      {
        status: 500,
      },
    );
  }
}