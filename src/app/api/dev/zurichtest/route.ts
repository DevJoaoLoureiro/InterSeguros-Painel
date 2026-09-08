import { criarNovoTokenZurich } from "@/lib/insurance/providers/zurich/client";

export async function GET() {
  try {
    const result = await criarNovoTokenZurich();

    return Response.json({
      success: true,
      result,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro desconhecido.",
      },
      { status: 500 },
    );
  }
}