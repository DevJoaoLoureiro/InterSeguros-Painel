import { getRecibosDoDia } from "@/lib/insurance/providers/zurich/client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const data =
    searchParams.get("data") ??
    new Date().toISOString().slice(0, 10);

  try {
    const recibos = await getRecibosDoDia(data);

    return Response.json({
      success: true,
      data,
      count: recibos.length,
      recibos,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        data,
        error:
          error instanceof Error
            ? error.message
            : "Erro desconhecido",
      },
      { status: 500 },
    );
  }
}