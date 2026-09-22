import https from "node:https";

import {
  getZurichAccounts,
  splitZurichToken,
  type ZurichAccount,
} from "@/lib/insurance/providers/zurich/client";

export const dynamic = "force-dynamic";

type ZurichOp =
  | "file"
  | "receipts"
  | "objects"
  | "coverages"
  | "policy"
  | "client";

const TIMEOUT_MS = 15_000;

function getBaseUrl() {
  const environment =
    (process.env.ZURICH_ENV ?? "uat").toLowerCase();

  if (environment === "prod") {
    return {
      environment,
      consultas:
        "https://myzurich.zurich.com.pt/ZurichServicos/rest/InfoAgente/",
    };
  }

  return {
    environment,
    consultas:
      "https://uat-myzurich-pt.zurich.com/ZurichServicos/rest/InfoAgente/",
  };
}

function resolveAccount(
  requestedKey?: string | null,
): ZurichAccount {
  const accounts = getZurichAccounts();

  if (requestedKey) {
    const selected = accounts.find(
      (account) => account.key === requestedKey,
    );

    if (!selected) {
      throw new Error(
        `Conta Zurich "${requestedKey}" não encontrada.`,
      );
    }

    return selected;
  }

  return (
    accounts.find(
      (account) => account.key === "default",
    ) ?? accounts[0]
  );
}

function buildRequestUrl(params: {
  baseUrl: string;
  path: string;
  account: ZurichAccount;
  extraParams: Record<
    string,
    string | number | undefined
  >;
}) {
  const {
    baseUrl,
    path,
    account,
    extraParams,
  } = params;

  const { token1, token2 } =
    splitZurichToken(account.token);

  const url = new URL(
    path,
    baseUrl.endsWith("/")
      ? baseUrl
      : `${baseUrl}/`,
  );

  url.searchParams.set(
    "AgenteNr",
    account.agenteNr,
  );

  url.searchParams.set(
    "Token1",
    token1,
  );

  url.searchParams.set(
    "Token2",
    token2,
  );

  for (
    const [key, value]
    of Object.entries(extraParams)
  ) {
    if (
      value !== undefined &&
      value !== ""
    ) {
      url.searchParams.set(
        key,
        String(value),
      );
    }
  }

  return url;
}

function getBasicAuth(
  account: ZurichAccount,
) {
  const encoded = Buffer.from(
    `${account.username}:${account.password}`,
  ).toString("base64");

  return `Basic ${encoded}`;
}

function summarizeBody(
  body: string,
) {
  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body);
  } catch {
    // Não devolver respostas gigantes.
    return body.slice(0, 2000);
  }
}

