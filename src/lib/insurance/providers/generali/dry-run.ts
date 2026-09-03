import {
  GeneraliDryRunClient,
  GeneraliDryRunResult,
  GeneraliParsedFile,
} from "./types";

import {
  mapGeneraliPolicy,
} from "./policy-mapper";

import {
  mapGeneraliReceipt,
} from "./receipt-mapper";

function getFilesByType(
  files: GeneraliParsedFile[],
  type: string,
) {
  return files.filter(
    (file) =>
      file.type === type
  );
}

function getRecordsByType(
  files: GeneraliParsedFile[],
  type: string,
) {
  return getFilesByType(
    files,
    type,
  ).flatMap(
    (file) =>
      file.records
  );
}

function buildReceiptPolicyKey(
  externalId: string | null,
): string | null {
  if (!externalId) {
    return null;
  }

  if (
    externalId.length < 8
  ) {
    return null;
  }

  /*
   * Exemplo:
   *
   * policy:
   * 3243240010214401201
   *
   * receipt reference:
   * 00324001021440120
   *
   * Conversão observada nos ficheiros Generali:
   *
   * "00"
   * + primeiros 3 caracteres
   * + caracteres a partir da posição 6
   *   excluindo o último
   */
  return (
    "00" +
    externalId.slice(0, 3) +
    externalId.slice(6, -1)
  );
}

export function buildGeneraliDryRun(
  files: GeneraliParsedFile[],
): GeneraliDryRunResult {
  const clientRecords =
    getRecordsByType(
      files,
      "CLIENTES",
    );

  const policiesV =
    getRecordsByType(
      files,
      "POLIZASV",
    );

  const policiesA =
    getRecordsByType(
      files,
      "POLIZASA",
    );

  const receiptRecords =
    getRecordsByType(
      files,
      "RECIBOS",
    );

  const clientMap =
    new Map<
      string,
      GeneraliDryRunClient
    >();

  /*
   * CLIENTES
   *
   * 0-11   BCN
   * 12-23  ID externo cliente
   * 24-103 Nome
   */
  for (
    const record
    of clientRecords
  ) {
    const externalId =
      record.raw
        .slice(12, 24)
        .trim() ||
      null;

    const name =
      record.raw
        .slice(24, 104)
        .trim() ||
      null;

    if (!externalId) {
      continue;
    }

    if (
      !clientMap.has(
        externalId,
      )
    ) {
      clientMap.set(
        externalId,
        {
          externalId,
          name,
          raw:
            record.raw,
          policies: [],
        },
      );
    }
  }

  /*
   * Permite encontrar uma
   * apólice a partir da referência
   * presente nos recibos.
   */
  const policyMap =
    new Map<
      string,
      {
        clientExternalId:
          string;
        policy:
          GeneraliDryRunClient["policies"][number];
      }
    >();

  let unmatchedPolicies =
    0;

  function processPolicies(
    records:
      typeof policiesV,
    source:
      | "POLIZASV"
      | "POLIZASA",
  ) {
    for (
      const record
      of records
    ) {
      const mappedPolicy =
        mapGeneraliPolicy(
          record.raw,
        );

      const clientExternalId =
        mappedPolicy
          .clientExternalId;

      if (
        !clientExternalId
      ) {
        unmatchedPolicies++;
        continue;
      }

      const client =
        clientMap.get(
          clientExternalId,
        );

      if (!client) {
        unmatchedPolicies++;
        continue;
      }

      const policy:
        GeneraliDryRunClient["policies"][number] =
      {
        source,

        externalId:
          mappedPolicy
            .externalId,

        clientExternalId:
          mappedPolicy
            .clientExternalId,

        candidateDate1:
          mappedPolicy
            .candidateDate1,

        candidateDate2:
          mappedPolicy
            .candidateDate2,

        rawCode1:
          mappedPolicy
            .rawCode1,

        rawCode2:
          mappedPolicy
            .rawCode2,

        paymentFrequency:
          mappedPolicy
            .paymentFrequency,

        rawFrequencyVariant:
          mappedPolicy
            .rawFrequencyVariant,

        rawStatusCode:
          mappedPolicy
            .rawStatusCode,

        raw:
          mappedPolicy
            .raw,

        receipts: [],
      };

      client.policies.push(
        policy,
      );

      const receiptPolicyKey =
        buildReceiptPolicyKey(
          mappedPolicy
            .externalId,
        );

      if (
        receiptPolicyKey
      ) {
        policyMap.set(
          receiptPolicyKey,
          {
            clientExternalId,
            policy,
          },
        );
      }
    }
  }

  processPolicies(
    policiesV,
    "POLIZASV",
  );

  processPolicies(
    policiesA,
    "POLIZASA",
  );

  let unmatchedReceipts =
    0;

  /*
   * RECIBOS
   *
   * 12-23  Cliente
   * 24-46  Referência apólice
   * 47-60  ID recibo
   */
  for (
    const record
    of receiptRecords
  ) {
    const clientExternalId =
      record.raw
        .slice(12, 24)
        .trim();

    const policyKey =
      record.raw
        .slice(24, 47)
        .trim();

    const matchedPolicy =
      policyMap.get(
        policyKey,
      );

    if (
      !matchedPolicy ||
      matchedPolicy
        .clientExternalId !==
        clientExternalId
    ) {
      unmatchedReceipts++;
      continue;
    }

    const mappedReceipt =
      mapGeneraliReceipt(
        record.raw,
      );

    matchedPolicy
      .policy
      .receipts
      .push({
        externalId:
          mappedReceipt
            .externalId,

        periodStart:
          mappedReceipt
            .periodStart,

        periodEnd:
          mappedReceipt
            .periodEnd,

        issueDate:
          mappedReceipt
            .issueDate,

        candidateTotalAmount:
          mappedReceipt
            .candidateTotalAmount,

        candidateNetAmount:
          mappedReceipt
            .candidateNetAmount,

        candidateTaxAmount:
          mappedReceipt
            .candidateTaxAmount,

        rawMovementCode:
          mappedReceipt
            .rawMovementCode,

        rawStatusCode:
          mappedReceipt
            .rawStatusCode,

        rawCollectionCode:
          mappedReceipt
            .rawCollectionCode,

        raw:
          mappedReceipt
            .raw,
      });
  }

  return {
    stats: {
      clients:
        clientRecords.length,

      policiesV:
        policiesV.length,

      policiesA:
        policiesA.length,

      receipts:
        receiptRecords.length,
    },

    clients:
      [...clientMap.values()],

    unmatched: {
      policies:
        unmatchedPolicies,

      receipts:
        unmatchedReceipts,
    },
  };
}