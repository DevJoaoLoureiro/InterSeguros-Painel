import {
  obterObjetosPorNrApolice,
  obterCoberturasPorApolice,
} from "@/lib/insurance/providers/zurich/client";

import { sanitizeZurichText } from "@/lib/insurance/providers/zurich/log-safety";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const apoliceNr = searchParams.get("apolice");

  if (!apoliceNr) {
    return Response.json(
      {
        success: false,
        error: "Falta o parâmetro ?apolice=",
      },
      { status: 400 },
    );
  }

  try {
    const [objetosResult, coberturasResult] =
      await Promise.allSettled([
        obterObjetosPorNrApolice(apoliceNr),
        obterCoberturasPorApolice(apoliceNr),
      ]);

    const objetos =
      objetosResult.status === "fulfilled"
        ? objetosResult.value.ListaObjetos ?? []
        : [];

    const coberturas =
      coberturasResult.status === "fulfilled"
        ? coberturasResult.value.ListaCoberturas ?? []
        : [];

    return Response.json({
      success: true,

      apolice: apoliceNr,

      objetos: {
        success: objetosResult.status === "fulfilled",

        count: objetos.length,

        data: objetos,

        error:
          objetosResult.status === "rejected"
            ? sanitizeZurichText(
                objetosResult.reason instanceof Error
                  ? objetosResult.reason.message
                  : String(objetosResult.reason),
              )
            : null,
      },

      coberturas: {
        success:
          coberturasResult.status === "fulfilled",

        count: coberturas.length,

        data: coberturas,

        error:
          coberturasResult.status === "rejected"
            ? sanitizeZurichText(
                coberturasResult.reason instanceof Error
                  ? coberturasResult.reason.message
                  : String(coberturasResult.reason),
              )
            : null,
      },
    });
  } catch (error) {
    return Response.json(
      {
        success: false,

        error:
          error instanceof Error
            ? sanitizeZurichText(error.message)
            : "Erro desconhecido.",
      },
      { status: 500 },
    );
  }
}