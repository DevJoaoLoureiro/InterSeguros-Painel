/*
 * Testes do backfill retroativo de ground truth (sem BD nem rede).
 *
 *   npx tsc --outDir <tmp> --module commonjs --moduleResolution node10 \
 *     --target es2022 --strict --skipLibCheck --esModuleInterop --types node \
 *     src/lib/quoting/models/zurich/calibration/__tests__/retroactive-backfill.test.ts
 *   node --test <tmp>/quoting/models/zurich/calibration/__tests__/retroactive-backfill.test.js
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { calibrateZurichEstimate } from "../zurich-quote-calibration";
import { buildRetroactiveObservations } from "../retroactive-backfill";
import { findMatchingRealQuote } from "../../../../observations/real-quote-match";
import type { CalibrationRow, DuplicateCandidate } from "../../../../observations/types";
import type { HistoricalPolicyInput } from "../../zurich-auto-features";
import type { QuoteRequest } from "../../../../domain/types";

const NOW = new Date("2026-09-22T10:00:00.000Z");

let counter = 0;

/**
 * Uma apólice Auto RC "normal": confirmada por recibo (recibo = 1x o prémio
 * anual, período de 364 dias), cliente diferente a cada chamada por omissão.
 */
function policy(overrides: Partial<HistoricalPolicyInput> = {}): HistoricalPolicyInput {
  counter += 1;

  const premium = overrides.annualizedPremium ?? 300 + (counter % 7) * 10;

  return {
    // Precisam de ser UUIDs válidos: buildObservationInsert valida-os (em
    // produção vêm sempre de policies.id / policies.client_id, reais).
    id: randomUUID(),
    groupKey: randomUUID(),
    productCode: "5324",
    productName: "Zurich Auto",
    status: "ACTIVE",
    startDate: "2026-03-01",
    annualizedPremium: premium,
    totalPremium: premium,
    paymentFrequency: "ANNUAL",
    lastSyncedAt: "2026-09-20T12:00:00.000Z",
    providerMetadata: {
      insuredObjects: [{ number: "1", type: "Viatura", status: "Em vigor", description: "Peugeot 208" }],
      coverages: [
        { objectNumber: "1", description: "Responsabilidade Civil", capital: 7750000 },
      ],
    },
    holderBirthDate: "1990-01-01",
    holderPostalCode: "4700-100",
    receipts: [
      {
        type: "Novo",
        status: "PAID",
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        totalPremium: premium as number,
      },
    ],
    ...overrides,
  };
}

/** Carteira com `n` apólices RC de clientes DIFERENTES (bons comparáveis entre si). */
function portfolio(n: number): HistoricalPolicyInput[] {
  return Array.from({ length: n }, () => policy());
}

