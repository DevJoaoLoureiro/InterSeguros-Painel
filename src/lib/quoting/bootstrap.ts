import { zurichAutoPricingModel } from "./models/zurich/auto-model";
import {
  registerInsurerCapability,
  registerPricingModel,
} from "./registry/insurer-registry";

/*
 * Regista as companhias e modelos padrão.
 *
 * Idempotente por construção: o registry guarda tudo em Maps indexados por
 * código/ramo, por isso chamar isto várias vezes repõe exatamente o mesmo
 * estado, sem duplicados. É chamada pelo runMultiInsurerQuote, pelo que
 * quem usa o motor não precisa de a chamar (nem de guardar uma flag).
 *
 * Não usa flag de módulo de propósito: em dev, o hot reload pode recarregar
 * o registry sem recarregar este ficheiro, e uma flag "já registado" deixaria
 * o registry vazio para sempre.
 */
export function registerInsurers(): void {
  registerInsurerCapability({
    insurerCode: "ZURICH",
    insurerName: "Zurich",
    supportedLines: [
      "AUTO",
      "WORK_ACCIDENT",
      "TRAVEL",
    ],
  });

  registerPricingModel(
    "AUTO",
    zurichAutoPricingModel,
  );

  registerInsurerCapability({
    insurerCode: "PREVOIR",
    insurerName: "Prévoir",
    supportedLines: [
      "PERSONAL_ACCIDENT",
      "LIFE",
      "SAVINGS",
      "OTHER",
    ],
  });
}
