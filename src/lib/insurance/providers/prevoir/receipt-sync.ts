import {
  createAdminClient,
} from "@/lib/supabase/admin";

import {
  getPrevoirReceipts,
} from "./receipts";

import {
  mapPrevoirReceipt,
} from "./receipt-mapper";

import {
  batchUpsertReceipts,
} from "@/lib/insurance/sync/batch-upsert-receipts";

type SyncOptions = {
  limit?: number;
};

type PolicyRow = {
  id: string;
  external_id: string | null;
};

function getReceiptTimestamp(
  value:
    | string
    | number
    | null,
) {
  if (!value) {
    return 0;
  }

  const raw =
    String(value).trim();

  if (/^\d{8}$/.test(raw)) {
    const year =
      Number(
        raw.slice(0, 4),
      );

    const month =
      Number(
        raw.slice(4, 6),
      ) - 1;

    const day =
      Number(
        raw.slice(6, 8),
      );

    return new Date(
      year,
      month,
      day,
    ).getTime();
  }

  const timestamp =
    new Date(raw).getTime();

  return Number.isFinite(
    timestamp,
  )
    ? timestamp
    : 0;
}

export async function syncPrevoirReceipts(
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
    .select(
      "id, code, name",
    )
    .eq(
      "code",
      "PREVOIR",
    )
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
    .from(
      "integration_sync_runs",
    )
    .insert({
      company_id:
        company.id,

      resource_type:
        "RECEIPTS",

      status:
        "RUNNING",

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
      `Erro ao iniciar sync de recibos: ${
        runError?.message ??
        "sem sync run"
      }`,
    );
  }

  let received = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let unchanged = 0;   
  let failed = 0;

  const errors: string[] =
    [];

  try {
    // ======================================
    // CACHE DAS APÓLICES
    // ======================================

    const {
      data: policies,
      error: policiesError,
    } = await supabase
      .from("policies")
      .select(
        "id, external_id",
      )
      .eq(
        "company_id",
        company.id,
      );

    if (policiesError) {
      throw new Error(
        `Erro ao carregar apólices Prévoir: ${policiesError.message}`,
      );
    }

    const policyMap =
      new Map<
        string,
        string
      >();

    for (
      const policy
      of (policies ??
        []) as PolicyRow[]
    ) {
      if (
        policy.external_id
      ) {
        policyMap.set(
          policy.external_id,
          policy.id,
        );
      }
    }

    // ======================================
    // API PREVOIR
    // ======================================

    const sourceReceipts =
      await getPrevoirReceipts();

    const selectedReceipts =
      [...sourceReceipts]
        .sort(
          (a, b) =>
            getReceiptTimestamp(
              b.dataEmissaoRecibo,
            ) -
            getReceiptTimestamp(
              a.dataEmissaoRecibo,
            ),
        )
        .slice(
          0,
          limit,
        );

    received =
      selectedReceipts.length;

    // ======================================
    // NORMALIZAR EM MEMÓRIA
    // ======================================

    const items: Array<{
      policyId: string;
      receipt: ReturnType<
        typeof mapPrevoirReceipt
      >;
    }> = [];

    for (
      const source
      of selectedReceipts
    ) {
      try {
        const normalized =
          mapPrevoirReceipt(
            source,
          );

        const policyId =
          policyMap.get(
            normalized.policyExternalId,
          );

        if (!policyId) {
          skipped += 1;

          errors.push(
            `Apólice ${normalized.policyExternalId} não encontrada para o recibo ${normalized.receiptNumber}`,
          );

          continue;
        }

        items.push({
          policyId,
          receipt:
            normalized,
        });
      } catch (error) {
        failed += 1;

        const message =
          error instanceof Error
            ? error.message
            : "Erro desconhecido";

        errors.push(
          message,
        );

        console.error(
          "Erro ao normalizar recibo Prévoir:",
          error,
        );
      }
    }

    // ======================================
    // BATCH UPSERT
    // ======================================

    if (
      items.length > 0
    ) {
      try {
        const result =
          await batchUpsertReceipts({
            supabase,

            companyId:
              company.id,

            items,
          });

         created +=
          result.created;

        updated +=
          result.updated;

        unchanged +=
            result.unchanged;
      } catch (error) {
        /*
         * Nesta fase um erro de batch
         * significa que não conseguimos
         * afirmar que todos os items
         * daquele processamento ficaram
         * completos.
         */

        failed +=
          items.length;

        const message =
          error instanceof Error
            ? error.message
            : "Erro desconhecido";

        errors.push(
          message,
        );

        console.error(
          "Erro batch recibos Prévoir:",
          error,
        );
      }
    }

    // ======================================
    // FINALIZAR
    // ======================================

    const successful =
      created + updated;

    const finalStatus =
      failed === 0 &&
      skipped === 0
        ? "SUCCESS"
        : successful > 0
          ? "PARTIAL"
          : "ERROR";

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
          skipped + unchanged,

        records_failed:
          failed,

        error_message:
          errors.length > 0
            ? errors
                .slice(0, 10)
                .join("\n")
            : null,
      })
      .eq(
        "id",
        syncRun.id,
      );

    if (finishError) {
      throw new Error(
        `Erro ao finalizar sync de recibos: ${finishError.message}`,
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

      totalAvailable:
        sourceReceipts.length,

      received,
      created,
      updated,
      unchanged,
      skipped,
      failed,

      errors:
        errors.slice(
          0,
          10,
        ),
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

        status:
          "ERROR",

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
      .eq(
        "id",
        syncRun.id,
      );

    throw error;
  }
}