async function testWithFetch(params: {
  url: URL;
  account: ZurichAccount;
}) {
  const {
    url,
    account,
  } = params;

  const startedAt = Date.now();

  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    TIMEOUT_MS,
  );

  try {
    const response = await fetch(
      url,
      {
        method: "GET",

        headers: {
          Authorization:
            getBasicAuth(account),

          Accept:
            "application/json",

          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },

        cache: "no-store",

        signal:
          controller.signal,
      },
    );

    const body =
      await response.text();

    return {
      ok: response.ok,

      elapsedMs:
        Date.now() - startedAt,

      status:
        response.status,

      bodySummary:
        summarizeBody(body),
    };
  } catch (error) {
    return {
      ok: false,

      elapsedMs:
        Date.now() - startedAt,

      status: null,

      error:
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function testWithHttpsRequest(
  params: {
    url: URL;
    account: ZurichAccount;
  },
) {
  const {
    url,
    account,
  } = params;

  const startedAt = Date.now();

  return new Promise(
    (resolve) => {
      const request =
        https.request(
          {
            protocol:
              url.protocol,

            hostname:
              url.hostname,

            port:
              url.port || 443,

            path:
              `${url.pathname}${url.search}`,

            method:
              "GET",

            headers: {
              Authorization:
                getBasicAuth(account),

              Accept:
                "application/json",

              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            },
          },

          (response) => {
            let body = "";

            const remoteAddress =
              response.socket
                ?.remoteAddress ??
              null;

            const remoteFamily =
              response.socket
                ?.remoteFamily ??
              null;

            response.setEncoding(
              "utf8",
            );

            response.on(
              "data",
              (chunk) => {
                body += chunk;
              },
            );

            response.on(
              "end",
              () => {
                const status =
                  response.statusCode ??
                  null;

                resolve({
                  ok:
                    status !== null &&
                    status >= 200 &&
                    status < 300,

                  elapsedMs:
                    Date.now() -
                    startedAt,

                  status,

                  bodySummary:
                    summarizeBody(
                      body,
                    ),

                  remoteAddress,

                  remoteFamily,
                });
              },
            );
          },
        );

      request.setTimeout(
        TIMEOUT_MS,
        () => {
          request.destroy(
            new Error(
              `Timeout após ${TIMEOUT_MS}ms`,
            ),
          );
        },
      );

      request.on(
        "error",
        (error) => {
          resolve({
            ok: false,

            elapsedMs:
              Date.now() -
              startedAt,

            status: null,

            error:
              `${error.name}: ${error.message}`,

            remoteAddress:
              null,

            remoteFamily:
              null,
          });
        },
      );

      request.end();
    },
  );
}

export async function GET(
  request: Request,
) {
  /*
   * Rota exclusivamente de diagnóstico.
   * Não gera token.
   * Não escreve na BD.
   * Não altera client.ts.
   */

  if (
    process.env.NODE_ENV ===
    "production"
  ) {
    return Response.json(
      {
        success: false,
        error: "Not found",
      },
      {
        status: 404,
      },
    );
  }

  try {
    const {
      searchParams,
    } = new URL(
      request.url,
    );

    const op =
      searchParams.get(
        "op",
      ) as ZurichOp | null;

    const allowedOps:
      ZurichOp[] = [
        "file",
        "receipts",
        "objects",
        "coverages",
        "policy",
        "client",
      ];

    if (
      !op ||
      !allowedOps.includes(op)
    ) {
      return Response.json(
        {
          success: false,

          error:
            `op must be one of: ${allowedOps.join(", ")}`,
        },
        {
          status: 400,
        },
      );
    }

    const account =
      resolveAccount(
        searchParams.get(
          "account",
        ),
      );

    let path = "";

    let extraParams:
      Record<
        string,
        string | number | undefined
      > = {};

    // ======================================
    // FICHEIRO GENÉRICO
    // ======================================

    if (op === "file") {
      const date =
        searchParams.get(
          "date",
        );

      const tipo =
        searchParams.get(
          "tipo",
        ) ?? "1";

      if (!date) {
        return Response.json(
          {
            success: false,
            error:
              "Falta ?date=AAAA-MM-DD",
          },
          {
            status: 400,
          },
        );
      }

      path =
        "ObterFicheiroDia";

      extraParams = {
        TipoFicheiro:
          Number(tipo),

        Data:
          date,
      };
    }

    // ======================================
    // RECIBOS
    // TipoFicheiro 2
    // ======================================

    if (
      op === "receipts"
    ) {
      const date =
        searchParams.get(
          "date",
        );

      if (!date) {
        return Response.json(
          {
            success: false,
            error:
              "Falta ?date=AAAA-MM-DD",
          },
          {
            status: 400,
          },
        );
      }

      path =
        "ObterFicheiroDia";

      extraParams = {
        TipoFicheiro: 2,

        Data:
          date,
      };
    }

    // ======================================
    // OBJETOS
    // ======================================

    if (
      op === "objects"
    ) {
      const apolice =
        searchParams.get(
          "apolice",
        );

      if (!apolice) {
        return Response.json(
          {
            success: false,
            error:
              "Falta ?apolice=",
          },
          {
            status: 400,
          },
        );
      }

      path =
        "ObterObjetosPorNrApolice";

      extraParams = {
        ApoliceNr:
          apolice,
      };
    }

    // ======================================
    // COBERTURAS
    // ======================================

    if (
      op === "coverages"
    ) {
      const apolice =
        searchParams.get(
          "apolice",
        );

      if (!apolice) {
        return Response.json(
          {
            success: false,
            error:
              "Falta ?apolice=",
          },
          {
            status: 400,
          },
        );
      }

      path =
        "ObterCoberturasPorApolice";

      extraParams = {
        ApoliceNr:
          apolice,
      };
    }

    // ======================================
    // APÓLICE INDIVIDUAL
    // ======================================

    if (
      op === "policy"
    ) {
      const apolice =
        searchParams.get(
          "apolice",
        );

      if (!apolice) {
        return Response.json(
          {
            success: false,
            error:
              "Falta ?apolice=",
          },
          {
            status: 400,
          },
        );
      }

      path =
        "ObterApolicePorNr";

      extraParams = {
        ApoliceNr:
          apolice,
      };
    }

    // ======================================
    // CLIENTE
    // ======================================

    if (
      op === "client"
    ) {
      const nif =
        searchParams.get(
          "nif",
        );

      const clienteId =
        searchParams.get(
          "clienteId",
        );

      if (
        !nif &&
        !clienteId
      ) {
        return Response.json(
          {
            success: false,

            error:
              "Usa ?nif= ou ?clienteId=",
          },
          {
            status: 400,
          },
        );
      }

      path =
        "ObterClientePorIDNIF";

      extraParams = {
        ClienteNIF:
          nif ?? undefined,

        ClienteID:
          clienteId ??
          undefined,
      };
    }

    const {
      environment,
      consultas,
    } = getBaseUrl();

    const url =
      buildRequestUrl({
        baseUrl:
          consultas,

        path,

        account,

        extraParams,
      });

    /*
     * IMPORTANTE:
     * nunca devolver/logar `url.toString()`,
     * porque contém Token1/Token2.
     */

    const [
      fetchResult,
      httpsResult,
    ] =
      await Promise.all([
        testWithFetch({
          url,
          account,
        }),

        testWithHttpsRequest({
          url,
          account,
        }),
      ]);

    return Response.json({
      success: true,

      diagnostic: {
        operation:
          op,

        zurichOperation:
          path,

        environment,

        accountKey:
          account.key,

        agenteNr:
          account.agenteNr,

        nodeVersion:
          process.version,

        globalFetch:
          typeof fetch ===
          "function",

        hostname:
          url.hostname,

        timeoutMs:
          TIMEOUT_MS,
      },

      fetch:
        fetchResult,

      httpsRequest:
        httpsResult,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      {
        status: 500,
      },
    );
  }
}