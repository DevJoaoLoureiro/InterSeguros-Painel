import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalizePhone(phone?: string | null) {
  if (!phone) return null;
  return phone.replace(/[^\d]/g, "");
}

function toIsoTimestamp(timestamp?: string | number | null) {
  if (!timestamp) return new Date().toISOString();

  const numeric = Number(timestamp);

  if (!Number.isFinite(numeric)) {
    return new Date().toISOString();
  }

  return new Date(numeric * 1000).toISOString();
}

function verifyMetaSignature(rawBody: string, signatureHeader: string | null) {
  const appSecret = process.env.META_APP_SECRET;

  if (!appSecret) {
    console.error("[WhatsApp] META_APP_SECRET em falta");
    return false;
  }

  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const expectedSignature = `sha256=${crypto
    .createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex")}`;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(signatureHeader)
    );
  } catch {
    return false;
  }
}

function extractMessageContent(message: any) {
  let body: string | null = null;
  let mediaId: string | null = null;

  switch (message?.type) {
    case "text":
      body = message?.text?.body ?? null;
      break;

    case "image":
      body = message?.image?.caption ?? null;
      mediaId = message?.image?.id ?? null;
      break;

    case "document":
      body =
        message?.document?.caption ??
        message?.document?.filename ??
        null;

      mediaId = message?.document?.id ?? null;
      break;

    case "audio":
      mediaId = message?.audio?.id ?? null;
      break;

    case "video":
      body = message?.video?.caption ?? null;
      mediaId = message?.video?.id ?? null;
      break;

    case "sticker":
      mediaId = message?.sticker?.id ?? null;
      break;

    case "location":
      body = JSON.stringify(message?.location ?? {});
      break;

    case "contacts":
      body = JSON.stringify(message?.contacts ?? []);
      break;

    case "reaction":
      body = message?.reaction?.emoji ?? null;
      break;

    case "button":
      body = message?.button?.text ?? null;
      break;

    case "interactive":
      body =
        message?.interactive?.button_reply?.title ??
        message?.interactive?.list_reply?.title ??
        null;
      break;

    default:
      body = null;
      break;
  }

  return {
    body,
    mediaId,
    messageType: String(message?.type ?? "unknown").toUpperCase(),
  };
}

async function findWhatsappAccount(params: {
  phoneNumberId?: string | null;
  wabaId?: string | null;
}) {
  const { phoneNumberId, wabaId } = params;

  if (phoneNumberId) {
    const { data, error } = await supabase
      .from("whatsapp_accounts")
      .select("id, store_id, phone_number_id, waba_id")
      .eq("phone_number_id", phoneNumberId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      console.error(
        "[WhatsApp] Erro ao procurar conta por phone_number_id:",
        error
      );

      return null;
    }

    if (data) return data;
  }

  if (wabaId) {
    const { data, error } = await supabase
      .from("whatsapp_accounts")
      .select("id, store_id, phone_number_id, waba_id")
      .eq("waba_id", wabaId)
      .eq("is_active", true);

    if (error) {
      console.error(
        "[WhatsApp] Erro ao procurar conta por WABA:",
        error
      );

      return null;
    }

    if (data?.length === 1) {
      return data[0];
    }

    if ((data?.length ?? 0) > 1) {
      console.warn(
        `[WhatsApp] WABA ${wabaId} tem vários números. Não é seguro escolher uma conta sem phone_number_id.`
      );
    }
  }

  return null;
}

async function findClientId(customerPhone: string) {
  const phoneSuffix = customerPhone.slice(-9);

  const { data, error } = await supabase
    .from("clients")
    .select("id, phone")
    .ilike("phone", `%${phoneSuffix}%`)
    .limit(1);

  if (error) {
    console.error(
      "[WhatsApp] Erro ao procurar cliente pelo telefone:",
      error
    );

    return null;
  }

  return data?.[0]?.id ?? null;
}

