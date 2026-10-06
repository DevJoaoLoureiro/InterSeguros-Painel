import type { SupabaseClient } from "@supabase/supabase-js";

import {
  computeRecoveryWindow,
  recoveryReference,
  type RecoveryWindow,
} from "@/lib/recovery/lost-clients";
import { first, loadRecoveryData } from "@/lib/recovery/recovery-data";

/*
 * Cria leads de recuperação (source = 'recuperacao') para clientes
 * que saíram e cujo aniversário da saída está a ≤45 dias.
 * Corre no fim dos crons de sync; dryRun só devolve o que criaria.
 *
 * Não cria lead quando:
 * - o cliente (mesmo NIF) já tem uma apólice ATIVA do mesmo ramo
 *   connosco (voltou / foi substituída);
 * - é Auto e a matrícula está noutra apólice ativa da carteira
 *   (substituída ou carro vendido);
 * - já existe lead para esta apólice e este aniversário.
 *
 * Atribuição: o comercial da apólice (se ativo); senão o OWNER.
 */

export type RecoveryCandidate = {
  reference: string;
  policyId: string;
  policyNumber: string;
  clientId: string;
  clientName: string;
  lineName: string | null;
  companyName: string | null;
  annualizedPremium: number | null;
  paymentFrequency: string | null;
  window: RecoveryWindow;
  assignedUserId: string | null;
  storeId: string | null;
};

export type RecoveryRunResult = {
  dryRun: boolean;
  candidates: number;
  created: number;
  skipped: { alreadyExists: number; cameBack: number; vehicleElsewhere: number };
  errors: string[];
  preview?: RecoveryCandidate[];
};

const FREQUENCY_LABEL: Record<string, string> = {
  MONTHLY: "Mensal",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
  SINGLE: "Único",
};

function formatDatePt(date: string) {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

export async function runRecoveryLeads(
  supabase: SupabaseClient,
  options: { dryRun?: boolean; today?: string } = {},
): Promise<RecoveryRunResult> {
  const dryRun = options.dryRun ?? false;
  const today =
    options.today ??
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(
      new Date(),
    );

  const result: RecoveryRunResult = {
    dryRun,
    candidates: 0,
    created: 0,
    skipped: { alreadyExists: 0, cameBack: 0, vehicleElsewhere: 0 },
    errors: [],
  };

  // ----------------------------------------
  // Dados
  // ----------------------------------------

  const [{ policies, receiptsByPolicy, replacedReason }, profilesResult] =
    await Promise.all([
      loadRecoveryData(supabase),
      supabase.from("profiles").select("id, role, active, store_id"),
    ]);

  const profiles = profilesResult.data ?? [];
  const activeProfiles = new Map(
    profiles.filter((p) => p.active).map((p) => [p.id, p]),
  );
  const owner = profiles.find((p) => p.active && p.role === "OWNER") ?? null;

  // ----------------------------------------
  // Candidatos na janela
  // ----------------------------------------

  const candidates: RecoveryCandidate[] = [];

  for (const p of policies) {
    // PENDING = ainda não começou: não há saída a detetar.
    if (p.status === "PENDING") continue;

    const window = computeRecoveryWindow(
      p,
      receiptsByPolicy.get(p.id) ?? [],
      today,
    );

    if (!window?.inWindow) continue;

    const line = first(p.insurance_line);
    const client = first(p.client);

    if (!client) continue;

    const replaced = replacedReason(p);

    if (replaced) {
      result.skipped[replaced]++;
      continue;
    }

    const commercial = p.commercial_user_id
      ? activeProfiles.get(p.commercial_user_id) ?? null
      : null;
    const assignee = commercial ?? owner;

    candidates.push({
      reference: recoveryReference(p.id, window.anniversary),
      policyId: p.id,
      policyNumber: p.policy_number,
      clientId: client.id,
      clientName: client.name,
      lineName: line?.name ?? null,
      companyName: first(p.company)?.name ?? null,
      annualizedPremium:
        p.annualized_premium === null ? null : Number(p.annualized_premium),
      paymentFrequency: p.payment_frequency,
      window,
      assignedUserId: assignee?.id ?? null,
      storeId: p.issuing_store_id ?? assignee?.store_id ?? null,
    });
  }

  result.candidates = candidates.length;

  if (candidates.length === 0) {
    if (dryRun) result.preview = [];
    return result;
  }

  // ----------------------------------------
  // Já existem?
  // ----------------------------------------

  const { data: existing, error: existingError } = await supabase
    .from("leads")
    .select("source_reference")
    .eq("source", "recuperacao")
    .in(
      "source_reference",
      candidates.map((c) => c.reference),
    );

  if (existingError) {
    result.errors.push(`Leads existentes: ${existingError.message}`);
    return result;
  }

  const existingRefs = new Set((existing ?? []).map((l) => l.source_reference));
  const toCreate = candidates.filter((c) => !existingRefs.has(c.reference));
  result.skipped.alreadyExists = candidates.length - toCreate.length;

  if (dryRun) {
    result.preview = toCreate;
    return result;
  }

  // ----------------------------------------
  // Criar
  // ----------------------------------------

  const clientById = new Map(
    policies
      .map((p) => first(p.client))
      .filter(Boolean)
      .map((c) => [c!.id, c!]),
  );

  for (const c of toCreate) {
    const client = clientById.get(c.clientId);

    const exitLabel =
      c.window.exitReason === "CANCELLED"
        ? "Apólice anulada"
        : c.window.exitReason === "EXPIRED"
          ? "Apólice terminada"
          : "Deixou de pagar / sem recibos novos";

    const { data: lead, error } = await supabase
      .from("leads")
      .insert({
        name: c.clientName,
        phone: client?.phone ?? "",
        email: client?.email ?? null,
        nif: client?.nif ?? null,
        birth_date: client?.birth_date ?? null,
        postal_code: client?.postal_code ?? null,
        city: client?.city ?? null,
        insurance_type: c.lineName ?? "Seguro",
        status: "nova",
        priority:
          (c.annualizedPremium ?? 0) >= 500 ? "alta" : "media",
        source: "recuperacao",
        source_reference: c.reference,
        store_id: c.storeId,
        assigned_user_id: c.assignedUserId,
        privacy_consent: false,
        answers: {
          motivo: "Recuperar cliente perdido",
          renovacao_prevista: formatDatePt(c.window.anniversary),
          saiu_em: formatDatePt(c.window.exitDate),
          como_saiu: exitLabel,
          apolice_anterior: c.policyNumber,
          companhia_anterior: c.companyName ?? "—",
          ramo: c.lineName ?? "—",
          premio_anual:
            c.annualizedPremium !== null
              ? `${c.annualizedPremium.toFixed(2).replace(".", ",")} €`
              : "—",
          fracionamento:
            FREQUENCY_LABEL[c.paymentFrequency ?? ""] ?? "—",
          client_id: c.clientId,
        },
      })
      .select("id")
      .single();

    if (error) {
      // Corrida com outra execução: o índice único já a criou.
      if (error.code === "23505") {
        result.skipped.alreadyExists++;
        continue;
      }

      result.errors.push(`${c.reference}: ${error.message}`);
      continue;
    }

    result.created++;

    await supabase.from("lead_history").insert({
      lead_id: lead.id,
      event_type: "lead_created",
      description: `Lead de recuperação criada automaticamente: ${exitLabel.toLowerCase()} a ${formatDatePt(c.window.exitDate)}; renovação na companhia nova prevista para ${formatDatePt(c.window.anniversary)}.`,
    });
  }

  return result;
}
