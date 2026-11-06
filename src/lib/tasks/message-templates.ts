import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_TEMPLATES,
  isMessageLineKind,
  sanitizePlans,
  type MessageLineKind,
  type MessageTemplate,
} from "@/lib/tasks/client-message";

export type StoredMessageTemplates = Record<
  MessageLineKind,
  MessageTemplate & { customized: boolean }
>;

/* Modelos gravados por cima dos de defeito (o chamador valida a sessão). */
export async function loadMessageTemplates(): Promise<StoredMessageTemplates> {
  const result = Object.fromEntries(
    Object.entries(DEFAULT_TEMPLATES).map(([kind, template]) => [
      kind,
      { ...template, customized: false },
    ]),
  ) as StoredMessageTemplates;

  const { data, error } = await createAdminClient()
    .from("message_templates")
    .select("line_kind, new_body, renewal_body, plans");

  // Sem a tabela (migração por aplicar) continua com os de defeito.
  if (error) {
    console.error("[message_templates]", error.message);
    return result;
  }

  for (const row of data ?? []) {
    if (!isMessageLineKind(row.line_kind)) continue;

    result[row.line_kind] = {
      lineKind: row.line_kind,
      newBody: row.new_body,
      renewalBody: row.renewal_body,
      plans: sanitizePlans(row.plans),
      customized: true,
    };
  }

  return result;
}