describe("buildRetroactiveObservations", () => {
  it("com carteira suficiente, produz linhas marcadas RETROACTIVE_PORTFOLIO", () => {
    const result = buildRetroactiveObservations(portfolio(20), "zurich-auto-v3", NOW);

    assert.ok(result.rows.length > 0, "deveria produzir pelo menos uma linha");
    assert.equal(result.confirmedPolicies, 20);

    for (const row of result.rows) {
      assert.equal(
        (row.insurer_quote_snapshot as { source?: string }).source,
        "RETROACTIVE_PORTFOLIO",
      );
      assert.equal(row.status, "VALID");
      assert.ok(row.policy_id, "cada linha identifica a apólice de origem");
      assert.equal(row.real_quote_basis, "ANNUAL");
      assert.ok(row.real_quote_amount > 0);
      assert.ok(row.estimated_premium > 0);
      // Nunca finge saber o que nunca existiu no histórico.
      assert.equal(row.driving_licence_date, null);
    }
  });

  it("é leave-one-CLIENT-out: uma carteira de um só cliente não gera nada (sem comparáveis)", () => {
    const onlyClient = Array.from({ length: 15 }, () => policy({ groupKey: "same-client" }));
    const result = buildRetroactiveObservations(onlyClient, "zurich-auto-v3", NOW);

    assert.equal(result.rows.length, 0);
    assert.equal(result.skippedInsufficientComparables, result.confirmedPolicies);
  });

  it("só apólices com prémio CONFIRMADO por recibo viram ground truth", () => {
    const noReceipt = policy({ receipts: [] }); // PROBABLE, não CONFIRMED
    const wrongReceipt = policy({
      receipts: [
        {
          type: "Novo",
          status: "PAID",
          periodStart: "2026-01-01",
          periodEnd: "2026-12-31",
          totalPremium: 9999,
        },
      ],
    }); // INCONSISTENT

    const withRest = [...portfolio(19), noReceipt, wrongReceipt];
    const result = buildRetroactiveObservations(withRest, "zurich-auto-v3", NOW);

    assert.equal(result.confirmedPolicies, 19);
    assert.ok(!result.rows.some((row) => row.policy_id === noReceipt.id));
    assert.ok(!result.rows.some((row) => row.policy_id === wrongReceipt.id));
  });

  it("apólices de tiers diferentes só se comparam com o mesmo tier (mesma regra do modelo ao vivo)", () => {
    const ownDamage = (n: number) =>
      Array.from({ length: n }, () =>
        policy({
          providerMetadata: {
            insuredObjects: [{ number: "1", type: "Viatura", status: "Em vigor", description: "BMW 320d" }],
            coverages: [
              { objectNumber: "1", description: "Responsabilidade Civil", capital: 7750000 },
              { objectNumber: "1", description: "Zurich-Choque Colisão Cap.Inc.Raio Explo", capital: 22000 },
            ],
          },
          annualizedPremium: 900,
        }),
      );

    const mixed = [...portfolio(15), ...ownDamage(15)];
    const result = buildRetroactiveObservations(mixed, "zurich-auto-v3", NOW);

    // Ambos os grupos têm carteira suficiente do seu próprio tier.
    assert.ok(result.rows.length >= 20);
  });

  it("a versão do modelo gravada é a passada como parâmetro", () => {
    const result = buildRetroactiveObservations(portfolio(15), "zurich-auto-v9", NOW);

    assert.ok(result.rows.length > 0);
    assert.ok(
      result.rows.every(
        (row) => (row.prediction_snapshot as { modelVersion: string }).modelVersion === "zurich-auto-v9",
      ),
    );
  });

  it("a apólice em si nunca é o seu próprio comparável (sem fuga de dados)", () => {
    // Duas cópias do MESMO risco, mas de clientes diferentes: uma é boa
    // comparável da outra; sozinha (client único), nenhuma seria.
    // groupKey por omissão (randomUUID): a e b só precisam de ser clientes DIFERENTES.
    const a = policy({ annualizedPremium: 500 });
    const b = policy({ annualizedPremium: 500 });
    const rest = portfolio(18);

    const result = buildRetroactiveObservations([a, b, ...rest], "zurich-auto-v3", NOW);
    const rowA = result.rows.find((row) => row.policy_id === a.id);

    assert.ok(rowA, "a devia ter comparáveis (b e o resto da carteira)");
  });
});

