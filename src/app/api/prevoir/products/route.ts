import { NextResponse } from "next/server";

import {
  getPrevoirPolicies,
} from "@/lib/insurance/providers/prevoir/client";

export async function GET() {
  try {
    const policies =
      await getPrevoirPolicies();

    const codes = new Map<
      string,
      {
        providerCode: string;
        count: number;
        names: Set<string>;
      }
    >();

    for (const policy of policies) {
      const providerCode =
        String(policy.modalidade);

      const providerName =
        policy.descricaoModalidade?.trim() ||
        "Sem descrição";

      const existing =
        codes.get(providerCode);

      if (existing) {
        existing.count += 1;
        existing.names.add(
          providerName,
        );
      } else {
        codes.set(providerCode, {
          providerCode,
          count: 1,
          names: new Set([
            providerName,
          ]),
        });
      }
    }

    const products =
      Array.from(
        codes.values(),
      )
        .map((item) => ({
          providerCode:
            item.providerCode,

          count:
            item.count,

          names:
            Array.from(
              item.names,
            ).sort(),
        }))
        .sort(
          (a, b) =>
            b.count - a.count,
        );

    return NextResponse.json({
      ok: true,

      totalPolicies:
        policies.length,

      totalProviderCodes:
        products.length,

      countedPolicies:
        products.reduce(
          (sum, item) =>
            sum + item.count,
          0,
        ),

      products,
    });
  } catch (error) {
    console.error(
      "Erro produtos Prévoir:",
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