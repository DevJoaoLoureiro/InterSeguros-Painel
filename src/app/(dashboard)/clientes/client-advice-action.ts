"use server";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  AdvicePriority,
  ClientAdvice,
} from "@/lib/opportunities/client-advice";

import { createTask } from "@/app/(dashboard)/tarefas/action";
import { assertClientAccess } from "@/lib/auth/access";
import {
  getClientPanel,
  type ClientPanelData,
} from "@/app/(dashboard)/clientes/receipts-action";
import {
  CLIENT_ADVICE_MODEL,
  generateClientAiAdvice,
  hashFacts,
  type AdviceFacts,
  type ClientAiAdvice,
} from "@/lib/ai/client-advice-ai";

const DISMISS_DAYS = 90;

/*
 * "Dispensar" um conselho: deixa de aparecer a toda a equipa
 * durante 90 dias.
 */
export async function dismissClientAdvice(
  clientId: string,
  adviceKey: string,
) {
  if (!clientId || !adviceKey) throw new Error("Conselho inválido.");

  const { profile } = await assertClientAccess([clientId]);

  const until = new Date();
  until.setDate(until.getDate() + DISMISS_DAYS);

  const { error } = await createAdminClient()
    .from("client_advice_dismissals")
    .upsert(
      {
        client_id: clientId,
        advice_key: adviceKey,
        dismissed_by_user_id: profile.id,
        dismissed_until: until.toISOString().slice(0, 10),
        created_at: new Date().toISOString(),
      },
      { onConflict: "client_id,advice_key" },
    );

  if (error) {
    throw new Error(`Erro ao dispensar conselho: ${error.message}`);
  }

  return { success: true };
}

const TASK_PRIORITY: Record<AdvicePriority, "HIGH" | "MEDIUM" | "LOW"> = {
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
};

/*
 * Cria um processo de simulação (Tarefas → Processos) a partir de
 * um conselho, já com cliente, NIF, ramo e data de início.
 */
export async function createProcessFromAdvice(input: {
  clientName: string;
  clientNif: string | null;
  advice: Pick<ClientAdvice, "title" | "reason" | "priority" | "action">;
}) {
  const { action } = input.advice;

  if (action.type !== "create_process") {
    throw new Error("Este conselho não cria processos.");
  }

  await createTask({
    kind: "PROCESS",
    title: "",
    description: `💡 ${input.advice.title}\n${input.advice.reason}`,
    priority: TASK_PRIORITY[input.advice.priority],
    dueAt: null,
    assignedUserId: null,
    process: {
      clientName: input.clientName,
      clientNif: input.clientNif,
      insuranceLineId: action.lineId,
      policyStartDate: action.policyStartDate,
      isNewPolicy: action.isNewPolicy,
    },
  });

  return { success: true };
}

// ============================================================
// PARTE 2 — ANÁLISE DA IA
// ============================================================

function lisbonDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(
    date,
  );
}

function ageFrom(birthDate: string | null, today: string) {
  if (!birthDate || Number.isNaN(Date.parse(birthDate.slice(0, 10)))) {
    return null;
  }

  let age = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4));
  if (today.slice(5) < birthDate.slice(5, 10)) age -= 1;

  return age;
}

function text(value: unknown) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

/*
 * Factos mínimos para a IA. De propósito SEM NIF, IBAN, CC, email,
 * telefone, morada ou números de apólice.
 */
