/*
 * Testes da cotação real Zurich como valor principal (sem BD nem rede).
 *
 *   npx tsc --outDir <tmp> --module commonjs --moduleResolution node10 \
 *     --target es2022 --strict --skipLibCheck --esModuleInterop --types node \
 *     src/lib/quoting/observations/__tests__/real-quote.test.ts
 *   node --test <tmp>/quoting/observations/__tests__/real-quote.test.js
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EstimatedQuote, QuoteComparison, QuoteRequest } from "../../domain/types";
import {
  REAL_QUOTE_VALIDITY_DAYS,
  attachZurichRealQuote,
  findMatchingRealQuote,
  realQuoteToFirmQuote,
  requestIdentity,
} from "../real-quote-match";
import type { DuplicateCandidate, ObservationStore } from "../types";

const NOW = new Date("2026-09-21T16:00:00.000Z");
const DAY = 86_400_000;

function makeRequest(overrides: Partial<QuoteRequest> = {}): QuoteRequest {
  return {
    requestId: "req-1",
    clientId: null,
    productLine: "AUTO",
    requestedAt: NOW.toISOString(),
    customer: {
      birthDate: "2006-01-15",
      postalCode: "4700-100",
      drivingLicenceDate: "2024-12-01",
      usage: "PRIVATE",
    },
    vehicle: {
      registration: "ab 12 cd",
      make: null,
      model: null,
      version: null,
      firstRegistrationDate: null,
      fuelType: null,
      engineCc: null,
      powerKw: null,
      marketValue: null,
      annualKm: null,
    },
    claims: null,
    requestedCoverages: {
      liability: true,
      ownDamage: false,
      collision: false,
      fire: false,
      theft: false,
      glass: false,
      assistance: false,
      legalProtection: false,
      deductible: null,
    },
    paymentFrequency: "ANNUAL",
    ...overrides,
  };
}

let counter = 0;

function candidate(overrides: Partial<DuplicateCandidate> = {}): DuplicateCandidate {
  counter += 1;

  return {
    id: `obs-${counter}`,
    created_at: new Date(NOW.getTime() - 2 * DAY).toISOString(),
    quoted_at: new Date(NOW.getTime() - 2 * DAY).toISOString(),
    status: "VALID",
    vehicle_registration: "AB-12-CD",
    birth_date: "2006-01-15",
    driving_licence_date: "2024-12-01",
    postal_code: "4700-100",
    coverage_tier: "RC",
    deductible: null,
    payment_frequency: "ANNUAL",
    real_product_code: "5324",
    real_product_name: "Zurich Auto",
    real_quote_reference: "SIM-1",
    real_quote_amount: 1262.55,
    real_quote_basis: "ANNUAL",
    source: "MANUAL_ENTRY",
    ...overrides,
  };
}

function estimated(): EstimatedQuote {
  return {
    insurerCode: "ZURICH",
    insurerName: "Zurich",
    productLine: "AUTO",
    reasons: [],
    warnings: [],
    generatedAt: NOW.toISOString(),
    status: "ESTIMATED",
    source: "INTERNAL_MODEL",
    premiumBasis: "ANNUAL_TOTAL",
    pointEstimate: 362,
    priceRange: { min: 255, max: 538 },
    confidence: "LOW",
    comparablePolicies: 12,
    modelVersion: "zurich-auto-v3",
  };
}

function comparison(): QuoteComparison {
  return {
    requestId: "req-1",
    productLine: "AUTO",
    results: [estimated()],
    cheapestEstimated: estimated(),
    cheapestFirm: null,
    warnings: [],
    generatedAt: NOW.toISOString(),
  };
}

describe("cotação real Zurich do mesmo pedido", () => {
  it("o mesmo pedido encontra a cotação real guardada (matrícula normalizada)", () => {
    const match = findMatchingRealQuote(makeRequest(), [candidate()], NOW);

    assert.ok(match);
    assert.equal(match.amount, 1262.55);
    assert.equal(match.reference, "SIM-1");
    assert.equal(match.ageDays, 2);
    assert.equal(requestIdentity(makeRequest()).plate, "AB-12-CD");
  });

  it("qualquer diferença no pedido impede a correspondência", () => {
    const base = makeRequest();

    const different: [string, DuplicateCandidate][] = [
      ["matrícula", candidate({ vehicle_registration: "ZZ-99-ZZ" })],
      ["nascimento", candidate({ birth_date: "1990-01-01" })],
      ["código postal", candidate({ postal_code: "4800-000" })],
      ["carta", candidate({ driving_licence_date: "2020-01-01" })],
      ["carta desconhecida de um lado", candidate({ driving_licence_date: null })],
      ["cobertura", candidate({ coverage_tier: "OWN_DAMAGE" })],
      ["franquia", candidate({ deductible: 500 })],
      ["fracionamento", candidate({ payment_frequency: "MONTHLY" })],
    ];

    for (const [label, other] of different) {
      assert.equal(findMatchingRealQuote(base, [other], NOW), null, label);
    }

    // Franquia igual (danos próprios) corresponde.
    const own = makeRequest();

    own.requestedCoverages = { ...own.requestedCoverages, ownDamage: true, collision: true, deductible: 500 };

    assert.ok(findMatchingRealQuote(own, [candidate({ coverage_tier: "OWN_DAMAGE", deductible: 500 })], NOW));
    assert.equal(findMatchingRealQuote(own, [candidate({ coverage_tier: "OWN_DAMAGE", deductible: 750 })], NOW), null);
  });

  it("uma cotação real expira (as tarifas mudam)", () => {
    const at = (days: number) => candidate({ quoted_at: new Date(NOW.getTime() - days * DAY).toISOString() });

    assert.ok(findMatchingRealQuote(makeRequest(), [at(REAL_QUOTE_VALIDITY_DAYS - 1)], NOW));
    assert.equal(findMatchingRealQuote(makeRequest(), [at(REAL_QUOTE_VALIDITY_DAYS + 1)], NOW), null);
    assert.equal(findMatchingRealQuote(makeRequest(), [at(-10)], NOW), null, "do futuro não conta");
    assert.equal(findMatchingRealQuote(makeRequest(), [candidate({ quoted_at: "lixo" })], NOW), null);
  });

  it("só estados válidos e bases comparáveis com um prémio anual", () => {
    for (const status of ["TEST", "DUPLICATE", "INVALID", "INCOMPLETE", "EXPIRED"] as const) {
      assert.equal(findMatchingRealQuote(makeRequest(), [candidate({ status })], NOW), null, status);
    }

    assert.ok(findMatchingRealQuote(makeRequest(), [candidate({ status: "MANUAL_OVERRIDE" })], NOW));
    assert.equal(findMatchingRealQuote(makeRequest(), [candidate({ real_quote_basis: "INSTALLMENT" })], NOW), null);
    assert.equal(findMatchingRealQuote(makeRequest(), [candidate({ real_quote_basis: "COMMERCIAL" })], NOW), null);
    assert.ok(findMatchingRealQuote(makeRequest(), [candidate({ real_quote_basis: "TOTAL" })], NOW));
    assert.ok(findMatchingRealQuote(makeRequest(), [candidate({ real_quote_basis: "UNKNOWN" })], NOW));
    assert.equal(findMatchingRealQuote(makeRequest(), [candidate({ real_quote_amount: 0 })], NOW), null);
  });

  it("com várias, usa a mais recente", () => {
    const older = candidate({ quoted_at: new Date(NOW.getTime() - 10 * DAY).toISOString(), real_quote_amount: 1100 });
    const newer = candidate({ quoted_at: new Date(NOW.getTime() - 1 * DAY).toISOString(), real_quote_amount: 1300 });

    assert.equal(findMatchingRealQuote(makeRequest(), [older, newer], NOW)?.amount, 1300);
  });

  it("a cotação real vira uma FirmQuote manual, com o valor da Zurich e sem esconder avisos", () => {
    const match = findMatchingRealQuote(makeRequest(), [candidate()], NOW)!;
    const firm = realQuoteToFirmQuote(match, NOW);

    assert.equal(firm.status, "FIRM");
    assert.equal(firm.source, "MANUAL");
    assert.equal(firm.insurerCode, "ZURICH");
    assert.equal(firm.premium, 1262.55);
    assert.equal(firm.premiumBasis, "ANNUAL_TOTAL");
    assert.equal(firm.externalReference, "SIM-1");
    assert.equal(Date.parse(firm.validUntil as string), Date.parse(match.quotedAt) + REAL_QUOTE_VALIDITY_DAYS * DAY);
    assert.ok(firm.warnings.some((w) => w.includes("Não é uma proposta vinculativa")));
    assert.ok(firm.reasons.some((r) => r.includes("portal da Zurich")));

    const unknown = realQuoteToFirmQuote(findMatchingRealQuote(makeRequest(), [candidate({ real_quote_basis: "UNKNOWN" })], NOW)!, NOW);

    assert.equal(unknown.premiumBasis, "UNKNOWN");
    assert.ok(unknown.warnings.some((w) => w.includes("não foi confirmada")));

    const total = realQuoteToFirmQuote(findMatchingRealQuote(makeRequest(), [candidate({ real_quote_basis: "TOTAL" })], NOW)!, NOW);

    assert.equal(total.totalPremium, 1262.55);
  });
});

describe("attachZurichRealQuote", () => {
  const storeOf = (rows: DuplicateCandidate[]): Pick<ObservationStore, "findDuplicateCandidates"> => ({
    async findDuplicateCandidates() {
      return rows;
    },
  });

  it("a cotação real fica à frente e a estimativa interna continua ao lado", async () => {
    const { comparison: result, match } = await attachZurichRealQuote(makeRequest(), comparison(), storeOf([candidate()]), NOW);

    assert.ok(match);
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].status, "FIRM", "o valor real da Zurich é o principal");
    assert.equal(result.results[1].status, "ESTIMATED");
    assert.equal((result.results[1] as EstimatedQuote).pointEstimate, 362, "a estimativa base não muda");
    assert.equal(result.cheapestFirm?.premium, 1262.55);
  });

  it("sem cotação real correspondente a comparação fica intacta", async () => {
    const original = comparison();
    const { comparison: result, match } = await attachZurichRealQuote(makeRequest(), original, storeOf([candidate({ postal_code: "1000-001" })]), NOW);

    assert.equal(match, null);
    assert.equal(result, original);
  });

  it("uma falha da BD nunca parte o cálculo", async () => {
    const original = comparison();
    const failing: Pick<ObservationStore, "findDuplicateCandidates"> = {
      async findDuplicateCandidates() {
        throw new Error("falha com dados pessoais");
      },
    };

    const { comparison: result, match } = await attachZurichRealQuote(makeRequest(), original, failing, NOW);

    assert.equal(match, null);
    assert.equal(result, original);
  });

  it("sem matrícula válida nem se consulta a BD", async () => {
    let calls = 0;
    const store: Pick<ObservationStore, "findDuplicateCandidates"> = {
      async findDuplicateCandidates() {
        calls += 1;

        return [];
      },
    };
    const request = makeRequest();

    request.vehicle = { ...request.vehicle!, registration: "12" };

    await attachZurichRealQuote(request, comparison(), store, NOW);

    assert.equal(calls, 0);
  });
});
