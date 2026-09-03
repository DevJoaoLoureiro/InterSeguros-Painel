import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  NormalizedPrevoirReceipt,
} from "@/lib/insurance/providers/prevoir/receipt-mapper";

type ReceiptToUpsert = {
  policyId: string;
  receipt: NormalizedPrevoirReceipt;
};

type BatchUpsertReceiptsParams = {
  supabase: SupabaseClient;
  companyId: string;
  items: ReceiptToUpsert[];
};

type BatchUpsertResult = {
  created: number;
  updated: number;
  unchanged: number;
};

type ReceiptRow = {
  id: string;
  external_id: string;
};

/*
 * Campos que, se diferentes do que já está
 * gravado, justificam reescrever o recibo.
 *
 * provider_metadata é comparado à parte.
 *
 * NOTA:
 * As comissões NÃO dependem desta comparação.
 * São sincronizadas separadamente para todos
 * os recibos recebidos da Prévoir.
 */
type ComparableReceiptRow = {
  external_id: string;

  receipt_type: string | null;

  period_start: string | null;
  period_end: string | null;

  issue_date: string | null;
  due_date: string | null;

  commercial_premium: number | null;
  total_premium: number | null;

  status: string | null;

  payment_date: string | null;
  payment_method: string | null;

  situation_date: string | null;

  external_version: string | null;

  cancellation_date: string | null;
  cancellation_reason: string | null;

  external_nature: string | null;
  external_payment_method: string | null;

  provider_metadata: unknown;
};

const BATCH_SIZE = 250;

function chunkArray<T>(
  items: T[],
  size: number,
): T[][] {
  const chunks: T[][] = [];

  for (
    let index = 0;
    index < items.length;
    index += size
  ) {
    chunks.push(
      items.slice(
        index,
        index + size,
      ),
    );
  }

  return chunks;
}

/*
 * JSON.stringify é sensível à ordem
 * das propriedades.
 *
 * Como jsonb do Postgres não garante
 * preservar essa ordem, normalizamos
 * recursivamente antes de comparar.
 */
