import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendWhatsAppText } from "@/lib/whatsapp/client";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { conversationId, text } = await request.json();

    if (
      !conversationId ||
      typeof text !== "string" ||
      !text.trim()
    ) {
      return NextResponse.json(
        { error: "conversationId e text são obrigatórios." },
        { status: 400 }
      );
    }

    const { data: conversation, error } = await supabase
      .from("whatsapp_conversations")
      .select(`
        id,
        customer_phone,
        whatsapp_account_id,
        whatsapp_accounts (
          id,
          phone_number_id,
          is_active
        )
      `)
      .eq("id", conversationId)
      .single();

    if (error || !conversation) {
      return NextResponse.json(
        { error: "Conversa não encontrada." },
        { status: 404 }
      );
    }

    const accountRaw = conversation.whatsapp_accounts;
    const account = Array.isArray(accountRaw)
      ? accountRaw[0]
      : accountRaw;

    if (!account?.is_active || !account?.phone_number_id) {
      return NextResponse.json(
        { error: "WhatsApp deste escritório não está configurado." },
        { status: 400 }
      );
    }

    const result = await sendWhatsAppText({
      phoneNumberId: account.phone_number_id,
      to: conversation.customer_phone,
      text: text.trim(),
    });

    const externalMessageId =
      result?.messages?.[0]?.id ?? null;

    const { data: message, error: messageError } =
      await supabase
        .from("whatsapp_messages")
        .insert({
          conversation_id: conversation.id,
          whatsapp_account_id:
            conversation.whatsapp_account_id,
          external_message_id: externalMessageId,
          direction: "OUTBOUND",
          message_type: "TEXT",
          body: text.trim(),
          status: "SENT",
          sent_at: new Date().toISOString(),
          raw_payload: result,
        })
        .select()
        .single();

    if (messageError) {
      console.error(
        "[WhatsApp] Mensagem enviada mas não guardada:",
        messageError
      );
    }

    await supabase
      .from("whatsapp_conversations")
      .update({
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversation.id);

    return NextResponse.json({
      success: true,
      message,
    });
  } catch (error) {
    console.error("[WhatsApp] Send error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erro ao enviar mensagem.",
      },
      { status: 500 }
    );
  }
}