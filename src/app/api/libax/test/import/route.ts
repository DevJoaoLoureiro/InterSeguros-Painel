import {
  getIssuedContractsWithDetails,
} from "@/lib/libax/client";

import {
  createAdminClient,
} from "@/lib/supabase/admin";

export async function POST() {
  try {
    const today =
      new Intl.DateTimeFormat(
        "en-CA",
        {
          timeZone: "Europe/Lisbon",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        },
      ).format(new Date());

    const contracts =
      await getIssuedContractsWithDetails(
        today,
      );

    const supabase =
      createAdminClient();

    let clientsImported = 0;
    let policiesImported = 0;

    for (const contract of contracts) {
      // ======================================
      // CLIENTE
      // ======================================

      const {
        data: client,
        error: clientError,
      } = await supabase
        .from("clients")
        .upsert(
          {
            source: "libax",

            external_id:
              String(
                contract.client.id,
              ),

            name:
              contract.client.name,

            nif:
              contract.client.nif,

            email:
              contract.client.email,

            phone:
              contract.client.phone,

            birth_date:
              contract.client.birthDate,

            city:
              contract.client.city,

            street:
              contract.client.street,

            last_synced_at:
              new Date().toISOString(),
          },
          {
            onConflict:
              "source,external_id",
          },
        )
        .select("id")
        .single();

      if (clientError || !client) {
        throw new Error(
          `Erro ao guardar cliente ${contract.client.id}: ${
            clientError?.message ??
            "Cliente não devolvido."
          }`,
        );
      }

      clientsImported += 1;

      // ======================================
      // APÓLICE
      // ======================================

      const {
        error: policyError,
      } = await supabase
        .from("policies")
        .upsert(
          {
            source: "libax",

            external_id:
              String(
                contract.contractId,
              ),

            client_id:
              client.id,

            policy_number:
              contract.policyNumber,

            company_external_id:
              String(
                contract.company.id,
              ),

            company_name:
              contract.company.name,

            product_external_id:
              String(
                contract.product.id,
              ),

            product_name:
              contract.product.name,

            line_external_id:
              String(
                contract.line.id,
              ),

            line_name:
              contract.line.name,

            issue_date:
              contract.issueDate,

            start_date:
              contract.startDate,

            end_date:
              contract.endDate,

            renew_date:
              contract.renewDate,

            premium:
              contract.premium,

            fraction_type:
              contract.fractionType,

            status:
              contract.status,

            last_synced_at:
              new Date().toISOString(),
          },
          {
            onConflict:
              "source,external_id",
          },
        );

      if (policyError) {
        throw new Error(
          `Erro ao guardar apólice ${contract.policyNumber}: ${policyError.message}`,
        );
      }

      policiesImported += 1;
    }

    return Response.json({
      success: true,

      date: today,

      found:
        contracts.length,

      clientsImported,

      policiesImported,
    });
  } catch (error) {
    console.error(
      "Libax import error:",
      error,
    );

    return Response.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Erro desconhecido.",
      },
      {
        status: 500,
      },
    );
  }
}