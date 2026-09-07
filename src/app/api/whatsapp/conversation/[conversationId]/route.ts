import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{
      conversationId: string;
    }>;
  }
) {
  const { conversationId } = await context.params;

  const supabase = await createClient();

  const { data: messages, error } = await supabase
    .from("whatsapp_messages")
    .select(`
      id,
      conversation_id,
      direction,
      message_type,
      body,
      status,
      sent_at,
      created_at
    `)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[WhatsApp] Erro ao carregar mensagens:", error);

    return NextResponse.json(
      { error: "Erro ao carregar mensagens." },
      { status: 500 }
    );
  }

  await supabase
    .from("whatsapp_conversations")
    .update({
      unread_count: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId);

  return NextResponse.json({
    messages: messages ?? [],
  });
}