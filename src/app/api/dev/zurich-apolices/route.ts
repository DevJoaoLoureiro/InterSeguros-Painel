import { getApolicesDoDia } from "@/lib/insurance/providers/zurich/client";
import {
  maskSensitiveFields,
  sanitizeZurichText,
} from "@/lib/insurance/providers/zurich/log-safety";

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
      // NIF, IBAN e IDCliente mascarados: esta rota serve para
      // inspecionar o formato, não para expor dados pessoais.
      apolices: apolices.map((apolice) =>
        maskSensitiveFields(apolice, ["NIF", "IBAN", "IDCliente"]),
      ),
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        data,
        error:
          error instanceof Error
            ? sanitizeZurichText(error.message)
            : sanitizeZurichText(String(error)),
      },
      { status: 500 },
    );
  }
}