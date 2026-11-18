"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { hasFullAccess } from "@/lib/auth/permissions";

/*
 * Caixa de mensagens do assistente (components/assistant/
 * assistant-inbox.tsx). Cada pessoa vê:
 *   - OWNER/ADMIN: todas;
 *   - restantes: as dirigidas a si, e as da sua loja sem destinatário.
 * Mensagens com mais de 60 dias não aparecem.
 */

export type AssistantMessage = {
  id: string;
  createdAt: string;
  kind: string;
  severity: "info" | "warning" | "high";
  title: string;
  body: string;
  href: string | null;
  read: boolean;
};

const MAX_AGE_DAYS = 60;
const MAX_MESSAGES = 50;

export async function getAssistantMessages(): Promise<{
  messages: AssistantMessage[];
  unread: number;
}> {
  const profile = await getCurrentProfile();
  if (!profile) return { messages: [], unread: 0 };

  const admin = createAdminClient();
  const since = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000).toISOString();

  let query = admin
    .from("assistant_messages")
    .select("id, created_at, kind, severity, title, body, href")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(MAX_MESSAGES);

  if (!hasFullAccess(profile.role)) {
    const storeId = profile.store?.id;
    query = query.or(
      storeId
        ? `target_user_id.eq.${profile.id},and(target_user_id.is.null,store_id.eq.${storeId})`
        : `target_user_id.eq.${profile.id}`,
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(`Erro ao ler mensagens: ${error.message}`);

  const rows = data ?? [];
  const readIds = new Set<string>();

  if (rows.length > 0) {
    const { data: reads } = await admin
      .from("assistant_message_reads")
      .select("message_id")
      .eq("user_id", profile.id)
      .in("message_id", rows.map((row) => row.id));

    for (const read of reads ?? []) readIds.add(read.message_id);
  }

  const messages = rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    kind: row.kind,
    severity: row.severity as AssistantMessage["severity"],
    title: row.title,
    body: row.body,
    href: row.href,
    read: readIds.has(row.id),
  }));

  return { messages, unread: messages.filter((m) => !m.read).length };
}

export async function markAssistantMessagesRead(ids: string[]): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile || ids.length === 0) return;

  // Só marca mensagens que a pessoa pode ver.
  const { messages } = await getAssistantMessages();
  const visible = new Set(messages.map((m) => m.id));
  const rows = ids
    .filter((id) => visible.has(id))
    .slice(0, MAX_MESSAGES)
    .map((id) => ({ message_id: id, user_id: profile.id }));

  if (rows.length === 0) return;

  const { error } = await createAdminClient()
    .from("assistant_message_reads")
    .upsert(rows, { onConflict: "message_id,user_id", ignoreDuplicates: true });

  if (error) throw new Error(`Erro ao marcar mensagens: ${error.message}`);
}