describe("as linhas retroativas nunca calibram o valor principal", () => {
  function toCalibrationRow(insert: ReturnType<typeof buildRetroactiveObservations>["rows"][number]): CalibrationRow {
    return {
      id: insert.policy_id as string,
      status: insert.status,
      source: (insert.insurer_quote_snapshot as { source: "RETROACTIVE_PORTFOLIO" }).source,
      model_version: insert.model_version,
      quoted_at: insert.quoted_at,
      birth_date: insert.birth_date,
      driving_licence_date: insert.driving_licence_date,
      postal_code: insert.postal_code,
      usage_type: insert.usage_type,
      coverage_tier: insert.coverage_tier,
      deductible: insert.deductible,
      payment_frequency: insert.payment_frequency,
      real_product_code: insert.real_product_code,
      real_product_name: insert.real_product_name,
      real_quote_basis: insert.real_quote_basis,
      estimated_premium: insert.estimated_premium,
      real_quote_amount: insert.real_quote_amount,
      request_snapshot: insert.request_snapshot,
      prediction_snapshot: insert.prediction_snapshot,
    };
  }

  it("classify() rejeita-as com o motivo 'retroactive', mesmo havendo muitas", () => {
    const built = buildRetroactiveObservations(portfolio(30), "zurich-auto-v3", NOW);

    assert.ok(built.rows.length >= 10, "precisa de linhas suficientes para o teste fazer sentido");

    const rows = built.rows.map(toCalibrationRow);

    const request: QuoteRequest = {
      requestId: "r",
      clientId: null,
      productLine: "AUTO",
      requestedAt: NOW.toISOString(),
      customer: { birthDate: "1990-01-01", postalCode: "4700-100", drivingLicenceDate: null, usage: "PRIVATE" },
      vehicle: null,
      claims: null,
      requestedCoverages: {
        liability: true, ownDamage: false, collision: false, fire: false, theft: false,
        glass: false, assistance: false, legalProtection: false, deductible: null,
      },
      paymentFrequency: "ANNUAL",
    };

    const calibration = calibrateZurichEstimate({
      request,
      baseEstimate: 320,
      modelVersion: "zurich-auto-v3",
      observations: rows,
      now: NOW,
    });

    assert.equal(calibration.mode, "NONE", "nenhuma observação de verdade: não há calibração");
    assert.equal(calibration.diagnostics.rejected.retroactive, rows.length);
    assert.equal(calibration.diagnostics.consideredObservations, 0);
    assert.equal(calibration.calibratedEstimate, 320, "a base fica intacta");
  });

  it("uma cotação real genuína continua a calibrar, mesmo com dezenas de linhas retroativas ao lado", () => {
    const built = buildRetroactiveObservations(portfolio(30), "zurich-auto-v3", NOW);
    const retroactiveRows = built.rows.map(toCalibrationRow);

    const genuine: CalibrationRow = {
      ...retroactiveRows[0],
      id: "genuine-1",
      source: "MANUAL_ENTRY",
      real_quote_amount: 900,
      coverage_tier: "RC",
    };

    const request: QuoteRequest = {
      requestId: "r",
      clientId: null,
      productLine: "AUTO",
      requestedAt: NOW.toISOString(),
      customer: { birthDate: "1990-01-01", postalCode: "4700-100", drivingLicenceDate: null, usage: "PRIVATE" },
      vehicle: null,
      claims: null,
      requestedCoverages: {
        liability: true, ownDamage: false, collision: false, fire: false, theft: false,
        glass: false, assistance: false, legalProtection: false, deductible: null,
      },
      paymentFrequency: "ANNUAL",
    };

    const calibration = calibrateZurichEstimate({
      request,
      baseEstimate: 320,
      modelVersion: "zurich-auto-v3",
      observations: [...retroactiveRows, genuine],
      now: NOW,
    });

    assert.notEqual(calibration.mode, "NONE");
    assert.equal(calibration.sampleSize, 1, "só a genuína entra, nenhuma das retroativas");
    assert.equal(calibration.diagnostics.rejected.retroactive, retroactiveRows.length);
  });
});

describe("linhas retroativas nunca aparecem como 'cotação real do portal'", () => {
  it("findMatchingRealQuote ignora candidatos RETROACTIVE_PORTFOLIO mesmo que tudo o resto coincida", () => {
    const request: QuoteRequest = {
      requestId: "r",
      clientId: null,
      productLine: "AUTO",
      requestedAt: NOW.toISOString(),
      customer: { birthDate: "1998-03-14", postalCode: "4700-100", drivingLicenceDate: "2018-06-01", usage: "PRIVATE" },
      vehicle: { registration: "AB-12-CD", make: null, model: null, version: null, firstRegistrationDate: null, fuelType: null, engineCc: null, powerKw: null, marketValue: null, annualKm: null },
      claims: null,
      requestedCoverages: {
        liability: true, ownDamage: false, collision: false, fire: false, theft: false,
        glass: false, assistance: false, legalProtection: false, deductible: null,
      },
      paymentFrequency: "ANNUAL",
    };

    const retroactive: DuplicateCandidate = {
      id: "retro-1",
      created_at: NOW.toISOString(),
      quoted_at: NOW.toISOString(),
      status: "VALID",
      source: "RETROACTIVE_PORTFOLIO",
      vehicle_registration: "AB-12-CD",
      birth_date: "1998-03-14",
      driving_licence_date: "2018-06-01",
      postal_code: "4700-100",
      coverage_tier: "RC",
      deductible: null,
      payment_frequency: "ANNUAL",
      real_product_code: "5324",
      real_product_name: "Zurich Auto",
      real_quote_reference: null,
      real_quote_amount: 350,
      real_quote_basis: "ANNUAL",
    };

    assert.equal(findMatchingRealQuote(request, [retroactive], NOW), null);

    const genuine: DuplicateCandidate = { ...retroactive, id: "manual-1", source: "MANUAL_ENTRY" };

    assert.ok(findMatchingRealQuote(request, [retroactive, genuine], NOW));
  });
});
