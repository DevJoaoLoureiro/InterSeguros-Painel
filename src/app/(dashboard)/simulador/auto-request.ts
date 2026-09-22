import type { QuoteRequest } from "@/lib/quoting/domain/types";

import { parseEuroAmount } from "@/components/simulador/auto-values";
import type { AutoFormValues } from "@/components/simulador/types";

/*
 * Converte os valores do formulário Auto (já sanitizados e validados) no
 * pedido que o motor multi-seguradora entende.
 *
 * Só traduz: não decide preços nem quais seguradoras respondem. Campos que
 * o mediador não indicou seguem como null (nunca 0), porque "não sei" e
 * "zero" são coisas diferentes para um modelo de pricing.
 */
export function buildAutoQuoteRequest(
  values: AutoFormValues,
  clientId: string | null,
): QuoteRequest {
  const { coverages } = values;

  return {
    requestId: crypto.randomUUID(),
    clientId,

    productLine: "AUTO",
    requestedAt: new Date().toISOString(),

    customer: {
      birthDate: values.birthDate || null,
      postalCode: values.postalCode || null,
      drivingLicenceDate: values.drivingLicenceDate || null,
      usage: values.usage,
    },

    vehicle: {
      registration: values.registration || null,

      make: null,
      model: null,
      version: null,
      firstRegistrationDate: null,
      fuelType: null,
      engineCc: null,
      powerKw: null,

      // O valor só é pedido (e só faz sentido) com danos próprios.
      marketValue: coverages.ownDamage
        ? parseEuroAmount(values.vehicleValue)
        : null,

      annualKm: null,
    },

    claims: buildClaims(values),

    requestedCoverages: {
      // Obrigatória por lei; a UI não a deixa desligar.
      liability: true,

      // "Danos próprios" na UI alimenta os dois campos do domínio.
      ownDamage: coverages.ownDamage,
      collision: coverages.ownDamage,

      fire: coverages.fire,
      theft: coverages.theft,
      glass: coverages.glass,
      assistance: coverages.assistance,
      legalProtection: coverages.legalProtection,

      // Franquia só existe com danos próprios.
      deductible: coverages.ownDamage ? values.deductible : null,
    },

    paymentFrequency: values.paymentFrequency,

    metadata: { origin: "simulador-ui" },
  };
}

function buildClaims(values: AutoFormValues): QuoteRequest["claims"] {
  switch (values.claimsAnswer) {
    case "NONE":
      return {
        claims1Y: 0,
        claims3Y: 0,
        claims5Y: null,
        atFaultClaims3Y: 0,
      };

    case "SOME":
      return {
        claims1Y: null,
        claims3Y: values.claimsCount,
        claims5Y: null,
        atFaultClaims3Y: Math.min(values.atFaultClaims, values.claimsCount),
      };

    case "UNKNOWN":
      return null;
  }
}
