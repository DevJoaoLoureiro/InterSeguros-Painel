"use server";

import { revalidatePath } from "next/cache";

import { requireProfile, resolveStoreScope } from "@/lib/auth/access";
import { createAdminClient } from "@/lib/supabase/admin";
import * as queries from "@/lib/vencimentos/queries";
import * as likelySwitches from "@/lib/recovery/likely-switches";

export type {
  RenewalRow,
  UpcomingReceiptRow,
} from "@/lib/vencimentos/queries";

export type LikelySwitchRow = likelySwitches.LikelySwitchRow & {
  // Já existe uma tarefa aberta para tentar renovar esta apólice.
  hasOpenTask: boolean;
};

const EXIT_LABEL: Record<likelySwitches.LikelySwitchRow["exitReason"], string> =
  {
    NO_NEW_RECEIPTS: "Não renovou",
    EXPIRED: "Apólice terminada",
    CANCELLED: "Apólice anulada",
  };

function first<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function formatDatePt(date: string) {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

async function hasOpenRenewalTask(
  admin: ReturnType<typeof createAdminClient>,
  policyId: string,
) {
  const { data, error } = await admin
    .from("tasks")
    .select("id")
    .eq("policy_id", policyId)
    .not("status", "in", "(COMPLETED,CANCELLED)")
    .limit(1);

  if (error) {
    throw new Error(`Erro ao verificar tarefas: ${error.message}`);
  }

  return (data ?? []).length > 0;
}

/*
 * Server actions de vencimentos. O storeId pedido pelo browser não é
 * confiável: resolveStoreScope limita não-admins à sua loja.
 */

export async function getUpcomingRenewals({
  storeId,
}: {
  storeId: string | null;
}) {
  return queries.getUpcomingRenewals({
    storeId: await resolveStoreScope(storeId),
  });
}

export async function getUpcomingReceipts({
  storeId,
}: {
  storeId: string | null;
}) {
  return queries.getUpcomingReceipts({
    storeId: await resolveStoreScope(storeId),
  });
}

export async function getLikelySwitches({
  storeId,
}: {
  storeId: string | null;
}) {
  const [rows, openTasks] = await Promise.all([
    likelySwitches.getLikelySwitches({
      storeId: await resolveStoreScope(storeId),
    }),
    // Fora da cache: o botão "Criar tarefa" muda isto na hora.
    createAdminClient()
      .from("tasks")
      .select("policy_id")
      .not("policy_id", "is", null)
      .not("status", "in", "(COMPLETED,CANCELLED)"),
  ]);

  if (openTasks.error) {
    console.error("[vencimentos] tarefas abertas", openTasks.error.message);
  }

  const withOpenTask = new Set(
    (openTasks.data ?? []).map((t) => t.policy_id as string),
  );

  return rows.map(
    (row): LikelySwitchRow => ({
      ...row,
      hasOpenTask: withOpenTask.has(row.policyId),
    }),
  );
}

/*
 * Botão "Criar tarefa" do separador Anuladas: tarefa para tentar
 * renovar com o cliente, já ligada ao cliente e à apólice e atribuída
 * a quem carregou. Os dados vêm da BD (só o motivo e a data da saída
 * vêm da linha, para o texto da descrição).
 */
export async function createRenewalTask(input: {
  policyId: string;
  exitDate: string;
  exitReason: likelySwitches.LikelySwitchRow["exitReason"];
}) {
  const { profile } = await requireProfile();

  if (!input.policyId) throw new Error("Apólice inválida.");

  const admin = createAdminClient();

  const { data: policy, error: policyError } = await admin
    .from("policies")
    .select(
      "id, policy_number, client_id, annualized_premium, company:companies ( name ), insurance_line:insurance_lines ( name ), client:clients ( name, nif, phone, email )",
    )
    .eq("id", input.policyId)
    .maybeSingle();

  if (policyError || !policy) {
    throw new Error("Apólice não encontrada.");
  }

  if (await hasOpenRenewalTask(admin, policy.id)) {
    throw new Error("Já existe uma tarefa aberta para esta apólice.");
  }

  const client = first(
    policy.client as
      | { name: string; nif: string | null; phone: string | null; email: string | null }
      | { name: string; nif: string | null; phone: string | null; email: string | null }[]
      | null,
  );
  const lineName =
    first(policy.insurance_line as { name: string } | { name: string }[] | null)
      ?.name ?? null;
  const companyName =
    first(policy.company as { name: string } | { name: string }[] | null)
      ?.name ?? null;
  const clientName = client?.name ?? "Cliente";

  const exit = EXIT_LABEL[input.exitReason] ?? "Saiu";
  const exitDate = /^\d{4}-\d{2}-\d{2}$/.test(input.exitDate)
    ? ` a ${formatDatePt(input.exitDate)}`
    : "";

  const description = [
    `${exit}${exitDate}. Contactar o cliente para tentar renovar.`,
    `Apólice ${policy.policy_number}${companyName ? ` · ${companyName}` : ""}${lineName ? ` · ${lineName}` : ""}`,
    policy.annualized_premium !== null
      ? `Prémio anual: ${Number(policy.annualized_premium).toFixed(2).replace(".", ",")} €`
      : null,
    client?.phone ? `Telefone: ${client.phone}` : null,
    client?.email ? `Email: ${client.email}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const { error } = await admin.from("tasks").insert({
    kind: "TASK",
    title: `Tentar renovar${lineName ? ` ${lineName}` : ""} — ${clientName}`,
    description,
    status: "PENDING",
    priority: "MEDIUM",
    due_at: null,
    assigned_user_id: profile.id,
    created_by_user_id: profile.id,
    store_id: profile.store?.id ?? null,
    client_id: policy.client_id,
    policy_id: policy.id,
    client_name: clientName,
    client_nif: client?.nif ?? null,
  });

  if (error) {
    throw new Error(`Erro ao criar tarefa: ${error.message}`);
  }

  revalidatePath("/tarefas");
  revalidatePath("/vencimentos");

  return { success: true };
}
