import type { ProductLine } from "../domain/types";
import type { InsurerPricingModel } from "../models/insurer-pricing-model";

export type InsurerCapability = { insurerCode: string; insurerName: string; supportedLines: ProductLine[] };

/** Uma companhia que declara suportar um ramo, com ou sem modelo registado. */
export type InsurerLineEntry = {
  insurerCode: string;
  insurerName: string;
  model: InsurerPricingModel | null;
};

const capabilities = new Map<string, InsurerCapability>();
const models = new Map<string, InsurerPricingModel>();
const key = (insurerCode: string, line: ProductLine) => `${insurerCode.toUpperCase()}::${line}`;

export function registerInsurerCapability(capability: InsurerCapability) {
  capabilities.set(capability.insurerCode.toUpperCase(), capability);
}
export function registerPricingModel(line: ProductLine, model: InsurerPricingModel) {
  models.set(key(model.insurerCode, line), model);
}
export function getSupportedInsurers(line: ProductLine) {
  return Array.from(capabilities.values()).filter((c) => c.supportedLines.includes(line));
}

/*
 * Todas as companhias que declaram suportar o ramo, incluindo as que ainda
 * não têm modelo (`model: null`). É isto que permite ao orquestrador
 * devolver NOT_SUPPORTED em vez de a companhia desaparecer do resultado.
 */
export function getInsurersForProductLine(line: ProductLine): InsurerLineEntry[] {
  return getSupportedInsurers(line).map((c) => ({
    insurerCode: c.insurerCode,
    insurerName: c.insurerName,
    model: models.get(key(c.insurerCode, line)) ?? null,
  }));
}

export function getModelsForProductLine(line: ProductLine): InsurerPricingModel[] {
  return getInsurersForProductLine(line)
    .map((entry) => entry.model)
    .filter((m): m is InsurerPricingModel => m !== null);
}
