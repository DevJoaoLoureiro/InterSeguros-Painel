"use server";

import { requireAdmin } from "@/lib/auth/access";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Ligar um número WhatsApp à API (Cloud API) mantendo a aplicação
 * WhatsApp Business no telemóvel ("coexistência").
 *
 * A ligação em si é feita pelo assistente da Meta (Embedded Signup,
 * no browser — ver connect-whatsapp.tsx). Aqui fica o que vem depois:
 * subscrever a conta à app, pedir a sincronização inicial e acertar a
 * conta do CRM. Só OWNER/ADMIN.
 *
 * NUNCA devolver o token de acesso.
 */

function graphUrl(path: string) {
  const version = process.env.WHATSAPP_API_VERSION || "v23.0";
  return `https://graph.facebook.com/${version}/${path}`;
}

async function graph(
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown },
) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!token) {
    throw new Error("WHATSAPP_ACCESS_TOKEN não está configurado.");
  }

  const response = await fetch(graphUrl(path), {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });

  const json = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  > & { error?: { message?: string; code?: number } };

  return { ok: response.ok && !json.error, json };
}

export type WhatsappNumberStatus = {
  accountId: string;
  displayName: string;
  phoneNumber: string | null;
  // CONNECTED / DISCONNECTED ... (estado da ligação do número)
  status: string | null;
  // CLOUD_API = pronto para o CRM; ON_PREMISE = só na app do telemóvel
  platform: string | null;
  subscribed: boolean | null;
  ready: boolean;
  error: string | null;
};

/* Estado de cada número do CRM, tal como a Meta o vê. */
export async function getWhatsappStatus(): Promise<WhatsappNumberStatus[]> {
  await requireAdmin();

  const { data: accounts, error } = await createAdminClient()
    .from("whatsapp_accounts")
    .select("id, display_name, phone_number, phone_number_id, waba_id")
    .eq("is_active", true)
    .order("created_at");

  if (error) {
    throw new Error(`Erro ao carregar contas WhatsApp: ${error.message}`);
  }

  return Promise.all(
    (accounts ?? []).map(async (account) => {
      const [phone, subs] = await Promise.all([
        graph(`${account.phone_number_id}?fields=status,platform_type`),
        graph(`${account.waba_id}/subscribed_apps`),
      ]);

      const platform = phone.ok ? String(phone.json.platform_type ?? "") : null;
      const subscribed = subs.ok
        ? ((subs.json.data as unknown[] | undefined) ?? []).length > 0
        : null;

      return {
        accountId: account.id,
        displayName: account.display_name,
        phoneNumber: account.phone_number,
        status: phone.ok ? String(phone.json.status ?? "") : null,
        platform,
        subscribed,
        ready: platform === "CLOUD_API" && subscribed === true,
        error: phone.ok
          ? null
          : "A Meta não deixa ver este número com o token atual (falta atribuir a conta ao utilizador de sistema, ou o ID está errado).",
      };
    }),
  );
}

/*
 * Chamado quando o assistente da Meta termina com sucesso. Recebe os
 * IDs que o assistente devolve (conta e número).
 */
export async function completeWhatsappOnboarding(input: {
  wabaId: string;
  phoneNumberId: string;
}) {
  await requireAdmin();

  if (!/^\d{5,25}$/.test(input.wabaId) || !/^\d{5,25}$/.test(input.phoneNumberId)) {
    throw new Error("A Meta não devolveu os identificadores da conta.");
  }

  const steps: string[] = [];

  // 1. A conta tem de estar subscrita à app para os webhooks chegarem.
  const subscribe = await graph(`${input.wabaId}/subscribed_apps`, {
    method: "POST",
  });

  steps.push(
    subscribe.ok
      ? "Conta subscrita à app."
      : `Subscrição falhou: ${subscribe.json.error?.message ?? "erro"}`,
  );

  // 2. Coexistência: pedir os contactos e o histórico da aplicação
  //    (a Meta só aceita isto nas primeiras 24 horas).
  for (const syncType of ["smb_app_state_sync", "history"] as const) {
    const sync = await graph(`${input.phoneNumberId}/smb_app_data`, {
      method: "POST",
      body: { messaging_product: "whatsapp", sync_type: syncType },
    });

    steps.push(
      sync.ok
        ? `Sincronização pedida (${syncType}).`
        : `Sincronização ${syncType} não pedida: ${sync.json.error?.message ?? "erro"}`,
    );
  }

  // 3. Conta do CRM: se o número (ou a conta) já existe, acerta os IDs.
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("whatsapp_accounts")
    .select("id, phone_number_id, waba_id")
    .or(`phone_number_id.eq.${input.phoneNumberId},waba_id.eq.${input.wabaId}`)
    .limit(1)
    .maybeSingle();

  if (existing) {
    await admin
      .from("whatsapp_accounts")
      .update({
        phone_number_id: input.phoneNumberId,
        waba_id: input.wabaId,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    steps.push("Conta do CRM atualizada.");
  } else {
    steps.push(
      "Este número ainda não existe no CRM: tem de ser acrescentado às contas WhatsApp (com a loja).",
    );
  }

  return { success: true, steps };
}
