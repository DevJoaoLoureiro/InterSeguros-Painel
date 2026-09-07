import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalizePhone(phone?: string | null) {
  if (!phone) return null;

  return phone.replace(/[^\d]/g, "");
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
    { error: "Webhook verification failed" },
    { status: 403 }
  );
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();

    const entries = payload?.entry ?? [];

    for (const entry of entries) {
      const changes = entry?.changes ?? [];

      for (const change of changes) {
        if (change?.field !== "messages") continue;

        const value = change?.value;

        const phoneNumberId = value?.metadata?.phone_number_id;

        if (!phoneNumberId) continue;

        const { data: whatsappAccount, error: accountError } =
          await supabase
            .from("whatsapp_accounts")
            .select("id, store_id")
            .eq("phone_number_id", phoneNumberId)
            .eq("is_active", true)
            .maybeSingle();

        if (accountError) {
          console.error(
            "[WhatsApp] Error fetching account:",
            accountError
          );
          continue;
        }

        if (!whatsappAccount) {
          console.warn(
            `[WhatsApp] Unknown phone_number_id: ${phoneNumberId}`
          );
          continue;
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

            default:
              body = null;
              break;
          }

          const { data: existingConversation } = await supabase
            .from("whatsapp_conversations")
            .select("id, unread_count, client_id")
            .eq(
              "whatsapp_account_id",
              whatsappAccount.id
            )
            .eq("customer_phone", customerPhone)
            .maybeSingle();

          let conversationId: string;

          if (existingConversation) {
            conversationId = existingConversation.id;

            await supabase
              .from("whatsapp_conversations")
              .update({
                customer_name: customerName,
                status: "OPEN",
                unread_count:
                  (existingConversation.unread_count ?? 0) + 1,
                last_message_at: new Date(
                  Number(message.timestamp) * 1000
                ).toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("id", conversationId);
          } else {
            let clientId: string | null = null;

            const phoneSuffix = customerPhone.slice(-9);

                const { data: clients, error: clientError } = await supabase
                .from("clients")
                .select("id, name, phone")
                .ilike("phone", `%${phoneSuffix}%`)
                .limit(1);

                if (clientError) {
                console.error(
                    "[WhatsApp] Erro ao procurar cliente pelo telefone:",
                    clientError
                );
                }

                if (clients?.length) {
                clientId = clients[0].id;
                }

         

            const { data: newConversation, error: conversationError } =
              await supabase
                .from("whatsapp_conversations")
                .insert({
                  whatsapp_account_id: whatsappAccount.id,
                  store_id: whatsappAccount.store_id,
                  client_id: clientId,
                  customer_phone: customerPhone,
                  customer_name: customerName,
                  status: "OPEN",
                  unread_count: 1,
                  last_message_at: new Date(
                    Number(message.timestamp) * 1000
                  ).toISOString(),
                })
                .select("id")
                .single();

            if (conversationError || !newConversation) {
              console.error(
                "[WhatsApp] Error creating conversation:",
                conversationError
              );

              continue;
            }

            conversationId = newConversation.id;
          }

          const sentAt = message?.timestamp
            ? new Date(
                Number(message.timestamp) * 1000
              ).toISOString()
            : new Date().toISOString();

          const { error: messageError } = await supabase
            .from("whatsapp_messages")
            .upsert(
              {
                conversation_id: conversationId,
                whatsapp_account_id: whatsappAccount.id,
                external_message_id: message?.id ?? null,
                direction: "INBOUND",
                message_type: String(
                  message?.type ?? "unknown"
                ).toUpperCase(),
                body,
                media_id: mediaId,
                sent_at: sentAt,
                raw_payload: message,
              },
              {
                onConflict: "external_message_id",
                ignoreDuplicates: true,
              }
            );

          if (messageError) {
            console.error(
              "[WhatsApp] Error saving message:",
              messageError
            );
          }
        }

        for (const status of statuses) {
          const externalMessageId = status?.id;

          if (!externalMessageId) continue;

          const timestamp = status?.timestamp
            ? new Date(
                Number(status.timestamp) * 1000
              ).toISOString()
            : new Date().toISOString();

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

          await supabase
            .from("whatsapp_messages")
            .update(update)
            .eq(
              "external_message_id",
              externalMessageId
            );
        }
      }
    }

    return NextResponse.json({
      received: true,
    });
  } catch (error) {
    console.error("[WhatsApp] Webhook error:", error);

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