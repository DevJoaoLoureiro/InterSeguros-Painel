import type {
  GeneraliPaymentFrequency,
} from "./types";

export type GeneraliMappedPolicy = {
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
};

function parseDate(
  value: string,
): string | null {
  const clean =
    value.trim();

  if (
    !/^\d{8}$/.test(clean)
  ) {
    return null;
  }

  const year =
    clean.slice(0, 4);

  const month =
    clean.slice(4, 6);

  const day =
    clean.slice(6, 8);

  return `${year}-${month}-${day}`;
}

function parsePaymentFrequency(
  rawCode2: string | null,
): GeneraliPaymentFrequency {
  if (!rawCode2) {
    return null;
  }

  const code =
    rawCode2.slice(-1);

  switch (code) {
    case "A":
      return "ANNUAL";

    case "S":
      return "SEMIANNUAL";

    case "T":
      return "QUARTERLY";

    case "M":
      return "MONTHLY";

    default:
      return null;
  }
}

export function mapGeneraliPolicy(
  raw: string,
): GeneraliMappedPolicy {
  const clientExternalId =
    raw
      .slice(12, 24)
      .trim() ||
    null;

  const externalId =
    raw
      .slice(24, 44)
      .trim() ||
    null;

  const candidateDate1 =
    parseDate(
      raw.slice(
        46,
        54,
      ),
    );

  const candidateDate2 =
    parseDate(
      raw.slice(
        54,
        62,
      ),
    );

  const rawCode1 =
    raw
      .slice(62, 66)
      .trim() ||
    null;

  const rawCode2 =
    raw
      .slice(66, 68)
      .trim() ||
    null;

  const rawStatusCode =
    raw
      .slice(76, 77)
      .trim() ||
    null;

  const rawFrequencyVariant =
    rawCode2
      ? rawCode2.slice(
          0,
          1,
        )
      : null;

  return {
    externalId,
    clientExternalId,

    candidateDate1,
    candidateDate2,

    rawCode1,
    rawCode2,

    paymentFrequency:
      parsePaymentFrequency(
        rawCode2,
      ),

    rawFrequencyVariant,

    rawStatusCode,

    raw,
  };
}