function stableStringify(
  value: unknown,
): string {
  if (
    value === null ||
    typeof value !== "object"
  ) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value
      .map(stableStringify)
      .join(",")}]`;
  }

  const keys = Object.keys(
    value as Record<
      string,
      unknown
    >,
  ).sort();

  const entries = keys.map(
    (key) => {
      const entryValue = (
        value as Record<
          string,
          unknown
        >
      )[key];

      return `${JSON.stringify(
        key,
      )}:${stableStringify(
        entryValue,
      )}`;
    },
  );

  return `{${entries.join(",")}}`;
}

/*
 * Supabase/PostgREST pode devolver
 * numeric como string.
 *
 * Normalizamos para evitar:
 *
 * 150.5 !== "150.5"
 */
function normalizeNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

/*
 * Determina se os dados base
 * do recibo mudaram.
 *
 * As comissões são sincronizadas
 * independentemente deste resultado.
 */
function hasReceiptChanged(
  receipt: NormalizedPrevoirReceipt,
  existing: ComparableReceiptRow,
): boolean {
  if (
    receipt.receiptType !==
    existing.receipt_type
  ) {
    return true;
  }

  if (
    receipt.periodStart !==
    existing.period_start
  ) {
    return true;
  }

  if (
    receipt.periodEnd !==
    existing.period_end
  ) {
    return true;
  }

  if (
    receipt.issueDate !==
    existing.issue_date
  ) {
    return true;
  }

  if (
    receipt.dueDate !==
    existing.due_date
  ) {
    return true;
  }

  if (
    normalizeNumber(
      receipt.commercialPremium,
    ) !==
    normalizeNumber(
      existing.commercial_premium,
    )
  ) {
    return true;
  }

  if (
    normalizeNumber(
      receipt.totalPremium,
    ) !==
    normalizeNumber(
      existing.total_premium,
    )
  ) {
    return true;
  }

  if (
    receipt.status !==
    existing.status
  ) {
    return true;
  }

  if (
    receipt.paymentDate !==
    existing.payment_date
  ) {
    return true;
  }

  if (
    receipt.paymentMethod !==
    existing.payment_method
  ) {
    return true;
  }

  if (
    receipt.situationDate !==
    existing.situation_date
  ) {
    return true;
  }

  if (
    receipt.externalVersion !==
    existing.external_version
  ) {
    return true;
  }

  if (
    receipt.cancellationDate !==
    existing.cancellation_date
  ) {
    return true;
  }

  if (
    receipt.cancellationReason !==
    existing.cancellation_reason
  ) {
    return true;
  }

  if (
    receipt.externalNature !==
    existing.external_nature
  ) {
    return true;
  }

  if (
    receipt.externalPaymentMethod !==
    existing.external_payment_method
  ) {
    return true;
  }

  const newMetadata =
    stableStringify(
      receipt.providerMetadata ??
        {},
    );

  const existingMetadata =
    stableStringify(
      existing.provider_metadata ??
        {},
    );

  if (
    newMetadata !==
    existingMetadata
  ) {
    return true;
  }

  return false;
}

export async function batchUpsertReceipts({
  supabase,
  companyId,
  items,
}: BatchUpsertReceiptsParams): Promise<BatchUpsertResult> {
  if (items.length === 0) {
    return {
      created: 0,
      updated: 0,
      unchanged: 0,
    };
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  const batches =
    chunkArray(
      items,
      BATCH_SIZE,
    );

  for (const batch of batches) {
    const externalIds =
      batch.map(
        ({ receipt }) =>
          receipt.externalId,
      );

    // ======================================
    // RECIBOS EXISTENTES
    // ======================================

    const {
      data: existingRows,
      error: existingError,
    } = await supabase
      .from("receipts")
      .select(`
        id,
        external_id,
        receipt_type,
        period_start,
        period_end,
        issue_date,
        due_date,
        commercial_premium,
        total_premium,
        status,
        payment_date,
        payment_method,
        situation_date,
        external_version,
        cancellation_date,
        cancellation_reason,
        external_nature,
        external_payment_method,
        provider_metadata
      `)
      .eq(
        "company_id",
        companyId,
      )
      .in(
        "external_id",
        externalIds,
      );

    if (existingError) {
      throw new Error(
        `Erro ao verificar recibos existentes: ${existingError.message}`,
      );
    }

    const existingMap =
      new Map<
        string,
        ComparableReceiptRow & {
          id: string;
        }
      >();

    for (
      const row of
        (existingRows ??
          []) as Array<
          ComparableReceiptRow & {
            id: string;
          }
        >
    ) {
      existingMap.set(
        String(
          row.external_id,
        ),
        row,
      );
    }

    const now =
      new Date().toISOString();

    // ======================================
    // NOVOS + ALTERADOS
    // ======================================

    const toUpsert:
      typeof batch = [];

    for (
      const entry of batch
    ) {
      const existing =
        existingMap.get(
          entry.receipt.externalId,
        );

      if (!existing) {
        toUpsert.push(
          entry,
        );

        continue;
      }

      if (
        hasReceiptChanged(
          entry.receipt,
          existing,
        )
      ) {
        toUpsert.push(
          entry,
        );
      } else {
        unchanged += 1;
      }
    }

    // ======================================
    // UPSERT DOS RECIBOS ALTERADOS
    // ======================================

    const receiptIdMap =
      new Map<
        string,
        string
      >();

    /*
     * Primeiro metemos no mapa os
     * IDs dos recibos que já existiam.
     *
     * Assim também conseguimos
     * atualizar comissões de recibos
     * cujo resto dos dados não mudou.
     */
    for (
      const [
        externalId,
        existing,
      ] of existingMap.entries()
    ) {
      receiptIdMap.set(
        externalId,
        existing.id,
      );
    }

    if (
      toUpsert.length > 0
    ) {
      const receiptRows =
        toUpsert.map(
          ({
            policyId,
            receipt,
          }) => ({
            policy_id:
              policyId,

            company_id:
              companyId,

            external_id:
              receipt.externalId,

            receipt_number:
              receipt.receiptNumber,

            receipt_type:
              receipt.receiptType,

            period_start:
              receipt.periodStart,

            period_end:
              receipt.periodEnd,

            issue_date:
              receipt.issueDate,

            due_date:
              receipt.dueDate,

            commercial_premium:
              receipt.commercialPremium,

            total_premium:
              receipt.totalPremium,

            status:
              receipt.status,

            payment_date:
              receipt.paymentDate,

            payment_method:
              receipt.paymentMethod,

            situation_date:
              receipt.situationDate,

            external_version:
              receipt.externalVersion,

            cancellation_date:
              receipt.cancellationDate,

            cancellation_reason:
              receipt.cancellationReason,

            external_nature:
              receipt.externalNature,

            external_payment_method:
              receipt.externalPaymentMethod,

            provider_metadata:
              receipt.providerMetadata,

            last_synced_at:
              now,
          }),
        );

      const {
        data: savedReceipts,
        error: receiptsError,
      } = await supabase
        .from("receipts")
        .upsert(
          receiptRows,
          {
            onConflict:
              "company_id,external_id",
          },
        )
        .select(
          "id, external_id",
        );

      if (receiptsError) {
        throw new Error(
          `Erro no batch de recibos: ${receiptsError.message}`,
        );
      }

      const saved =
        (savedReceipts ??
          []) as ReceiptRow[];

      /*
       * Substitui/adiciona no mapa
       * os IDs devolvidos pelo upsert.
       */
      for (
        const row of saved
      ) {
        receiptIdMap.set(
          String(
            row.external_id,
          ),
          row.id,
        );
      }

      // ====================================
      // CONTADORES
      // ====================================

      for (
        const {
          receipt,
        } of toUpsert
      ) {
        if (
          existingMap.has(
            receipt.externalId,
          )
        ) {
          updated += 1;
        } else {
          created += 1;
        }
      }

      // ====================================
      // EXTERNAL REFS
      // ====================================

      const externalRefs =
        toUpsert.map(
          ({
            receipt,
          }) => {
            const receiptId =
              receiptIdMap.get(
                receipt.externalId,
              );

            if (!receiptId) {
              throw new Error(
                `ID interno não encontrado para recibo ${receipt.receiptNumber}`,
              );
            }

            return {
              receipt_id:
                receiptId,

              company_id:
                companyId,

              external_id:
                receipt.externalId,

              external_code:
                receipt.receiptNumber,

              last_synced_at:
                now,
            };
          },
        );

      if (
        externalRefs.length >
        0
      ) {
        const {
          error: refsError,
        } = await supabase
          .from(
            "receipt_external_refs",
          )
          .upsert(
            externalRefs,
            {
              onConflict:
                "company_id,external_id",
            },
          );

        if (refsError) {
          throw new Error(
            `Erro no batch de external refs: ${refsError.message}`,
          );
        }
      }
    }

    // ======================================
    // COMISSÕES
    // ======================================
    //
    // IMPORTANTE:
    //
    // As comissões são sincronizadas
    // para TODOS os recibos deste batch,
    // mesmo que o recibo tenha sido
    // considerado "unchanged".
    //
    // A Prévoir é a fonte autoritativa.
    //
    // Primeiro apagamos as comissões
    // existentes e depois gravamos
    // exatamente o estado atual recebido.
    //
    // Isto resolve:
    //
    // - comtot mudar sem outro campo mudar;
    // - comissão passar para zero;
    // - comissão antiga ficar na BD;
    // - tipos de comissão desaparecerem.
    // ======================================

    const receiptIdsForCommissions =
      Array.from(
        new Set(
          batch
            .map(
              ({
                receipt,
              }) =>
                receiptIdMap.get(
                  receipt.externalId,
                ),
            )
            .filter(
              (
                value,
              ): value is string =>
                Boolean(value),
            ),
        ),
      );

    // ======================================
    // APAGAR COMISSÕES ATUAIS
    // ======================================

    if (
      receiptIdsForCommissions.length >
      0
    ) {
      const {
        error:
          deleteCommissionsError,
      } = await supabase
        .from(
          "receipt_commissions",
        )
        .delete()
        .in(
          "receipt_id",
          receiptIdsForCommissions,
        );

      if (
        deleteCommissionsError
      ) {
        throw new Error(
          `Erro ao limpar comissões antigas: ${deleteCommissionsError.message}`,
        );
      }
    }

    // ======================================
    // PREPARAR COMISSÕES DA PRÉVOIR
    // ======================================

    const commissionRows =
      batch.flatMap(
        ({
          receipt,
        }) => {
          const receiptId =
            receiptIdMap.get(
              receipt.externalId,
            );

          if (!receiptId) {
            /*
             * Isto não deveria acontecer
             * porque todos os recibos do
             * batch têm de existir na BD
             * nesta fase.
             */
            return [];
          }

          return receipt.commissions.map(
            (
              commission,
            ) => ({
              receipt_id:
                receiptId,

              commission_type:
                commission.type,

              amount:
                commission.amount,

              external_type:
                commission.externalType,

              provider_metadata:
                {},
            }),
          );
        },
      );

    // ======================================
    // GRAVAR COMISSÕES ATUAIS
    // ======================================

    if (
      commissionRows.length >
      0
    ) {
      const {
        error:
          commissionsError,
      } = await supabase
        .from(
          "receipt_commissions",
        )
        .insert(
          commissionRows,
        );

      if (
        commissionsError
      ) {
        throw new Error(
          `Erro ao gravar comissões: ${commissionsError.message}`,
        );
      }
    }
  }

  return {
    created,
    updated,
    unchanged,
  };
}