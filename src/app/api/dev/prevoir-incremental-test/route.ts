import { NextResponse } from "next/server";

import { loginPrevoir } from "@/lib/insurance/providers/prevoir/client";

export const dynamic = "force-dynamic";

/*
 * ROTA TEMPORÁRIA DE TESTE.
 *
 * Objetivo único: confirmar se o endpoint incremental
 * de recibos existe, com o mesmo padrão do de policies.
 *
 * Apagar depois de confirmado.
 */

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Só em desenvolvimento." },
      { status: 404 },
    );
  }

  const url = new URL(request.url);

  // formato esperado: AAAAMMDD, ex: 20240101
  const date = url.searchParams.get("date") ?? "20240101";

  try {
    const apiUrl = process.env.PREVOIR_API_URL;

    if (!apiUrl) {
      throw new Error("PREVOIR_API_URL não configurado.");
    }

    const login = await loginPrevoir();

    const mediatorNumber =
      process.env.PREVOIR_MEDIATOR_NUMBER || String(login.user.nAgente);

    // ==========================================
    // TESTE 1: incremental de POLICIES
    // (já sabemos que este endpoint existe e funciona,
    // serve de referência para comparar o formato da resposta)
    // ==========================================

    const policiesUrl = `${apiUrl.replace(/\/$/, "")}/v1/export/listaapolices/prevoir/${encodeURIComponent(mediatorNumber)}/${date}`;

    const policiesResponse = await fetch(policiesUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${login.token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const policiesStatus = policiesResponse.status;
    const policiesBodyText = await policiesResponse.text();

    // ==========================================
    // TESTE 2: incremental de RECIBOS
    // (endpoint hipotético, a confirmar)
    // ==========================================

    const receiptsUrl = `${apiUrl.replace(/\/$/, "")}/v1/export/recibos/prevoir/${encodeURIComponent(mediatorNumber)}/${date}`;

    const receiptsResponse = await fetch(receiptsUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${login.token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const receiptsStatus = receiptsResponse.status;
    const receiptsBodyText = await receiptsResponse.text();

    return NextResponse.json({
      dateUsed: date,
      mediatorNumber,

      policiesIncremental: {
        url: policiesUrl,
        status: policiesStatus,
        ok: policiesResponse.ok,
        bodyPreview: policiesBodyText.slice(0, 1000),
        isArray: (() => {
          try {
            return Array.isArray(JSON.parse(policiesBodyText));
          } catch {
            return null;
          }
        })(),
        count: (() => {
          try {
            const parsed = JSON.parse(policiesBodyText);
            return Array.isArray(parsed) ? parsed.length : null;
          } catch {
            return null;
          }
        })(),
      },

      receiptsIncremental: {
        url: receiptsUrl,
        status: receiptsStatus,
        ok: receiptsResponse.ok,
        bodyPreview: receiptsBodyText.slice(0, 1000),
        isArray: (() => {
          try {
            return Array.isArray(JSON.parse(receiptsBodyText));
          } catch {
            return null;
          }
        })(),
        count: (() => {
          try {
            const parsed = JSON.parse(receiptsBodyText);
            return Array.isArray(parsed) ? parsed.length : null;
          } catch {
            return null;
          }
        })(),
      },
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