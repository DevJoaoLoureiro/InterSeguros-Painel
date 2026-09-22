import { NextRequest, NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleRequest(req: NextRequest) {
  const internalSecret = req.headers.get("x-internal-secret");

  if (
    !process.env.ZURICH_OTP_INTERNAL_SECRET ||
    internalSecret !== process.env.ZURICH_OTP_INTERNAL_SECRET
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "Unauthorized",
      },
      { status: 401 }
    );
  }

  const host = process.env.ZURICH_OTP_IMAP_HOST;
  const port = Number(process.env.ZURICH_OTP_IMAP_PORT || "993");
  const user = process.env.ZURICH_OTP_EMAIL;
  const pass = process.env.ZURICH_OTP_EMAIL_PASSWORD;

  if (!host || !user || !pass) {
    return NextResponse.json(
      {
        success: false,
        error: "IMAP não configurado",
      },
      { status: 500 }
    );
  }

  const client = new ImapFlow({
    host,
    port,
    secure: true,
    auth: {
      user,
      pass,
    },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,

    // TEMPORÁRIO enquanto o certificado do servidor IMAP
    // não tiver uma cadeia de confiança correta.
    tls: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();

    const lock = await client.getMailboxLock("INBOX");

    try {
      // Procurar emails recebidos hoje.
      // Depois filtramos por Zurich e escolhemos o mais recente.
      const since = new Date();
      since.setHours(0, 0, 0, 0);

      const searchResult = await client.search(
        {
          since,
        },
        {
          uid: true,
        }
      );

      const uids: number[] = Array.isArray(searchResult)
        ? searchResult
        : [];

      if (uids.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: "Não encontrei emails recentes.",
          },
          { status: 404 }
        );
      }

      // Mais recentes primeiro.
      const recentUids = [...uids].reverse().slice(0, 30);

      for (const uid of recentUids) {
        const message = await client.fetchOne(
          uid,
          {
            source: true,
            internalDate: true,
            envelope: true,
          },
          {
            uid: true,
          }
        );

        if (!message || !message.source) {
          continue;
        }

        const parsed = await simpleParser(message.source);

        const subject = parsed.subject || "";

        const from =
          parsed.from?.value
            ?.map((item) =>
              `${item.name || ""} ${item.address || ""}`.trim()
            )
            .join(" ") || "";

        const bodyText = parsed.text || "";

        const htmlText =
          typeof parsed.html === "string"
            ? parsed.html.replace(/<[^>]+>/g, " ")
            : "";

        const fullText = `${bodyText}\n${htmlText}`
          .replace(/\s+/g, " ")
          .trim();

        // Garantir que estamos a analisar o email certo.
        const isZurichEmail =
          /Zurich Okta/i.test(from) ||
          /okta\.zurich\.com/i.test(from) ||
          /Código de verificação único/i.test(subject);

        if (!isZurichEmail) {
          continue;
        }

        // Procurar especificamente a frase usada no email Zurich.
        const specificMatch = fullText.match(
          /O link não funciona\?\s*Em vez disso,\s*insira um código:\s*(\d{6})/i
        );

        // Fallback caso o HTML/texto venha ligeiramente diferente.
        const fallbackMatch = fullText.match(
          /(?:insira um código|código)\D{0,40}(\d{6})/i
        );

        const code =
          specificMatch?.[1] ||
          fallbackMatch?.[1];

        if (!code) {
          continue;
        }

        // Só devolvemos o OTP.
        return NextResponse.json({
          success: true,
          code,
        });
      }

      return NextResponse.json(
        {
          success: false,
          error: "Não encontrei código Zurich recente.",
        },
        { status: 404 }
      );
    } finally {
      lock.release();
    }
  } catch (error: any) {
    console.error("[Zurich OTP IMAP]", {
      message: error?.message,
      code: error?.code,
      response: error?.response,
      responseStatus: error?.responseStatus,
    });

    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Erro ao consultar IMAP.",
      },
      { status: 500 }
    );
  } finally {
    if (client.usable) {
      try {
        await client.logout();
      } catch {}
    }
  }
}

export async function GET(req: NextRequest) {
  return handleRequest(req);
}

export async function POST(req: NextRequest) {
  return handleRequest(req);
}