function buildAdviceFacts(panel: ClientPanelData, today: string): AdviceFacts {
  const profile = panel.profile;
  const ficha =
    profile?.providers.find((p) => p.company_code === "ZURICH")?.metadata ??
    profile?.providers[0]?.metadata ??
    {};

  const issueDates = panel.policies
    .map((p) => p.issue_date)
    .filter(Boolean)
    .sort() as string[];

  return {
    cliente: {
      primeiroNome: (profile?.name ?? "").trim().split(/\s+/)[0] ?? "",
      idade: ageFrom(profile?.birth_date ?? null, today),
      sexo: text(ficha.Sexo ?? ficha.sexo),
      estadoCivil: text(ficha.EstadoCivil),
      filhos: text(ficha.Filhos),
      profissao: text(ficha.NomeAtividade),
      empresa: (profile?.nif ?? "").startsWith("5"),
      clienteDesde: issueDates[0] ?? null,
    },
    apolices: panel.policies.map((policy) => {
      const receipts = (panel.receiptsByPolicy[policy.id] ?? []).filter(
        (r) => !r.isReversal,
      );

      return {
        ramo: policy.insurance_line?.name ?? policy.product_name,
        companhia: policy.company?.name ?? null,
        estado: policy.status,
        premioAnual: policy.annualized_premium,
        inicio: policy.start_date,
        renovacao:
          receipts
            .map((r) => r.period_end)
            .filter(Boolean)
            .sort()
            .at(-1) ?? null,
        recibosEmAtraso: receipts.filter(
          (r) =>
            r.status === "PENDING" &&
            r.due_date !== null &&
            r.due_date.slice(0, 10) < today,
        ).length,
        ultimoReciboDevolvido: receipts[0]?.status === "RETURNED",
        variacaoPremioPct:
          receipts.find((r) => r.premium_change_pct !== null)
            ?.premium_change_pct ?? null,
        seguimento: panel.transfers[policy.id]?.kind ?? null,
      };
    }),
    conselhos: panel.advice.map((a) => ({
      key: a.key,
      categoria: a.category,
      prioridade: a.priority,
      titulo: a.title,
      motivo: a.reason,
    })),
  };
}

export type ClientAiAdviceResult = {
  analysis: ClientAiAdvice | null;
  generatedAt: string | null;
  cached: boolean;
};

/*
 * Só corre quando o utilizador carrega em "Pedir à IA". Reutiliza a
 * análise do mesmo dia se os factos do cliente não mudaram.
 */
export async function getClientAiAdvice(
  clientId: string,
  options: { refresh?: boolean } = {},
): Promise<ClientAiAdviceResult> {
  const profile = await getCurrentProfile();

  if (!profile) throw new Error("Não autenticado.");

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("A IA não está configurada (falta OPENAI_API_KEY).");
  }

  const today = lisbonDate();
  const panel = await getClientPanel(clientId);

  if (panel.advice.length === 0) {
    return { analysis: null, generatedAt: null, cached: false };
  }

  const facts = buildAdviceFacts(panel, today);
  const factsHash = hashFacts(facts);
  const admin = createAdminClient();

  if (!options.refresh) {
    const { data: cached } = await admin
      .from("client_ai_advice")
      .select("facts_hash, payload, generated_at")
      .eq("client_id", clientId)
      .maybeSingle();

    if (
      cached &&
      cached.facts_hash === factsHash &&
      lisbonDate(new Date(cached.generated_at)) === today
    ) {
      return {
        analysis: cached.payload as ClientAiAdvice,
        generatedAt: cached.generated_at,
        cached: true,
      };
    }
  }

  const analysis = await generateClientAiAdvice({
    facts,
    advice: panel.advice,
    userFirstName: profile.full_name.trim().split(/\s+/)[0] ?? "",
    today,
  });

  const generatedAt = new Date().toISOString();

  // A cache é uma otimização: se falhar (ex.: migração por correr),
  // a análise é devolvida na mesma.
  const { error: cacheError } = await admin.from("client_ai_advice").upsert({
    client_id: clientId,
    facts_hash: factsHash,
    payload: analysis,
    model: CLIENT_ADVICE_MODEL,
    generated_by_user_id: profile.id,
    generated_at: generatedAt,
  });

  if (cacheError) {
    console.error("[clientes] client_ai_advice cache", cacheError.message);
  }

  return { analysis, generatedAt, cached: false };
}
