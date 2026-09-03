export type GeneraliRawRecord = {
  lineNumber: number;
  raw: string;
  length: number;
};

export type GeneraliParsedFile = {
  filename: string;
  type: string;
  records: GeneraliRawRecord[];
};

export type GeneraliPaymentFrequency =
  | "ANNUAL"
  | "SEMIANNUAL"
  | "QUARTERLY"
  | "MONTHLY"
  | null;

export type GeneraliDryRunReceipt = {
  externalId: string | null;

  periodStart: string | null;
  periodEnd: string | null;
  issueDate: string | null;

  candidateTotalAmount: number | null;
  candidateNetAmount: number | null;
  candidateTaxAmount: number | null;

  rawMovementCode: string | null;
  rawStatusCode: string | null;
  rawCollectionCode: string | null;

  raw: string;
};

export type GeneraliDryRunPolicy = {
  source:
    | "POLIZASV"
    | "POLIZASA";

  externalId: string | null;
  clientExternalId: string | null;

  candidateDate1: string | null;
  candidateDate2: string | null;

  rawCode1: string | null;
  rawCode2: string | null;

  paymentFrequency:
    GeneraliPaymentFrequency;

  rawFrequencyVariant:
    string | null;

  rawStatusCode:
    string | null;

  raw: string;

  receipts:
    GeneraliDryRunReceipt[];
};

export type GeneraliDryRunClient = {
  externalId: string | null;
  name: string | null;
  raw: string;

  policies:
    GeneraliDryRunPolicy[];
};

export type GeneraliDryRunResult = {
  stats: {
    clients: number;
    policiesV: number;
    policiesA: number;
    receipts: number;
  };

  clients:
    GeneraliDryRunClient[];

  unmatched: {
    policies: number;
    receipts: number;
  };
};