import { splitZurichToken } from "@/lib/insurance/providers/zurich/client";
import { sanitizeZurichText } from "@/lib/insurance/providers/zurich/log-safety";

export async function GET() {
  try {
    const agenteNr = process.env.ZURICH_AGENTE_NR;
    const username = process.env.ZURICH_USERNAME;
    const password = process.env.ZURICH_PASSWORD;
    const fullToken = process.env.ZURICH_TOKEN;

    // =====================================================
    // 1. VALIDAR ENV
    // =====================================================

    if (!agenteNr || !username || !password || !fullToken) {
      return Response.json(
        {
          success: false,
          stage: "environment",

          env: {
            agenteNr: Boolean(agenteNr),
            username: Boolean(username),
            password: Boolean(password),
            token: Boolean(fullToken),
            tokenLength: fullToken?.length ?? 0,
          },
        },
        { status: 500 },
      );
    }

    // =====================================================
    // 2. VALIDAR ALGORITMO COM EXEMPLO OFICIAL DA DOCUMENTAÇÃO
    // =====================================================

    let tokenAlgorithmTest;

    try {
      const exemploDoc = splitZurichToken(
        "UOxEni1MgYv8CwquxKgSK6",
      );

      const expectedToken1 = "8OvUSYggKM";
      const expectedToken2 = "qnwECxx1ui";

      tokenAlgorithmTest = {
        token1: exemploDoc.token1,
        token2: exemploDoc.token2,

        expectedToken1,
        expectedToken2,

        ok:
          exemploDoc.token1 === expectedToken1 &&
          exemploDoc.token2 === expectedToken2,
      };
    } catch (error) {
      tokenAlgorithmTest = {
        ok: false,

        error:
          error instanceof Error
            ? sanitizeZurichText(error.message)
            : "Erro no teste do algoritmo",
      };
    }

    // =====================================================
    // 3. DIVIDIR TOKEN REAL
    // =====================================================

    let token1: string;
    let token2: string;

    try {
      const parts = splitZurichToken(fullToken);

      token1 = parts.token1;
      token2 = parts.token2;
    } catch (error) {
      return Response.json(
        {
          success: false,
          stage: "token_split",

          tokenAlgorithmTest,

          error:
            error instanceof Error
              ? sanitizeZurichText(error.message)
              : "Erro ao dividir token",
        },
        { status: 500 },
      );
    }

    // =====================================================
    // 4. URL COMPLETO
    // =====================================================

    const urlCompleto = new URL(
      "https://myzurich.zurich.com.pt/ZurichServicos/rest/InfoAgente/ObterReciboPorNr",
    );

    urlCompleto.searchParams.set(
      "AgenteNr",
      agenteNr,
    );

    urlCompleto.searchParams.set(
      "Token1",
      token1,
    );

    urlCompleto.searchParams.set(
      "Token2",
      token2,
    );

    urlCompleto.searchParams.set(
      "ReciboNr",
      "999999999999",
    );

    // =====================================================
    // 5. URL SEM TOKEN
    // =====================================================

    const urlSemToken = new URL(
      "https://myzurich.zurich.com.pt/ZurichServicos/rest/InfoAgente/ObterReciboPorNr",
    );

    urlSemToken.searchParams.set(
      "AgenteNr",
      agenteNr,
    );

    urlSemToken.searchParams.set(
      "ReciboNr",
      "999999999999",
    );

    // =====================================================
    // 6. URL SEM AGENTE
    // =====================================================

    const urlSemAgente = new URL(
      "https://myzurich.zurich.com.pt/ZurichServicos/rest/InfoAgente/ObterReciboPorNr",
    );

    urlSemAgente.searchParams.set(
      "Token1",
      token1,
    );

    urlSemAgente.searchParams.set(
      "Token2",
      token2,
    );

    urlSemAgente.searchParams.set(
      "ReciboNr",
      "999999999999",
    );

    // =====================================================
    // 7. BASIC AUTH
    // =====================================================

    const basicAuth = Buffer.from(
      `${username}:${password}`,
    ).toString("base64");

    const wrongAuth = Buffer.from(
      `${username}:PASSWORD_ERRADA_TESTE_123`,
    ).toString("base64");

    // =====================================================
    // 8. FUNÇÃO DE TESTE
    // =====================================================

    async function testar(
      nome: string,
      testUrl: URL,
      authorization?: string,
    ) {
      const startedAt = Date.now();

      try {
        const response = await fetch(testUrl, {
          method: "GET",

          headers: {
            ...(authorization
              ? {
                  Authorization: authorization,
                }
              : {}),

            Accept: "application/json",

            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
          },

          cache: "no-store",
        });

        const text = await response.text();

        let body: unknown;

        try {
          const json = JSON.parse(text);

          if (
            json &&
            typeof json === "object"
          ) {
            const obj =
              json as Record<string, unknown>;

            body = {
              keys: Object.keys(obj),

              StatusCode:
                obj.StatusCode,

              Errors:
                Array.isArray(obj.Errors)
                  ? obj.Errors.map(
                      (err) => {
                        if (
                          typeof err ===
                          "string"
                        ) {
                          return sanitizeZurichText(
                            err,
                          );
                        }

                        return err;
                      },
                    )
                  : obj.Errors,

              Successo:
                obj.Successo,

              Sucesso:
                obj.Sucesso,

              CodigoErro:
                obj.CodigoErro,

              Mensagem:
                typeof obj.Mensagem ===
                "string"
                  ? sanitizeZurichText(
                      obj.Mensagem,
                    )
                  : obj.Mensagem,

              Message:
                typeof obj.Message ===
                "string"
                  ? sanitizeZurichText(
                      obj.Message,
                    )
                  : obj.Message,

              message:
                typeof obj.message ===
                "string"
                  ? sanitizeZurichText(
                      obj.message,
                    )
                  : obj.message,

              temDadosRecibo:
                Boolean(
                  obj.DadosRecibo,
                ),
            };
          } else {
            body = json;
          }
        } catch {
          body = {
            json: false,

            responseLength:
              text.length,

            preview:
              sanitizeZurichText(
                text.slice(0, 500),
              ),
          };
        }

        return {
          nome,

          status:
            response.status,

          statusText:
            response.statusText,

          durationMs:
            Date.now() -
            startedAt,

          contentType:
            response.headers.get(
              "content-type",
            ),

          wwwAuthenticate:
            response.headers.get(
              "www-authenticate",
            ),

          body,
        };
      } catch (error) {
        return {
          nome,

          networkError: true,

          durationMs:
            Date.now() -
            startedAt,

          error:
            error instanceof Error
              ? sanitizeZurichText(
                  error.message,
                )
              : "Erro de rede",
        };
      }
    }

    // =====================================================
    // 9. EXECUTAR TESTES
    // =====================================================

    const realCompleto =
      await testar(
        "REAL_COMPLETO",
        urlCompleto,
        `Basic ${basicAuth}`,
      );

    const realSemToken =
      await testar(
        "REAL_SEM_TOKEN",
        urlSemToken,
        `Basic ${basicAuth}`,
      );

    const realSemAgente =
      await testar(
        "REAL_SEM_AGENTE",
        urlSemAgente,
        `Basic ${basicAuth}`,
      );

    const passwordErrada =
      await testar(
        "PASSWORD_ERRADA",
        urlCompleto,
        `Basic ${wrongAuth}`,
      );

    const semAuth =
      await testar(
        "SEM_AUTH",
        urlCompleto,
      );

    // =====================================================
    // 10. RESULTADO
    // =====================================================

    return Response.json({
      success: true,

      stage: "comparison",

      env: {
        agenteNr: true,
        username: true,
        password: true,
        token: true,
        tokenLength:
          fullToken.length,
      },

      tokenAlgorithmTest,

      token: {
        splitSuccess: true,
        token1Length:
          token1.length,
        token2Length:
          token2.length,
      },

      testes: [
        realCompleto,
        realSemToken,
        realSemAgente,
        passwordErrada,
        semAuth,
      ],
    });
  } catch (error) {
    return Response.json(
      {
        success: false,

        stage: "unexpected",

        error:
          error instanceof Error
            ? sanitizeZurichText(
                error.message,
              )
            : "Erro desconhecido",
      },
      { status: 500 },
    );
  }
}