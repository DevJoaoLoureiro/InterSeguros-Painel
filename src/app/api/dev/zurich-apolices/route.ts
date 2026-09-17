import { getApolicesDoDia } from "@/lib/insurance/providers/zurich/client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const data =
    searchParams.get("data") ??
    new Date().toISOString().slice(0, 10);

  try {
    const apolices = await getApolicesDoDia(data);

    return Response.json({
      success: true,
      data,
      count: apolices.length,
      apolices,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        data,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      { status: 500 },
    );
  }
}