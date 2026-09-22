import { createEmptyAutoValues, formatPostalCode } from "./auto-values";
import type {
  AutoFieldKey,
  AutoFormValues,
  PrefilledFields,
  SimulatorClient,
} from "./types";

/*
 * Aplica ao formulário Auto o que o CRM já sabe de um cliente.
 *
 * Só toca em campos que o CRM realmente tem, e regista quais foram
 * preenchidos para o formulário os marcar como "CRM" e para poderem ser
 * limpos ao trocar de cliente sem apagar o que o mediador escreveu.
 */

/** Repõe os campos que tinham sido pré-preenchidos (e só esses). */
export function clearPrefilledValues(
  values: AutoFormValues,
  prefilled: PrefilledFields,
): AutoFormValues {
  const empty = createEmptyAutoValues();
  const next = { ...values };

  for (const key of Object.keys(prefilled) as AutoFieldKey[]) {
    next[key] = empty[key];
  }

  return next;
}

export function applyClientToValues(
  values: AutoFormValues,
  client: SimulatorClient,
): { values: AutoFormValues; prefilled: PrefilledFields } {
  const next = { ...values };
  const prefilled: PrefilledFields = {};

  if (client.birthDate) {
    next.birthDate = client.birthDate;
    prefilled.birthDate = true;
  }

  const postalCode = formatPostalCode(client.postalCode ?? "");

  if (postalCode) {
    next.postalCode = postalCode;
    prefilled.postalCode = true;
  }

  // As viaturas chegam com as de apólice ativa primeiro.
  const vehicle = client.vehicles[0];

  if (vehicle) {
    next.registration = vehicle.registration;
    prefilled.registration = true;
  }

  return { values: next, prefilled };
}
