import { createClient } from "@/lib/supabase/server";
import ConversasBoard from "./conversas-board";

export default async function ConversasPage() {
  const supabase = await createClient();

  const { data: accounts, error: accountsError } = await supabase
    .from("whatsapp_accounts")
    .select(`
      id,
      store_id,
      phone_number,
      display_name,
      is_active,
      stores (
        id,
        name
      )
    `)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

    if (accountsError) {
        throw new Error(
            `[Conversas] ${accountsError.code ?? ""} | ${accountsError.message ?? ""} | ${accountsError.details ?? ""} | ${accountsError.hint ?? ""}`
        );
        }

  const { data: conversations, error: conversationsError } = await supabase
    .from("whatsapp_conversations")
    .select(`
      id,
      whatsapp_account_id,
      store_id,
      client_id,
      customer_phone,
      customer_name,
      status,
      unread_count,
      last_message_at,
      created_at,
      whatsapp_accounts (
        id,
        display_name,
        phone_number
      ),
      clients (
        id,
        name,
        phone
      )
    `)
    .order("last_message_at", {
      ascending: false,
      nullsFirst: false,
    });

    if (conversationsError) {
    throw new Error(
        `[Conversas] ${conversationsError.code ?? ""} | ${conversationsError.message ?? ""} | ${conversationsError.details ?? ""} | ${conversationsError.hint ?? ""}`
    );
    } 

  return (
    <ConversasBoard
      initialAccounts={accounts ?? []}
      initialConversations={conversations ?? []}
    />
  );
}