import {
  getIssuedContractsWithDetails,
} from "@/lib/libax/client";

export async function GET() {
  try {
    const today =
      new Intl.DateTimeFormat(
        "en-CA",
        {
          timeZone:
            "Europe/Lisbon",

          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        },
      ).format(
        new Date(),
      );

    const contracts =
      await getIssuedContractsWithDetails(
        today,
      );

    return Response.json({
      success: true,

      filter: {
        field: "issueDate",
        date: today,
      },

      total:
        contracts.length,

      contracts,
    });
  } catch (error) {
    console.error(
      "Libax test error:",
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