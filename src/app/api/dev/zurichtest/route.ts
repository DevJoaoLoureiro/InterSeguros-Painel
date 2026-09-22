import { splitZurichToken } from "@/lib/insurance/providers/zurich/client";
import { sanitizeZurichText } from "@/lib/insurance/providers/zurich/log-safety";

export async function GET() {
  try {
    const agenteNr = process.env.ZURICH_AGENTE_NR;
    const username = process.env.ZURICH_USERNAME;
    const password = process.env.ZURICH_PASSWORD;
    const fullToken = process.env.ZURICH_TOKEN;

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
          error:
            error instanceof Error
              ? sanitizeZurichText(error.message)
              : "Erro ao dividir token",
        },
        { status: 500 },
      );
    }

    const url = new URL(
      "https://myzurich.zurich.com.pt/ZurichServicos/rest/InfoAgente/ObterReciboPorNr",
    );

    url.searchParams.set("AgenteNr", agenteNr);
    url.searchParams.set("Token1", token1);
    url.searchParams.set("Token2", token2);

    // Número de teste.
    // Se tiveres um recibo real, podes trocar por um número real.
    url.searchParams.set("ReciboNr", "999999999999");

    const basicAuth = Buffer.from(
      `${username}:${password}`,
    ).toString("base64");

    const wrongAuth = Buffer.from(
      `${username}:PASSWORD_ERRADA_TESTE_123`,
    ).toString("base64");

    async function testar(
      nome: string,
      authorization?: string,
    ) {
      const startedAt = Date.now();

      try {
        const response = await fetch(url, {
          method: "GET",

          headers: {
            ...(authorization
              ? {
                  Authorization: authorization,
                }
              : {}),

            Accept: "application/json",

            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          },

          cache: "no-store",
        });

        const text = await response.text();

        let body: unknown;

        try {
          const json = JSON.parse(text);

          if (json && typeof json === "object") {
            const obj = json as Record<string, unknown>;

            body = {
              keys: Object.keys(obj),

              StatusCode: obj.StatusCode,

              Errors: Array.isArray(obj.Errors)
                ? obj.Errors.map((err) => {
                    if (typeof err === "string") {
                      return sanitizeZurichText(err);
                    }

                    return err;
                  })
                : obj.Errors,

              Successo: obj.Successo,
              Sucesso: obj.Sucesso,
              CodigoErro: obj.CodigoErro,

              Mensagem:
                typeof obj.Mensagem === "string"
                  ? sanitizeZurichText(obj.Mensagem)
                  : obj.Mensagem,

              Message:
                typeof obj.Message === "string"
                  ? sanitizeZurichText(obj.Message)
                  : obj.Message,

              message:
                typeof obj.message === "string"
                  ? sanitizeZurichText(obj.message)
                  : obj.message,

              temDadosRecibo: Boolean(obj.DadosRecibo),
            };
          } else {
            body = json;
          }
        } catch {
          body = {
            json: false,
            responseLength: text.length,
            preview: sanitizeZurichText(
              text.slice(0, 500),
            ),
          };
        }

        return {
          nome,

          status: response.status,
          statusText: response.statusText,

          durationMs:
            Date.now() - startedAt,

          contentType:
            response.headers.get("content-type"),

          wwwAuthenticate:
            response.headers.get("www-authenticate"),

          body,
        };
      } catch (error) {
        return {
          nome,

          networkError: true,

          durationMs:
            Date.now() - startedAt,

          error:
            error instanceof Error
              ? sanitizeZurichText(error.message)
              : "Erro de rede",
        };
      }
    }

    /*
     * TESTE 1
     * Credenciais reais
     */
    const real = await testar(
      "REAL",
      `Basic ${basicAuth}`,
    );

    /*
     * TESTE 2
     * Mesmo username + password errada
     */
    const passwordErrada = await testar(
      "PASSWORD_ERRADA",
      `Basic ${wrongAuth}`,
    );

    /*
     * TESTE 3
     * Sem Authorization
     */
    const semAuth = await testar(
      "SEM_AUTH",
    );

    return Response.json({
      success: true,

      stage: "comparison",

      env: {
        agenteNr: true,
        username: true,
        password: true,
        token: true,
        tokenLength: fullToken.length,
      },

      token: {
        splitSuccess: true,
        token1Length: token1.length,
        token2Length: token2.length,
      },

      testes: [
        real,
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
            ? sanitizeZurichText(error.message)
            : "Erro desconhecido",
      },
      { status: 500 },
    );
  }
}