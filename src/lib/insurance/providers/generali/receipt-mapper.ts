export type GeneraliMappedReceipt = {
  externalId: string;

  policyKey: string | null;

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

function parseDate(
  value: string,
): string | null {
  const clean = value.trim();

  if (!/^\d{8}$/.test(clean)) {
    return null;
  }

  const year = Number(
    clean.slice(0, 4),
  );

  const month = Number(
    clean.slice(4, 6),
  );

  const day = Number(
    clean.slice(6, 8),
  );

  if (
    year < 1900 ||
    year > 2100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function parseMoney(
  value: string,
): number | null {
  const clean =
    value.trim();

  if (!clean) {
    return null;
  }

  /*
   * Os campos monetários parecem vir
   * em cêntimos, sem separador decimal.
   *
   * Exemplos:
   *
   * 00000013669 => 136.69
   * 00000012218 => 122.18
   * -00000004423 => -44.23
   *
   * Ainda tratamos os nomes dos campos
   * como "candidate" até confirmar
   * o layout oficial da Generali.
   */

  const normalized =
    clean.replace(/\s/g, "");

  if (
    !/^-?\d+$/.test(normalized)
  ) {
    return null;
  }

  const numeric =
    Number(normalized);

  if (
    !Number.isFinite(numeric)
  ) {
    return null;
  }

  return numeric / 100;
}

function cleanText(
  value: string,
): string | null {
  const clean =
    value.trim();

  return clean || null;
}

export function mapGeneraliReceipt(
  raw: string,
): GeneraliMappedReceipt {
  /*
   * Layout observado nos ficheiros
   * IRECIBOS com registos de 221 chars.
   *
   * IMPORTANTE:
   * As posições estão a ser extraídas
   * estruturalmente a partir dos ficheiros
   * reais.
   *
   * O significado funcional de alguns
   * campos ainda deve ser confirmado
   * com o layout oficial da Generali.
   */

  const externalId =
    raw.slice(47, 61).trim();

  const policyKey =
    cleanText(
      raw.slice(24, 47),
    );

  /*
   * Exemplo observado:
   *
   * 20230804
   * 20240803
   * 20230804
   *
   * Mantemos a nomenclatura abaixo
   * como candidata até confirmação.
   */
  const periodStart =
    parseDate(
      raw.slice(61, 69),
    );

  const periodEnd =
    parseDate(
      raw.slice(69, 77),
    );

  const issueDate =
    parseDate(
      raw.slice(77, 85),
    );

  /*
   * Existe normalmente um código de
   * movimento logo após as datas.
   */
  const rawMovementCode =
    cleanText(
      raw.slice(85, 86),
    );

  /*
   * Os blocos monetários aparecem
   * separados por campos de zeros.
   *
   * Exemplo real:
   *
   * 00000013669
   * 00000012218
   * 00000001433
   */

  const candidateTotalAmount =
    parseMoney(
      raw.slice(98, 109),
    );

  const candidateNetAmount =
    parseMoney(
      raw.slice(122, 133),
    );

  const candidateTaxAmount =
    parseMoney(
      raw.slice(146, 157),
    );

  /*
   * Estes campos finais parecem ser
   * códigos de estado / movimento /
   * cobrança.
   *
   * Ainda não lhes damos significado
   * definitivo sem documentação.
   */

  const rawStatusCode =
    cleanText(
      raw.slice(181, 182),
    );

  const rawCollectionCode =
    cleanText(
      raw.slice(190, 193),
    );

  return {
    externalId,

    policyKey,

    periodStart,
    periodEnd,
    issueDate,

    candidateTotalAmount,
    candidateNetAmount,
    candidateTaxAmount,

    rawMovementCode,
    rawStatusCode,
    rawCollectionCode,

    raw,
  };
}