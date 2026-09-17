import { createAdminClient } from "@/lib/supabase/admin";
import { obterObjetosPorNrApolice } from "@/lib/insurance/providers/zurich/client";

function extractVehicleRegistration(
  description: string | null | undefined,
): string | null {
  if (!description) return null;

  const match = description.match(
    /\b[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]{2}\b/i,
  );

  return match?.[0]?.toUpperCase() ?? null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const apolice = searchParams.get("apolice");

  if (!apolice) {
    return Response.json(
      {
        success: false,
        error: "Falta ?apolice=NUMERO",
      },
      { status: 400 },
    );
  }

  try {
    const admin = createAdminClient();

    const { data: policy, error: policyError } = await admin
      .from("policies")
      .select("id, policy_number, provider_metadata")
      .eq("policy_number", apolice)
      .maybeSingle();

    if (policyError) {
      throw new Error(policyError.message);
    }

    if (!policy) {
      return Response.json(
        {
          success: false,
          error: "Apólice não encontrada no CRM",
        },
        { status: 404 },
      );
    }

    const result = await obterObjetosPorNrApolice(apolice);

    const objetos = result.ListaObjetos ?? [];

    const viatura = objetos.find(
      (objeto) =>
        objeto.TipoObjeto?.trim().toLowerCase() === "viatura",
    );

    if (!viatura) {
      return Response.json({
        success: false,
        error: "Não foi encontrada viatura para esta apólice",
        objetos,
      });
    }

    const matricula = extractVehicleRegistration(
      viatura.DescricaoObjeto,
    );

    if (!matricula) {
      return Response.json({
        success: false,
        error: "Não foi possível extrair a matrícula",
        viatura,
      });
    }

    const currentMetadata =
      policy.provider_metadata &&
      typeof policy.provider_metadata === "object"
        ? policy.provider_metadata
        : {};

    const newMetadata = {
      ...currentMetadata,
      vehicleRegistration: matricula,
      insuredObject: {
        number: viatura.NumeroObjeto,
        type: viatura.TipoObjeto,
        description: viatura.DescricaoObjeto,
        status: viatura.Estado,
      },
    };

    const { error: updateError } = await admin
      .from("policies")
      .update({
        provider_metadata: newMetadata,
      })
      .eq("id", policy.id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return Response.json({
      success: true,
      apolice,
      matricula,
      provider_metadata: newMetadata,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      { status: 500 },
    );
  }
}