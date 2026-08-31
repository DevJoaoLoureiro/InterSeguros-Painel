import { NextResponse } from "next/server";

import { getPrevoirPolicies } from "@/lib/insurance/providers/prevoir/client";

export const dynamic = "force-dynamic";

/*
 * ROTA TEMPORÁRIA DE TESTE.
 *
 * Objetivo: confirmar quantas apólices modalidade=4
 * (PPR) a API oficial devolve, sem passar pela BD,
 * para comparar com as 84 que já temos guardadas
 * e as 95 que o portal mostra.
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

    const ppr = policies.filter((p) => Number(p.modalidade) === 4);

    const totalAnualizado = ppr.reduce(
      (sum, p) => sum + (Number(p.valorPremioAnualizado) || 0),
      0,
    );

    const byVersao = new Map<string, number>();

    for (const p of ppr) {
      const key = String(p.versao ?? "sem versão");
      byVersao.set(key, (byVersao.get(key) ?? 0) + 1);
    }

    return NextResponse.json({
      totalPoliciesFromApi: policies.length,
      pprCount: ppr.length,
      pprTotalAnualizado: totalAnualizado,
      byVersao: Object.fromEntries(byVersao),
      samplePolicyNumbers: ppr.slice(0, 100).map((p) => p.apolice),
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