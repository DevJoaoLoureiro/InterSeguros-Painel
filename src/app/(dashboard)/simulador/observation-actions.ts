"use server";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { deriveErrors } from "@/lib/quoting/observations/metrics";
import { verifySimulationSnapshot } from "@/lib/quoting/observations/simulation-token";
import {
  ObservationStoreError,
  createSupabaseObservationStore,
} from "@/lib/quoting/observations/supabase-store";
import type { ObservationStatus } from "@/lib/quoting/observations/types";
import {
  parseRealQuoteForm,
  type RealQuoteFormErrors,
} from "@/lib/quoting/observations/validation";
import { saveZurichQuoteObservation } from "@/lib/quoting/observations/zurich-quote-observations";

/*
 * Server Action: guardar a cotação real Zurich de uma simulação.
 *
 * É um ponto de entrada não fiável (qualquer POST chega aqui): autentica,
 * verifica o token assinado que o servidor emitiu ao calcular (é ele que traz
 * o pedido e a previsão originais) e valida tudo outra vez. Devolve erros como
 * valores e nunca regista dados pessoais.
 */

export type SaveRealZurichQuoteInput = {
  /** Emitido por runSimulation; contém o pedido e a previsão assinados. */
  snapshotToken: string;

  /** Campos do formulário, tal como escritos (validados no servidor). */
  form: {
    amount: string;
    basis: string;
    productName: string;
    productCode: string;
    reference: string;
    status: string;
    notes: string;
  };
};

export type SaveRealZurichQuoteResult =
  | {
      ok: true;
      id: string;
      status: ObservationStatus;

      /** Preenchido quando ficou marcada como duplicado (nada foi apagado). */
      duplicateOf: string | null;

      modelVersion: string;
      estimatedPremium: number;
      realQuoteAmount: number;

      /** estimado - real: negativo = o modelo subestimou. */
      signedError: number | null;
      relativeError: number | null;
    }
  | {
      ok: false;
      error: string;
      fieldErrors?: RealQuoteFormErrors;
    };

const TOKEN_ERRORS = {
  MALFORMED: "Simulação inválida. Volte a calcular e tente de novo.",
  BAD_SIGNATURE: "Simulação inválida. Volte a calcular e tente de novo.",
  INVALID_PAYLOAD: "Simulação inválida. Volte a calcular e tente de novo.",
  EXPIRED: "A simulação é demasiado antiga. Volte a calcular e tente de novo.",
} as const;

export async function saveRealZurichQuote(
  input: SaveRealZurichQuoteInput,
): Promise<SaveRealZurichQuoteResult> {
  const profile = await getCurrentProfile();

  if (!profile) {
    return { ok: false, error: "Sessão expirada. Volte a iniciar sessão." };
  }

  const verified = verifySimulationSnapshot(
    input?.snapshotToken,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  );

  if (!verified.ok) {
    return { ok: false, error: TOKEN_ERRORS[verified.reason] };
  }

  const parsed = parseRealQuoteForm(input.form);

  if (!parsed.ok) {
    return {
      ok: false,
      error: "Reveja os campos assinalados.",
      fieldErrors: parsed.errors,
    };
  }

  const { request, prediction } = verified.snapshot;

  try {
    const result = await saveZurichQuoteObservation({
      clientId: request.clientId ?? null,
      request,
      prediction,
      realQuote: parsed.value.realQuote,
      status: parsed.value.status,
      notes: parsed.value.notes,
      store: createSupabaseObservationStore(),
    });

    if (!result.ok) {
      return { ok: false, error: result.errors.join(" ") };
    }

    const { observation } = result;
    const derived = deriveErrors(
      observation.estimated_premium,
      observation.real_quote_amount,
    );

    return {
      ok: true,
      id: observation.id,
      status: observation.status,
      duplicateOf: observation.duplicate_of,
      modelVersion: observation.model_version,
      estimatedPremium: observation.estimated_premium,
      realQuoteAmount: observation.real_quote_amount,
      // Os erros vêm das colunas geradas; deriva-se só se vierem a null.
      signedError: observation.signed_error ?? derived?.signed ?? null,
      relativeError: observation.relative_error ?? derived?.relative ?? null,
    };
  } catch (error) {
    // Só o nome/código: a mensagem do Postgres pode conter a linha inteira.
    console.error(
      "[simulador] Erro ao guardar cotação real Zurich:",
      error instanceof ObservationStoreError ? error.message : "erro inesperado",
    );

    return {
      ok: false,
      error: "Não foi possível guardar a cotação real. Tente novamente.",
    };
  }
}
