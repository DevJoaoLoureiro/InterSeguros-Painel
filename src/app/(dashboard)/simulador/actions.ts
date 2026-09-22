"use server";

import { cookies } from "next/headers";

import {
  sanitizeAutoValues,
  validateAutoValues,
} from "@/components/simulador/auto-values";
import type {
  SearchClientsResult,
  SimulationInput,
  SimulationResult,
} from "@/components/simulador/types";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { runMultiInsurerQuote } from "@/lib/quoting";
import { attachZurichRealQuote } from "@/lib/quoting/observations/real-quote-match";
import { issueZurichSnapshotToken } from "@/lib/quoting/observations/simulation-token";
import { createSupabaseObservationStore } from "@/lib/quoting/observations/supabase-store";
import { createAdminClient } from "@/lib/supabase/admin";

import { buildAutoQuoteRequest } from "./auto-request";
import {
  MIN_QUERY_LENGTH,
  computeStoreScope,
  findSimulatorClients,
  isUuid,
  toSearchTerm,
} from "./search-clients";

/*
 * Server Actions do simulador.
 *
 * Ambas são pontos de entrada não fiáveis (qualquer POST chega aqui), por
 * isso autenticam e validam tudo, e devolvem erros como valores em vez de
 * lançar exceções (em produção o Next mascara a mensagem das exceções).
 *
 * Nenhuma escreve na base de dados nem fala com seguradoras diretamente:
 * a pesquisa só lê o CRM e o cálculo delega no motor de cotações.
 */

export async function searchSimulatorClients(
  query: string,
): Promise<SearchClientsResult> {
  const profile = await getCurrentProfile();

  if (!profile) {
    return { ok: false, error: "Sessão expirada. Volte a iniciar sessão." };
  }

  const term = toSearchTerm(query);

  if (term.length < MIN_QUERY_LENGTH) {
    return { ok: true, clients: [] };
  }

  const cookieStore = await cookies();

  const scope = computeStoreScope({
    role: profile.role,
    profileStoreId: profile.store?.id ?? null,
    selectedStoreCookie: cookieStore.get("selected_store_id")?.value ?? null,
  });

  if (!scope.ok) {
    return { ok: false, error: "O utilizador não tem uma loja associada." };
  }

  try {
    const clients = await findSimulatorClients(
      createAdminClient(),
      term,
      scope.storeId,
    );

    return { ok: true, clients };
  } catch (error) {
    console.error("[simulador] Erro ao pesquisar clientes:", error);

    return { ok: false, error: "Não foi possível pesquisar clientes." };
  }
}

export async function runSimulation(
  input: SimulationInput,
): Promise<SimulationResult> {
  const profile = await getCurrentProfile();

  if (!profile) {
    return { ok: false, error: "Sessão expirada. Volte a iniciar sessão." };
  }

  if (input?.productLine !== "AUTO") {
    return {
      ok: false,
      error: "Este ramo ainda não está disponível no simulador.",
    };
  }

  const values = sanitizeAutoValues(input.values);
  const fieldErrors = validateAutoValues(values);

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, error: "Reveja os campos assinalados.", fieldErrors };
  }

  const clientId = isUuid(input.clientId) ? input.clientId : null;

  try {
    const request = buildAutoQuoteRequest(values, clientId);
    const estimated = await runMultiInsurerQuote(request);

    // Se este MESMO pedido já foi simulado no portal da Zurich e o preço real
    // guardado, esse valor passa a ser o principal (ver real-quote-match.ts).
    const { comparison } = await attachZurichRealQuote(
      request,
      estimated,
      createSupabaseObservationStore(),
    );

    // Snapshot assinado do pedido e da previsão Zurich, para mais tarde
    // associar a cotação real (ver observation-actions.ts). Null se não
    // houver estimativa Zurich.
    const zurichSnapshotToken = issueZurichSnapshotToken(
      request,
      estimated,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    return { ok: true, comparison, zurichSnapshotToken };
  } catch (error) {
    console.error("[simulador] Erro ao calcular simulação:", error);

    return {
      ok: false,
      error: "Não foi possível calcular a simulação. Tente novamente.",
    };
  }
}
