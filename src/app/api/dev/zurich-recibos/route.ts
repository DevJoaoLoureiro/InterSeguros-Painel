import { getRecibosDoDia } from "@/lib/insurance/providers/zurich/client";
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
    const recibos = await getRecibosDoDia(data);

    return Response.json({
      success: true,
      data,
      count: recibos.length,
      // NIF e IDCliente mascarados: rota de inspeção de formato.
      recibos: recibos.map((recibo) =>
        maskSensitiveFields(recibo, ["NIF", "IDCliente"]),
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
            : "Erro desconhecido",
      },
      { status: 500 },
    );
  }
}