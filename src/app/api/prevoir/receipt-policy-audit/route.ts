import { NextResponse } from "next/server";

import {
  getPrevoirReceipts,
} from "@/lib/insurance/providers/prevoir/receipts";

import {
  createAdminClient,
} from "@/lib/supabase/admin";

export async function GET() {
  try {
    const supabase =
      createAdminClient();

    // 1. Descobrir a companhia PREVOIR
    const {
      data: company,
      error: companyError,
    } = await supabase
      .from("companies")
      .select("id")
      .eq("code", "PREVOIR")
      .single();

    if (
      companyError ||
      !company
    ) {
      throw new Error(
        `Não foi possível encontrar a companhia PREVOIR: ${
          companyError?.message ??
          "companhia inexistente"
        }`,
      );
    }

    // 2. Buscar as apólices Prévoir
    // que já temos no Supabase
    const {
      data: policies,
      error: policiesError,
    } = await supabase
      .from("policies")
      .select(
        "external_id, policy_number, product_code",
      )
      .eq(
        "company_id",
        company.id,
      );

    if (policiesError) {
      throw new Error(
        `Erro ao carregar apólices: ${policiesError.message}`,
      );
    }

    // 3. Criar Set para pesquisa rápida
    const policyExternalIds =
      new Set(
        (policies ?? [])
          .map(
            (policy) =>
              policy.external_id,
          )
          .filter(
            (
              value,
            ): value is string =>
              Boolean(value),
          ),
      );

    // 4. Buscar os recibos Prévoir
    const receipts =
      await getPrevoirReceipts();

    let matchedReceipts = 0;
    let missingReceipts = 0;

    const matchedUniquePolicies =
      new Set<string>();

    const missingUniquePolicies =
      new Set<string>();

    const missingByModality =
      new Map<string, number>();

    const missingUniqueByModality =
      new Map<
        string,
        Set<string>
      >();

    for (
      const receipt of receipts
    ) {
      const modalidade =
        String(
          receipt.modalidade,
        ).trim();

      const policyNumber =
        String(
          receipt.apolice,
        ).trim();

      const externalId =
        `${modalidade}:${policyNumber}`;

      if (
        policyExternalIds.has(
          externalId,
        )
      ) {
        matchedReceipts += 1;

        matchedUniquePolicies.add(
          externalId,
        );

        continue;
      }

      missingReceipts += 1;

      missingUniquePolicies.add(
        externalId,
      );

      missingByModality.set(
        modalidade,
        (
          missingByModality.get(
            modalidade,
          ) ?? 0
        ) + 1,
      );

      if (
        !missingUniqueByModality.has(
          modalidade,
        )
      ) {
        missingUniqueByModality.set(
          modalidade,
          new Set(),
        );
      }

      missingUniqueByModality
        .get(modalidade)!
        .add(externalId);
    }

    const missingBreakdown =
      Array.from(
        missingByModality.entries(),
      )
        .map(
          ([
            modalidade,
            receiptCount,
          ]) => ({
            modalidade,

            receiptCount,

            uniquePolicies:
              missingUniqueByModality.get(
                modalidade,
              )?.size ?? 0,
          }),
        )
        .sort(
          (a, b) =>
            b.receiptCount -
            a.receiptCount,
        );

    return NextResponse.json({
      ok: true,

      supabasePolicies:
        policies?.length ?? 0,

      totalReceipts:
        receipts.length,

      matchedReceipts,

      missingReceipts,

      matchedPercentage:
        receipts.length > 0
          ? Number(
              (
                (matchedReceipts /
                  receipts.length) *
                100
              ).toFixed(2),
            )
          : 0,

      missingPercentage:
        receipts.length > 0
          ? Number(
              (
                (missingReceipts /
                  receipts.length) *
                100
              ).toFixed(2),
            )
          : 0,

      uniquePoliciesReferencedByReceipts:
        new Set(
          receipts.map(
            (receipt) =>
              `${String(
                receipt.modalidade,
              ).trim()}:${String(
                receipt.apolice,
              ).trim()}`,
          ),
        ).size,

      matchedUniquePolicies:
        matchedUniquePolicies.size,

      missingUniquePolicies:
        missingUniquePolicies.size,

      missingBreakdown,
    });
  } catch (error) {
    console.error(
      "Erro audit recibos/apólices Prévoir:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Erro desconhecido",
      },
      {
        status: 500,
      },
    );
  }
}