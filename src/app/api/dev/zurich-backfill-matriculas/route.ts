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

  const limit = Math.min(
    Number(searchParams.get("limit") ?? "50"),
    100,
  );

  const offset = Number(
    searchParams.get("offset") ?? "0",
  );

  const admin = createAdminClient();

  try {
    // 1. Encontrar a companhia Zurich
    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id, code, name")
      .eq("code", "ZURICH")
      .maybeSingle();

    if (companyError) {
      throw new Error(companyError.message);
    }

    if (!company) {
      return Response.json(
        {
          success: false,
          error: "Companhia Zurich não encontrada.",
        },
        { status: 404 },
      );
    }

    // 2. Buscar um lote de apólices Zurich
    const { data: policies, error: policiesError } = await admin
      .from("policies")
      .select(`
        id,
        policy_number,
        provider_metadata
      `)
      .eq("company_id", company.id)
      .order("policy_number", { ascending: true })
      .range(offset, offset + limit - 1);

    if (policiesError) {
      throw new Error(policiesError.message);
    }

    const results = {
      processed: 0,
      updated: 0,
      alreadyHadRegistration: 0,
      noVehicle: 0,
      noRegistration: 0,
      failed: 0,
      errors: [] as {
        policyNumber: string;
        error: string;
      }[],
    };

    for (const policy of policies ?? []) {
      results.processed++;

      try {
        const metadata =
          policy.provider_metadata &&
          typeof policy.provider_metadata === "object" &&
          !Array.isArray(policy.provider_metadata)
            ? policy.provider_metadata
            : {};

        const existingRegistration =
          typeof (metadata as Record<string, unknown>)
            .vehicleRegistration === "string"
            ? String(
                (metadata as Record<string, unknown>)
                  .vehicleRegistration,
              )
            : null;

        // Se já tiver matrícula, não precisamos voltar à Zurich.
        if (existingRegistration) {
          results.alreadyHadRegistration++;
          continue;
        }

        // 3. Buscar objetos de risco da apólice
        const objectResult =
          await obterObjetosPorNrApolice(
            policy.policy_number,
          );

        const objects =
          objectResult.ListaObjetos ?? [];

        const vehicle = objects.find(
          (object) =>
            object.TipoObjeto
              ?.trim()
              .toLowerCase() === "viatura",
        );

        if (!vehicle) {
          results.noVehicle++;
          continue;
        }

        const registration =
          extractVehicleRegistration(
            vehicle.DescricaoObjeto,
          );

        if (!registration) {
          results.noRegistration++;
          continue;
        }

        // 4. Preservar metadata existente e acrescentar viatura
        const newMetadata = {
          ...metadata,

          vehicleRegistration: registration,

          insuredObject: {
            number: vehicle.NumeroObjeto,
            type: vehicle.TipoObjeto,
            description: vehicle.DescricaoObjeto,
            status: vehicle.Estado,
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

        results.updated++;
      } catch (error) {
        results.failed++;

        results.errors.push({
          policyNumber: policy.policy_number,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        });
      }
    }

    return Response.json({
      success: true,

      batch: {
        offset,
        limit,
        returned: policies?.length ?? 0,
        nextOffset:
          (policies?.length ?? 0) === limit
            ? offset + limit
            : null,
      },

      results,
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