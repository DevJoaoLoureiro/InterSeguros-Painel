import { readFileSync } from "node:fs";

import {
  extractZurichHistoricalFeatures,
  isEligibleHistorical,
  type HistoricalPolicyInput,
  type ZurichHistoricalFeatures,
} from "../zurich-auto-features";

/*
 * Adaptador do dump DES-IDENTIFICADO da carteira (extract-dataset.cjs) para
 * as estruturas do modelo. Só para validação/dev: nada aqui corre em
 * produção nem lê a BD.
 */

type DumpReceipt = {
  type: string | null;
  status: string | null;
  ps: string | null;
  pe: string | null;
  total: number | null;
};

type DumpPolicy = {
  i: number;
  client: number | null;
  productCode: string | null;
  productName: string | null;
  status: string | null;
  start: string | null;
  annualized: number | null;
  total: number | null;
  freq: string | null;
  lastSyncedAt: string | null;
  birthDate: string | null;
  postal4: string | null;
  meta: unknown;
  receipts: DumpReceipt[];
};

export type LoadedDataset = {
  referenceDate: Date;
  all: ZurichHistoricalFeatures[];
  eligible: ZurichHistoricalFeatures[];
};

const isAuto = (policy: DumpPolicy): boolean =>
  /auto/i.test(policy.productName ?? "") ||
  ["5324", "5907", "5910"].includes(policy.productCode ?? "");

export function loadDataset(path: string): LoadedDataset {
  const dump = JSON.parse(readFileSync(path, "utf8")) as {
    extractedAt: string;
    policies: DumpPolicy[];
  };

  const referenceDate = new Date(dump.extractedAt);

  const inputs: HistoricalPolicyInput[] = dump.policies
    .filter(isAuto)
    .map((policy) => ({
      id: `p${policy.i}`,
      groupKey: policy.client === null ? null : `c${policy.client}`,
      productCode: policy.productCode,
      productName: policy.productName,
      status: policy.status,
      startDate: policy.start,
      annualizedPremium: policy.annualized,
      totalPremium: policy.total,
      paymentFrequency: policy.freq,
      lastSyncedAt: policy.lastSyncedAt,
      providerMetadata: policy.meta,
      holderBirthDate: policy.birthDate,
      holderPostalCode: policy.postal4,
      receipts: policy.receipts.map((receipt) => ({
        type: receipt.type,
        status: receipt.status,
        periodStart: receipt.ps,
        periodEnd: receipt.pe,
        totalPremium: receipt.total,
      })),
    }));

  const all = inputs.map((input) =>
    extractZurichHistoricalFeatures(input, referenceDate),
  );

  return { referenceDate, all, eligible: all.filter(isEligibleHistorical) };
}

export { requestFeaturesFromHistorical as requestFromHistorical } from "../zurich-auto-features";
