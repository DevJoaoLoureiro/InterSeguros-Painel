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

type PrevoirSource = Awaited<ReturnType<typeof getPrevoirPolicies>>[number];

/*
 * Apólices que JÁ estão no CRM mas que a Prévoir tem diferentes nos
 * campos que contam para a carteira (estado, prémio, fracionamento,
 * produto, datas). As que faltam no CRM ficam para o modo
 * missingOnly, que tem limite por execução.
 */
async function findChangedPolicies(
  supabase: ReturnType<typeof createAdminClient>,
  companyId: string,
  sources: PrevoirSource[],
): Promise<PrevoirSource[]> {
  const { data, error } = await supabase
    .from("policies")
    .select(
      "external_id, status, annualized_premium, payment_frequency, product_code, start_date, renewal_date",
    )
    .eq("company_id", companyId)
    // Sem isto a consulta devolve no máximo 1000 linhas.
    .range(0, 9999);

  if (error) {
    throw new Error(
      `Erro ao comparar apólices com a Prévoir: ${error.message}`,
    );
  }

  const stored = new Map(
    (data ?? []).map((row) => [row.external_id, row]),
  );

  return sources.filter((source) => {
    const policy = mapPrevoirPolicy(source);
    const row = stored.get(policy.externalId);

    if (!row) return false;

    const premiumChanged =
      Math.abs(
        Number(row.annualized_premium ?? 0) -
          Number(policy.annualizedPremium ?? 0),
      ) > 0.005;

    return (
      premiumChanged ||
      row.status !== policy.status ||
      row.payment_frequency !== policy.paymentFrequency ||
      (row.product_code ?? null) !== (policy.productCode ?? null) ||
      (row.start_date ?? null) !== (policy.startDate ?? null) ||
      (row.renewal_date ?? null) !== (policy.renewalDate ?? null)
    );
  });
}



type SyncOptions = {
  limit?: number;
  /*
   * Importa as apolices que a Prevoir tem na conta e que ainda nao
   * existem no CRM (ex.: carteira transferida para o mediador). O
   * incremental nunca as traz, porque nao foram alteradas. Com
   * `limit`, importa so esse numero por execucao: repetir ate a
   * resposta dizer que nao falta nenhuma.
   */
  missingOnly?: boolean;
};

export async function syncPrevoirPolicies(
  options: SyncOptions = {},
) {
  const supabase =
    createAdminClient();

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
      `Companhia PREVOIR nÃ£o encontrada: ${
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
  const skipped = 0;
  let failed = 0;
  // So no modo missingOnly: quantas faltavam antes desta execucao.
  let missingBefore: number | null = null;

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

    let syncMode: "FULL" | "INCREMENTAL" | "MISSING" = "FULL";

    if (options.missingOnly) {
      const { data: existing, error: existingError } = await supabase
        .from("policies")
        .select("external_id")
        .eq("company_id", company.id)
        // Sem isto a consulta devolve no maximo 1000 linhas.
        .range(0, 9999);

      if (existingError) {
        throw new Error(
          `Erro ao carregar apolices existentes: ${existingError.message}`,
        );
      }

      const known = new Set(
        (existing ?? []).map((policy) => policy.external_id),
      );

      sourcePolicies = (await getPrevoirPolicies()).filter(
        (source) => !known.has(mapPrevoirPolicy(source).externalId),
      );

      missingBefore = sourcePolicies.length;
      syncMode = "MISSING";
    } else if (syncState?.last_successful_sync_at) {
      const lastSync = new Date(
        syncState.last_successful_sync_at,
      );

      const sinceDate =
        `${lastSync.getFullYear()}${String(
          lastSync.getMonth() + 1,
        ).padStart(2, "0")}${String(
          lastSync.getDate(),
        ).padStart(2, "0")}`;

      const incremental =
        await getPrevoirPoliciesIncremental(sinceDate);

      // O incremental não traz tudo: atualizações de prémio (ex.: no
      // aniversário da apólice) não aparecem como alteradas e o CRM
      // ficava com o valor antigo para sempre. A lista completa custa
      // ~1 s, por isso compara-se também com o CRM e juntam-se as
      // apólices que mudaram nos campos principais.
      const changed = await findChangedPolicies(
        supabase,
        company.id,
        await getPrevoirPolicies(),
      );

      const incrementalIds = new Set(
        incremental.map((source) => mapPrevoirPolicy(source).externalId),
      );

      sourcePolicies = [
        ...incremental,
        ...changed.filter(
          (source) =>
            !incrementalIds.has(mapPrevoirPolicy(source).externalId),
        ),
      ];

      syncMode = "INCREMENTAL";
    } else {
      // ======================================
      // API PREVOIR (primeira vez, tudo)
      // ======================================

      sourcePolicies =
        await getPrevoirPolicies();
    }

    const sortedPolicies =
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
        });

    const selectedPolicies =
      options.limit
        ? sortedPolicies.slice(
            0,
            options.limit,
          )
        : sortedPolicies;

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
        // APÃ“LICE
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
          "Erro ao sincronizar apÃ³lice PrÃ©voir:",
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
    // ATUALIZAR ESTADO (sÃ³ se correu bem)
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

      // Modo missingOnly: quantas ficam por importar depois desta execucao.
      missingRemaining:
        missingBefore === null
          ? null
          : missingBefore - created - updated,

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
