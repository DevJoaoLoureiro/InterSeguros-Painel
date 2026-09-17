import { obterObjetosPorNrApolice } from "@/lib/insurance/providers/zurich/client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const apolice = searchParams.get("apolice");

  if (!apolice) {
    return Response.json(
      {
        success: false,
        error: "Indica ?apolice=NUMERO_DA_APOLICE",
      },
      { status: 400 },
    );
  }

  try {
    const result = await obterObjetosPorNrApolice(apolice);

    return Response.json({
      success: true,
      apolice,
      objetos: result.ListaObjetos ?? [],
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        apolice,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      { status: 500 },
    );
  }
}