export type NormalizedPolicy = {
  externalId: string;
  externalVersion: string | null;

  policyNumber: string;

  productCode: string;
  productName: string | null;

  insuranceLineCode: string | null;

  status:
    | "ACTIVE"
    | "PENDING"
    | "CANCELLED"
    | "EXPIRED"
    | "SUSPENDED"
    | "REDUCED"
    | "UNKNOWN";

  issueDate: string | null;
  startDate: string | null;
  renewalDate: string | null;

  commercialPremium: number | null;
  totalPremium: number | null;
  annualizedPremium: number | null;

  paymentFrequency:
    | "ANNUAL"
    | "SEMIANNUAL"
    | "QUARTERLY"
    | "MONTHLY"
    | "SINGLE"
    | "OTHER"
    | "UNKNOWN";

  agentCode: string | null;
  agentName: string | null;
  teamName: string | null;

  storeExternalCode: string | null;

  client: {
    name: string;
    nif: string | null;
    birthDate: string | null;
    street: string | null;
    postalCode: string | null;
    city: string | null;
  };

  providerMetadata: Record<string, unknown>;
};
