import { createAdminClient } from "@/lib/supabase/admin";

import {
  getPrevoirPolicies,
  getPrevoirPoliciesIncremental,
} from "./client";

import {
  mapPrevoirPolicy,
} from "./mapper";

import {
  upsertClient,
} from "@/lib/insurance/sync/upsert-client";

import {
  upsertPolicy,
} from "@/lib/insurance/sync/upsert-policy";



type SyncOptions = {
  limit?: number;
};

export async function syncPrevoirPolicies(
  options: SyncOptions = {},
) {
  const supabase =
    createAdminClient();

  const limit =
    options.limit ?? 5;

  // ========================================
  // COMPANHIA
  // ========================================

  const {
    data: company,
    error: companyError,
  } = await supabase
    .from("companies")
    .select("id, code, name")
    .eq("code", "PREVOIR")
    .single();

  if (
    companyError ||
    !company
  ) {
    throw new Error(
      `Companhia PREVOIR não encontrada: ${
        companyError?.message ??
        "sem resultado"
      }`,
    );
  }

  // ========================================
  // SYNC RUN
  // ========================================

  const {
    data: syncRun,
    error: runError,
  } = await supabase
    .from("integration_sync_runs")
    .insert({
      company_id: company.id,
      resource_type: "POLICIES",
      status: "RUNNING",
      started_at:
        new Date().toISOString(),
    })
    .select("id")
    .single();

  if (
    runError ||
    !syncRun
  ) {
    throw new Error(
      `Erro ao iniciar sync: ${
        runError?.message ??
        "sem sync run"
      }`,
    );
  }

  let received = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  const errors: string[] = [];

  try {
     // ======================================
    // ESTADO DO SYNC (incremental vs completo)
    // ======================================

    const {
      data: syncState,
    } = await supabase
      .from("integration_sync_state")
      .select("last_successful_sync_at")
      .eq("company_id", company.id)
      .eq("resource_type", "POLICIES")
      .maybeSingle();

        let sourcePolicies: Awaited<ReturnType<typeof getPrevoirPolicies>>;

    let syncMode: "FULL" | "INCREMENTAL" = "FULL";

    if (syncState?.last_successful_sync_at) {
      const lastSync = new Date(
        syncState.last_successful_sync_at,
      );

      const sinceDate =
        `${lastSync.getFullYear()}${String(
          lastSync.getMonth() + 1,
        ).padStart(2, "0")}${String(
          lastSync.getDate(),
        ).padStart(2, "0")}`;

      sourcePolicies =
        await getPrevoirPoliciesIncremental(sinceDate);

      syncMode = "INCREMENTAL";
    } else {
      // ======================================
      // API PREVOIR (primeira vez, tudo)
      // ======================================

      sourcePolicies =
        await getPrevoirPolicies();
    }

    const selectedPolicies =
      [...sourcePolicies]
        .sort((a, b) => {
          const dateA =
            a.dataEmissaoContrato
              ? new Date(
                  a.dataEmissaoContrato,
                ).getTime()
              : 0;

          const dateB =
            b.dataEmissaoContrato
              ? new Date(
                  b.dataEmissaoContrato,
                ).getTime()
              : 0;

          return dateB - dateA;
        })
        .slice(0, limit);

    received =
      selectedPolicies.length;

    // ======================================
    // PROCESSAR
    // ======================================

    for (
      const source
      of selectedPolicies
    ) {
      try {
        const normalized =
          mapPrevoirPolicy(source);

        // ----------------------------------
        // RAMO
        // ----------------------------------

        let insuranceLineId:
          | string
          | null = null;

        const providerCode =
          String(source.modalidade);

        const {
          data: providerProduct,
          error:
            providerProductError,
        } = await supabase
          .from("provider_products")
          .select(`
            id,
            insurance_line_id
          `)
          .eq(
            "company_id",
            company.id,
          )
          .eq(
            "provider_code",
            providerCode,
          )
          .maybeSingle();

        if (
          providerProductError
        ) {
          throw new Error(
            `Erro provider product ${providerCode}: ${providerProductError.message}`,
          );
        }

        if (
          providerProduct
            ?.insurance_line_id
        ) {
          insuranceLineId =
            providerProduct
              .insurance_line_id;
        } else if (
          normalized
            .insuranceLineCode
        ) {
          const {
            data: line,
            error: lineError,
          } = await supabase
            .from(
              "insurance_lines",
            )
            .select("id")
            .eq(
              "code",
              normalized
                .insuranceLineCode,
            )
            .maybeSingle();

          if (lineError) {
            throw new Error(
              `Erro ramo ${normalized.insuranceLineCode}: ${lineError.message}`,
            );
          }

          insuranceLineId =
            line?.id ?? null;
        }

        // ----------------------------------
        // CLIENTE
        // ----------------------------------

        const nif =
          normalized.client.nif
            ?.replace(
              /\D/g,
              "",
            ) || null;

        const externalClientId =
          nif
            ? `NIF:${nif}`
            : `POLICY:${normalized.externalId}`;

        const clientResult =
          await upsertClient({
            supabase,
            companyId:
              company.id,
            externalClientId,
            policy: normalized,
          });

        // ----------------------------------
        // APÓLICE
        // ----------------------------------

        const policyResult =
          await upsertPolicy({
            supabase,
            companyId:
              company.id,
            clientId:
              clientResult.clientId,
            insuranceLineId,
            policy: normalized,
          });

        if (
          policyResult.created
        ) {
          created += 1;
        } else {
          updated += 1;
        }
      } catch (error) {
        failed += 1;

        const message =
          error instanceof Error
            ? error.message
            : "Erro desconhecido";

        errors.push(message);

        console.error(
          "Erro ao sincronizar apólice Prévoir:",
          error,
        );
      }
    }

    // ======================================
    // FINALIZAR
    // ======================================


    
    const finalStatus =
      failed === 0
        ? "SUCCESS"
        : created + updated > 0
          ? "PARTIAL"
          : "ERROR";

              // ======================================
    // ATUALIZAR ESTADO (só se correu bem)
    // ======================================

    if (failed === 0) {
      await supabase
        .from("integration_sync_state")
        .upsert(
          {
            company_id: company.id,
            resource_type: "POLICIES",
            last_successful_sync_at: new Date().toISOString(),
            last_attempt_at: new Date().toISOString(),
            status: "SUCCESS",
          },
          {
            onConflict: "company_id,resource_type",
          },
        );
    }
    const {
      error: finishError,
    } = await supabase
      .from(
        "integration_sync_runs",
      )
      .update({
        finished_at:
          new Date().toISOString(),

        status:
          finalStatus,

        records_received:
          received,

        records_created:
          created,

        records_updated:
          updated,

        records_skipped:
          skipped,

        records_failed:
          failed,

        error_message:
          errors.length > 0
            ? errors
                .slice(0, 10)
                .join("\n")
            : null,
      })
      .eq("id", syncRun.id);

    if (finishError) {
      throw new Error(
        `Erro ao finalizar sync run: ${finishError.message}`,
      );
    }

        return {
      ok:
        finalStatus !==
        "ERROR",

      syncRunId:
        syncRun.id,

      status:
        finalStatus,

      syncMode,

      received,
      created,
      updated,
      skipped,
      failed,

      errors:
        errors.slice(0, 10),
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Erro desconhecido";

    await supabase
      .from(
        "integration_sync_runs",
      )
      .update({
        finished_at:
          new Date().toISOString(),

        status: "ERROR",

        records_received:
          received,

        records_created:
          created,

        records_updated:
          updated,

        records_skipped:
          skipped,

        records_failed:
          failed,

        error_message:
          message,
      })
      .eq("id", syncRun.id);

    throw error;
  }
}