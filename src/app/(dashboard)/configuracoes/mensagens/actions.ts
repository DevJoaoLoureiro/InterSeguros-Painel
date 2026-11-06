"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/access";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isMessageLineKind,
  sanitizePlans,
  type MessagePlan,
} from "@/lib/tasks/client-message";

const MAX_BODY = 4000;

export async function saveMessageTemplate(input: {
  lineKind: string;
  newBody: string;
  renewalBody: string;
  plans: MessagePlan[];
}) {
  const { profile } = await requireAdmin();

  if (!isMessageLineKind(input.lineKind)) {
    throw new Error("Ramo inválido.");
  }

  const newBody = input.newBody.trim();
  const renewalBody = input.renewalBody.trim();

  if (!newBody || !renewalBody) {
    throw new Error("Os dois textos são obrigatórios.");
  }

  if (newBody.length > MAX_BODY || renewalBody.length > MAX_BODY) {
    throw new Error("Texto demasiado longo.");
  }

  const { error } = await createAdminClient()
    .from("message_templates")
    .upsert(
      {
        line_kind: input.lineKind,
        new_body: newBody,
        renewal_body: renewalBody,
        plans: sanitizePlans(input.plans).slice(0, 10),
        updated_by_user_id: profile.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "line_kind" },
    );

  if (error) {
    throw new Error(`Erro ao guardar o modelo: ${error.message}`);
  }

  revalidatePath("/configuracoes/mensagens");
  revalidatePath("/processos");
}

/* Volta ao modelo por defeito do código (apaga o gravado). */
export async function resetMessageTemplate(lineKind: string) {
  await requireAdmin();

  if (!isMessageLineKind(lineKind)) {
    throw new Error("Ramo inválido.");
  }

  const { error } = await createAdminClient()
    .from("message_templates")
    .delete()
    .eq("line_kind", lineKind);

  if (error) {
    throw new Error(`Erro ao repor o modelo: ${error.message}`);
  }

  revalidatePath("/configuracoes/mensagens");
  revalidatePath("/processos");
}
