/*
 * Prepara os dados do cliente enviados por uma companhia para
 * guardar em client_external_refs.provider_metadata: tira espaços,
 * remove campos vazios e datas-sentinela (01-01-1900).
 */
export function compactMetadata(
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined) continue;

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed || trimmed.startsWith("01-01-1900")) continue;
      result[key] = trimmed;
      continue;
    }

    result[key] = value;
  }

  return result;
}