async function getOrCreateConversation(params: {
  whatsappAccount: {
    id: string;
    store_id: string;
  };
  customerPhone: string;
  customerName?: string | null;
  messageTimestamp?: string | null;
  incrementUnread?: boolean;
}) {
  const {
    whatsappAccount,
    customerPhone,
    customerName = null,
    messageTimestamp,
    incrementUnread = false,
  } = params;

  const { data: existingConversation, error: existingError } =
    await supabase
      .from("whatsapp_conversations")
      .select("id, unread_count, client_id, customer_name, last_message_at")
      .eq("whatsapp_account_id", whatsappAccount.id)
      .eq("customer_phone", customerPhone)
      .maybeSingle();

  if (existingError) {
    console.error(
      "[WhatsApp] Erro ao procurar conversa:",
      existingError
    );

    return null;
  }

  const timestamp = messageTimestamp
    ? toIsoTimestamp(messageTimestamp)
    : new Date().toISOString();

  if (existingConversation) {
    const update: Record<string, unknown> = {
      status: "OPEN",
      updated_at: new Date().toISOString(),
    };

    if (customerName) {
      update.customer_name = customerName;
    }

    if (
      !existingConversation.last_message_at ||
      new Date(timestamp) >
        new Date(existingConversation.last_message_at)
    ) {
      update.last_message_at = timestamp;
    }

    if (incrementUnread) {
      update.unread_count =
        (existingConversation.unread_count ?? 0) + 1;
    }

    await supabase
      .from("whatsapp_conversations")
      .update(update)
      .eq("id", existingConversation.id);

    return existingConversation.id;
  }

  const clientId = await findClientId(customerPhone);

  const { data: newConversation, error } = await supabase
    .from("whatsapp_conversations")
    .insert({
      whatsapp_account_id: whatsappAccount.id,
      store_id: whatsappAccount.store_id,
      client_id: clientId,
      customer_phone: customerPhone,
      customer_name: customerName,
      status: "OPEN",
      unread_count: incrementUnread ? 1 : 0,
      last_message_at: timestamp,
    })
    .select("id")
    .single();

  if (error || !newConversation) {
    console.error(
      "[WhatsApp] Erro ao criar conversa:",
      error
    );

    return null;
  }

  return newConversation.id;
}

async function saveMessage(params: {
  whatsappAccount: {
    id: string;
    store_id: string;
  };
  customerPhone: string;
  customerName?: string | null;
  message: any;
  direction: "INBOUND" | "OUTBOUND";
  incrementUnread?: boolean;
}) {
  const {
    whatsappAccount,
    customerPhone,
    customerName,
    message,
    direction,
    incrementUnread = false,
  } = params;

  const conversationId = await getOrCreateConversation({
    whatsappAccount,
    customerPhone,
    customerName,
    messageTimestamp: message?.timestamp ?? null,
    incrementUnread,
  });

  if (!conversationId) return;

  const { body, mediaId, messageType } =
    extractMessageContent(message);

  const { error } = await supabase
    .from("whatsapp_messages")
    .upsert(
      {
        conversation_id: conversationId,
        whatsapp_account_id: whatsappAccount.id,
        external_message_id: message?.id ?? null,
        direction,
        message_type: messageType,
        body,
        media_id: mediaId,
        sent_at: toIsoTimestamp(message?.timestamp),
        raw_payload: message,
      },
      {
        onConflict: "external_message_id",
        ignoreDuplicates: true,
      }
    );

  if (error) {
    console.error(
      "[WhatsApp] Erro ao guardar mensagem:",
      error
    );
  }
}

async function processNormalMessages(
  value: any,
  wabaId: string | null
) {
  const phoneNumberId = value?.metadata?.phone_number_id ?? null;

  const whatsappAccount = await findWhatsappAccount({
    phoneNumberId,
    wabaId,
  });

  if (!whatsappAccount) {
    console.warn(
      "[WhatsApp] Conta não encontrada para evento messages",
      {
        phoneNumberId,
        wabaId,
      }
    );

    return;
  }

  const contacts = value?.contacts ?? [];
  const messages = value?.messages ?? [];
  const statuses = value?.statuses ?? [];

  for (const message of messages) {
    const customerPhone = normalizePhone(message?.from);

    if (!customerPhone) continue;

    const contact = contacts.find(
      (item: any) =>
        normalizePhone(item?.wa_id) === customerPhone
    );

    const customerName =
      contact?.profile?.name ?? null;

    await saveMessage({
      whatsappAccount,
      customerPhone,
      customerName,
      message,
      direction: "INBOUND",
      incrementUnread: true,
    });
  }

  for (const status of statuses) {
    const externalMessageId = status?.id;

    if (!externalMessageId) continue;

    const timestamp = toIsoTimestamp(status?.timestamp);

    const update: Record<string, unknown> = {};

    switch (status?.status) {
      case "sent":
        update.status = "SENT";
        update.sent_at = timestamp;
        break;

      case "delivered":
        update.status = "DELIVERED";
        update.delivered_at = timestamp;
        break;

      case "read":
        update.status = "READ";
        update.read_at = timestamp;
        break;

      case "failed":
        update.status = "FAILED";
        break;

      default:
        continue;
    }

    const { error } = await supabase
      .from("whatsapp_messages")
      .update(update)
      .eq("external_message_id", externalMessageId);

    if (error) {
      console.error(
        "[WhatsApp] Erro ao atualizar estado:",
        error
      );
    }
  }
}

