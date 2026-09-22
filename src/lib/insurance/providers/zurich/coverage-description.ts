// =====================================================
// ZURICH - DESCRIÇÕES DE COBERTURA (utilitários de ANÁLISE)
// =====================================================
//
// Funções PURAS para comparar descrições de cobertura entre si
// (variantes, truncagens) sem alterar o valor original guardado.
//
// NÃO CLASSIFICAM. Nada aqui diz se uma cobertura é "RC", "danos
// próprios", "vidros"...: isso exige dados reais de toda a carteira e
// uma decisão humana. Servem para:
//   - chaves de comparação/deduplicação (normalizeCoverageDescription);
//   - inventariar variantes antes de haver qualquer dicionário.
//
// O texto guardado em provider_metadata continua a ser o que a
// Zurich enviou (apenas com trim); a chave normalizada nunca o
// substitui.
// =====================================================

/**
 * Comprimento máximo visto nas descrições reais (ficheiro de coberturas
 * de um dia): 40 caracteres. Descrições com esse comprimento podem estar
 * truncadas pela Zurich (ex.: "Despesas Tratamen/Repatriamento-Condutor").
 * Valor OBSERVADO numa amostra pequena, não um limite documentado.
 */
export const COVERAGE_DESCRIPTION_MAX_OBSERVED_LENGTH = 40;

/**
 * Chave de comparação: sem acentos, minúsculas, espaços colapsados e
 * aparados. Só mexe em espaços, maiúsculas e acentos; não remove
 * pontuação nem palavras, para não juntar coberturas distintas.
 *   "  Quebra de   Vidros " -> "quebra de vidros"
 *   "Incêndio, Raio"        -> "incendio, raio"
 */
export function normalizeCoverageDescription(
  text: string | null | undefined,
): string {
  if (!text) {
    return "";
  }

  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Palavras da chave normalizada (letras/dígitos), para comparar variantes. */
export function tokenizeCoverageDescription(
  text: string | null | undefined,
): string[] {
  return normalizeCoverageDescription(text)
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== "");
}

/**
 * True se a descrição (aparada) tem o comprimento máximo observado ou
 * mais, o que sugere possível truncagem pela Zurich.
 */
export function looksPossiblyTruncated(
  text: string | null | undefined,
  maxLength: number = COVERAGE_DESCRIPTION_MAX_OBSERVED_LENGTH,
): boolean {
  return (text?.trim().length ?? 0) >= maxLength;
}

/**
 * True se uma das descrições, normalizada, é prefixo da outra ao
 * nível da palavra (e não são iguais):
 *   "Quebra de Vidros" / "Quebra de Vidros Essencial"     -> true
 *   "Morte ou Invalidez Permanente" / "... - Condutor"    -> true
 *   "Vidros" / "Vidrosa"                                  -> false
 */
export function isPrefixVariant(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeCoverageDescription(a);
  const nb = normalizeCoverageDescription(b);

  if (na === "" || nb === "" || na === nb) {
    return false;
  }

  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];

  if (!long.startsWith(short)) {
    return false;
  }

  return !/[a-z0-9]/.test(long.charAt(short.length));
}

export type CoverageDescriptionRelation = {
  a: string;
  b: string;

  /**
   * PREFIX: uma é prefixo da outra ao nível da palavra.
   * SHARED_TOKENS: partilham 2 ou mais palavras "de conteúdo" (4+ letras),
   *   o que pode indicar abreviaturas/truncagens da mesma cobertura.
   */
  kind: "PREFIX" | "SHARED_TOKENS";

  sharedTokens: string[];
};

/**
 * Pares de descrições possivelmente relacionadas, APENAS como apoio à
 * revisão humana. Não decide nada nem agrupa automaticamente: o limiar
 * (2 palavras de 4+ letras) é uma heurística de leitura, não uma regra.
 */
export function findCoverageDescriptionRelations(
  descriptions: readonly string[],
): CoverageDescriptionRelation[] {
  const relations: CoverageDescriptionRelation[] = [];

  for (let i = 0; i < descriptions.length; i++) {
    for (let j = i + 1; j < descriptions.length; j++) {
      const a = descriptions[i];
      const b = descriptions[j];

      const tokensA = new Set(
        tokenizeCoverageDescription(a).filter((token) => token.length >= 4),
      );

      const sharedTokens = tokenizeCoverageDescription(b)
        .filter((token) => token.length >= 4 && tokensA.has(token))
        .filter((token, index, all) => all.indexOf(token) === index);

      if (isPrefixVariant(a, b)) {
        relations.push({ a, b, kind: "PREFIX", sharedTokens });
      } else if (sharedTokens.length >= 2) {
        relations.push({ a, b, kind: "SHARED_TOKENS", sharedTokens });
      }
    }
  }

  return relations;
}
