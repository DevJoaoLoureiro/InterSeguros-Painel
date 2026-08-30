import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  NormalizedPrevoirReceipt,
} from "@/lib/insurance/providers/prevoir/receipt-mapper";

type UpsertReceiptParams = {
  supabase: SupabaseClient;

  companyId: string;

  policyId: string;

  receipt: NormalizedPrevoirReceipt;
};

type UpsertReceiptResult = {
  receiptId: string;
  created: boolean;
};

export async function upsertReceipt({
  supabase,
  companyId,
  policyId,
  receipt,
}: UpsertReceiptParams): Promise<UpsertReceiptResult> {
  // ========================================
  // PROCURAR RECIBO EXISTENTE
  // ========================================

  const {
    data: existing,
    error: existingError,
  } = await supabase
    .from("receipts")
    .select("id")
    .eq(
      "company_id",
      companyId,
    )
    .eq(
      "external_id",
      receipt.externalId,
    )
    .maybeSingle();

  if (existingError) {
    throw new Error(
      `Erro ao procurar recibo ${receipt.receiptNumber}: ${existingError.message}`,
    );
  }

  // ========================================
  // VALORES NORMALIZADOS
  // ========================================

  const values = {
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
      new Date().toISOString(),
  };

  let receiptId: string;
  let created = false;

  // ========================================
  // UPDATE
  // ========================================

  if (existing) {
    const {
      data: updated,
      error: updateError,
    } = await supabase
      .from("receipts")
      .update(values)
      .eq(
        "id",
        existing.id,
      )
      .select("id")
      .single();

    if (
      updateError ||
      !updated
    ) {
      throw new Error(
        `Erro ao atualizar recibo ${receipt.receiptNumber}: ${
          updateError?.message ??
          "sem resultado"
        }`,
      );
    }

    receiptId =
      updated.id;
  }

  // ========================================
  // INSERT
  // ========================================

  else {
    const {
      data: inserted,
      error: insertError,
    } = await supabase
      .from("receipts")
      .insert(values)
      .select("id")
      .single();

    if (
      insertError ||
      !inserted
    ) {
      throw new Error(
        `Erro ao criar recibo ${receipt.receiptNumber}: ${
          insertError?.message ??
          "sem resultado"
        }`,
      );
    }

    receiptId =
      inserted.id;

    created = true;
  }

  // ========================================
  // EXTERNAL REF
  // ========================================

  const {
    error: refError,
  } = await supabase
    .from(
      "receipt_external_refs",
    )
    .upsert(
      {
        receipt_id:
          receiptId,

        company_id:
          companyId,

        external_id:
          receipt.externalId,

        external_code:
          receipt.receiptNumber,

        last_synced_at:
          new Date().toISOString(),
      },
      {
        onConflict:
          "company_id,external_id",
      },
    );

  if (refError) {
    throw new Error(
      `Erro external ref do recibo ${receipt.receiptNumber}: ${refError.message}`,
    );
  }

  // ========================================
  // COMISSÕES
  // ========================================

  for (
    const commission
    of receipt.commissions
  ) {
    const {
      error: commissionError,
    } = await supabase
      .from(
        "receipt_commissions",
      )
      .upsert(
        {
          receipt_id:
            receiptId,

          commission_type:
            commission.type,

          amount:
            commission.amount,

          external_type:
            commission.externalType,

          provider_metadata: {},
        },
        {
          onConflict:
            "receipt_id,commission_type",
        },
      );

    if (commissionError) {
      throw new Error(
        `Erro comissão ${commission.type} do recibo ${receipt.receiptNumber}: ${commissionError.message}`,
      );
    }
  }

  return {
    receiptId,
    created,
  };
}