async function processHistory(
  value: any,
  wabaId: string | null
) {
  const phoneNumberId = value?.metadata?.phone_number_id ?? null;

  const whatsappAccount = await findWhatsappAccount({
    phoneNumberId,
    wabaId,
  });

  if (!whatsappAccount) {
    console.warn(
      "[WhatsApp] Histórico recebido mas não foi possível determinar o número.",
      {
        phoneNumberId,
        wabaId,
      }
    );

    return;
  }

  const historyChunks = value?.history ?? [];

  for (const historyChunk of historyChunks) {
    const metadata = historyChunk?.metadata;

    console.log("[WhatsApp] History progress:", {
      phase: metadata?.phase,
      chunkOrder: metadata?.chunk_order,
      progress: metadata?.progress,
    });

    const threads = historyChunk?.threads ?? [];

    for (const thread of threads) {
      const customerPhone = normalizePhone(
        thread?.context?.wa_id ??
          thread?.id ??
          null
      );

      if (!customerPhone) continue;

      const customerName =
        thread?.context?.username ?? null;

      const messages = thread?.messages ?? [];

      for (const message of messages) {
        const fromMe =
          message?.history_context?.from_me === true;

        await saveMessage({
          whatsappAccount,
          customerPhone,
          customerName,
          message,
          direction: fromMe
            ? "OUTBOUND"
            : "INBOUND",

          // Histórico antigo NÃO deve aparecer como não lido.
          incrementUnread: false,
        });
      }
    }
  }
}

async function processSmbMessageEchoes(
  value: any,
  wabaId: string | null
) {
  const phoneNumberId = value?.metadata?.phone_number_id ?? null;

  const whatsappAccount = await findWhatsappAccount({
    phoneNumberId,
    wabaId,
  });

  if (!whatsappAccount) {
    console.warn(
      "[WhatsApp] Echo recebido mas conta não encontrada",
      {
        phoneNumberId,
        wabaId,
      }
    );

    return;
  }

  const echoes =
    value?.messages ??
    value?.message_echoes ??
    value?.smb_message_echoes ??
    [];

  for (const message of echoes) {
    const customerPhone = normalizePhone(
      message?.to ??
        message?.recipient ??
        message?.wa_id ??
        null
    );

    if (!customerPhone) {
      console.warn(
        "[WhatsApp] Não foi possível determinar destinatário do echo:",
        message?.id
      );

      continue;
    }

    await saveMessage({
      whatsappAccount,
      customerPhone,
      message,
      direction: "OUTBOUND",
      incrementUnread: false,
    });
  }
}

async function processSmbAppStateSync(
  value: any,
  wabaId: string | null
) {
  console.log("[WhatsApp] smb_app_state_sync recebido", {
    wabaId,
    value,
  });

  /*
   * Por agora apenas registamos o evento.
   *
   * Depois podemos usar este webhook para sincronizar:
   * - contactos
   * - alterações do WhatsApp Business App
   * - outros estados enviados pela Meta
   *
   * Não inserimos nada automaticamente na BD até vermos
   * a estrutura real que a Meta envia para este número.
   */
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (
    mode === "subscribe" &&
    token &&
    token === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return new NextResponse(challenge ?? "", {
      status: 200,
    });
  }

  return NextResponse.json(
    {
      error: "Webhook verification failed",
    },
    {
      status: 403,
    }
  );
}

export async function POST(request: NextRequest) {
  try {
    /*
     * IMPORTANTE:
     * precisamos do body original para validar a assinatura.
     * Por isso usamos request.text() antes do JSON.parse().
     */
    const rawBody = await request.text();

    const signature =
      request.headers.get("x-hub-signature-256");

    if (!verifyMetaSignature(rawBody, signature)) {
      console.warn(
        "[WhatsApp] Webhook rejeitado: assinatura Meta inválida."
      );

      return NextResponse.json(
        {
          received: false,
          error: "Invalid signature",
        },
        {
          status: 401,
        }
      );
    }

    const payload = JSON.parse(rawBody);

    const entries = payload?.entry ?? [];

    for (const entry of entries) {
      /*
       * Nos webhooks do objeto whatsapp_business_account,
       * entry.id normalmente identifica a WABA.
       *
       * Serve como fallback nos eventos que não tragam
       * metadata.phone_number_id.
       */
      const wabaId = entry?.id
        ? String(entry.id)
        : null;

      const changes = entry?.changes ?? [];

      for (const change of changes) {
        const field = change?.field;
        const value = change?.value;

        switch (field) {
          case "messages":
            await processNormalMessages(
              value,
              wabaId
            );
            break;

          case "history":
            await processHistory(
              value,
              wabaId
            );
            break;

          case "smb_message_echoes":
            await processSmbMessageEchoes(
              value,
              wabaId
            );
            break;

          case "smb_app_state_sync":
            await processSmbAppStateSync(
              value,
              wabaId
            );
            break;

          default:
            console.log(
              `[WhatsApp] Webhook ignorado: ${field}`
            );

            break;
        }
      }
    }

    return NextResponse.json({
      received: true,
    });
  } catch (error) {
    console.error(
      "[WhatsApp] Webhook error:",
      error
    );

    return NextResponse.json(
      {
        received: false,
      },
      {
        status: 500,
      }
    );
  }
}