import { getObjetosDoDia } from "@/lib/insurance/providers/zurich/client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const data =
    searchParams.get("data") ??
    new Date().toISOString().slice(0, 10);

  try {
    const objetos = await getObjetosDoDia(data);

    return Response.json({
      success: true,
      data,
      count: objetos.length,
      objetos,
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