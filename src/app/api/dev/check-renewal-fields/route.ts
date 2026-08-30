import { NextResponse } from "next/server";

import { getPrevoirPolicies } from "@/lib/insurance/providers/prevoir/client";

export const dynamic = "force-dynamic";

/*
 * ROTA TEMPORÁRIA DE TESTE.
 *
 * Objetivo: ver TODOS os campos que a API oficial
 * da Prévoir devolve numa apólice real, para
 * confirmar se existe algum campo de renovação
 * que ainda não mapeámos.
 *
 * Apagar depois de confirmado.
 */

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Só em desenvolvimento." },
      { status: 404 },
    );
  }

  try {
    const policies = await getPrevoirPolicies();

    if (policies.length === 0) {
      return NextResponse.json({ error: "Sem policies." });
    }

    // pega em 3 exemplos de produtos diferentes, se possível
    const samples = [];
    const seenModalidades = new Set<number>();

    for (const policy of policies) {
      if (!seenModalidades.has(policy.modalidade)) {
        seenModalidades.add(policy.modalidade);
        samples.push(policy);
      }

      if (samples.length >= 3) {
        break;
      }
    }

    return NextResponse.json({
      totalPolicies: policies.length,
      allKeysFound: Array.from(
        new Set(policies.flatMap((p) => Object.keys(p))),
      ).sort(),
      samples,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}