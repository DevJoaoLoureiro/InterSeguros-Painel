import { getPrevoirPolicy } from "@/lib/insurance/providers/prevoir/client";

function sanitizeValue(key: string, value: unknown): unknown {
  const sensitiveKeys = [
    "nif",
    "nome",
    "rua",
    "morada",
    "email",
    "telefone",
    "telemovel",
    "iban",
    "nib",
  ];

  const normalizedKey = key.toLowerCase();

  if (sensitiveKeys.some((sensitive) => normalizedKey.includes(sensitive))) {
    return value == null ? value : "***";
  }

  return value;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const modalidade = searchParams.get("modalidade");
  const apolice = searchParams.get("apolice");

  if (!modalidade || !apolice) {
    return Response.json(
      {
        success: false,
        error: "Usa ?modalidade=...&apolice=...",
      },
      { status: 400 },
    );
  }

  try {
    const policies = await getPrevoirPolicy(modalidade, apolice);

    const sanitized = policies.map((policy) =>
      Object.fromEntries(
        Object.entries(policy).map(([key, value]) => [
          key,
          sanitizeValue(key, value),
        ]),
      ),
    );

    const keys = Array.from(
      new Set(policies.flatMap((policy) => Object.keys(policy))),
    ).sort();

    const vehicleLikeKeys = keys.filter((key) =>
      /matric|viatur|vehicle|registration|plate|autom|objeto|risco/i.test(key),
    );

    return Response.json({
      success: true,
      modalidade,
      apolice,
      count: policies.length,
      vehicleLikeKeys,
      keys,
      policies: sanitized,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
