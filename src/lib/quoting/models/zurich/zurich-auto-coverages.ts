import { normalizeCoverageDescription } from "../../../insurance/providers/zurich/coverage-description";

/*
 * Camada central: descrição de cobertura Zurich -> tipo de cobertura.
 *
 * As regras foram escritas a partir das 31 descrições REAIS existentes na
 * carteira Zurich Auto (auditoria de 116 apólices), não por imaginação.
 * Descrições vistas (n = apólices que a têm):
 *
 *   Responsabilidade Civil (116) | Responsabilidad Civil Seguro Facultativo (5)
 *   Limite Danos Corporais/Materiais, por Acidente (116)
 *   Defesa e Proteção Jurídica (110)
 *   Assistência Viagem (93) | ... até 3500Kg (18) | ... Veículos de 2 Rodas (3)
 *     | Assistência em Viagem Essencial (1)
 *   Despesas de Tratamento e Repatriamento (82) | Despesas Tratamen/
 *     Repatriamento-Condutor (28)
 *   Morte ou Invalidez Permanente (72) [+ "- Condutor" (28)] | Morte (10)
 *     | Invalidez Permanente (10) | Incapacidade Temporária (11)
 *     | Despesas de Funeral (14)
 *   Quebra de Vidros (66) | Quebra de Vidros Essencial (22)
 *     | Quebra Vidros - Vidro Fabricante Veículo (8)
 *   Zurich-Choque Colisão Cap.Inc.Raio Explo (19)
 *     | Choque,Colisão,Capot,Incên,Raio Explosão (1)      <- danos próprios
 *   Furto ou Roubo (26) | Incêndio, Raio ou Explosão (6)
 *   Riscos Catastróficos [da] Natureza (25) | Greves,Tumultos,... (25)
 *   Atos Terrorismo, Vandalismo, Sabotagem (19)
 *   Veíc.Substituição Sinistro ... (2) | Adaptação de Veículo e/ou de
 *     Residência (3)
 *
 * Correspondência TOLERANTE (sem acentos, maiúsculas, espaços, pequenas
 * variações/truncagens da Zurich) mas NÃO difusa: cada regra é uma
 * expressão explícita. Descrição não reconhecida -> kind null (fica em
 * `unclassified` para diagnóstico; nunca se adivinha).
 *
 * DANOS PRÓPRIOS = cobertura de Choque/Colisão. Não existe nenhuma
 * descrição "Danos Próprios" na carteira.
 */

export type CoverageKind =
  | "LIABILITY"
  | "LIABILITY_LIMIT"
  | "LEGAL_PROTECTION"
  | "TRAVEL_ASSISTANCE"
  | "MEDICAL_EXPENSES"
  | "PERSONAL_ACCIDENT"
  | "GLASS"
  | "OWN_DAMAGE"
  | "THEFT"
  | "FIRE"
  | "NATURAL_PERILS"
  | "STRIKES"
  | "TERRORISM"
  | "REPLACEMENT_VEHICLE"
  | "ADAPTATION";

export type GlassVariant = "STANDARD" | "ESSENTIAL" | "MANUFACTURER";

/** Indício de classe de veículo dado pela própria descrição da cobertura. */
export type VehicleClassHint = "TWO_WHEELER" | "LIGHT_COMMERCIAL";

export type CoverageClassification = {
  kind: CoverageKind | null;
  glassVariant: GlassVariant | null;
  vehicleClassHint: VehicleClassHint | null;

  /** "Responsabilidad Civil Seguro Facultativo" (capital 42,25 M€, não 7,75 M€). */
  optionalLiability: boolean;
};

const NONE: CoverageClassification = {
  kind: null,
  glassVariant: null,
  vehicleClassHint: null,
  optionalLiability: false,
};

export function classifyCoverage(
  description: string | null | undefined,
): CoverageClassification {
  const text = normalizeCoverageDescription(description);

  if (text === "") {
    return NONE;
  }

  const of = (kind: CoverageKind): CoverageClassification => ({
    ...NONE,
    kind,
  });

  if (/^limite danos (corporais|materiais)/.test(text)) {
    return of("LIABILITY_LIMIT");
  }

  if (/^responsabilida(de|d) civil/.test(text)) {
    return { ...of("LIABILITY"), optionalLiability: text.includes("facultativo") };
  }

  if (/protecao juridica|defesa juridica/.test(text)) {
    return of("LEGAL_PROTECTION");
  }

  if (/^assistencia (em )?viagem/.test(text)) {
    return {
      ...of("TRAVEL_ASSISTANCE"),
      vehicleClassHint: /\b2 rodas\b/.test(text)
        ? "TWO_WHEELER"
        : /\b3500\s*kg\b/.test(text)
          ? "LIGHT_COMMERCIAL"
          : null,
    };
  }

  if (/^despesas (de )?tratamen/.test(text)) {
    return of("MEDICAL_EXPENSES");
  }

  if (
    /^(morte|invalidez|incapacidade)\b/.test(text) ||
    /^despesas de funeral/.test(text)
  ) {
    return of("PERSONAL_ACCIDENT");
  }

  if (/\bvidros?\b/.test(text)) {
    return {
      ...of("GLASS"),
      glassVariant: text.includes("fabricante")
        ? "MANUFACTURER"
        : text.includes("essencial")
          ? "ESSENTIAL"
          : "STANDARD",
    };
  }

  if (/\b(choque|colisao)\b/.test(text)) {
    return of("OWN_DAMAGE");
  }

  if (/\bfurto\b/.test(text)) {
    return of("THEFT");
  }

  if (/^incendio\b/.test(text)) {
    return of("FIRE");
  }

  if (/catastrofic/.test(text)) {
    return of("NATURAL_PERILS");
  }

  if (/^greves\b/.test(text)) {
    return of("STRIKES");
  }

  if (/terrorismo/.test(text)) {
    return of("TERRORISM");
  }

  if (/^veic\W*substituicao/.test(text)) {
    return of("REPLACEMENT_VEHICLE");
  }

  if (/^adaptacao de veiculo/.test(text)) {
    return of("ADAPTATION");
  }

  return NONE;
}

// ---------- perfil de coberturas ----------

/** Cobertura já normalizada (números lidos, texto aparado). */
export type CoverageEntry = {
  objectNumber: string | null;
  description: string;
  capital: number | null;

  /** ValorFranquia (euros). 0 e null são "desconhecido" (ver abaixo). */
  deductibleValue: number | null;
};

/*
 * Todos os campos `has*` são null quando o perfil NÃO é fiável, ou seja,
 * quando a lista não inclui Responsabilidade Civil (obrigatória em Auto):
 * nesse caso a lista pode estar incompleta e "ausente" não significaria
 * "não tem". Lista vazia = desconhecido, nunca "sem coberturas".
 */
export type CoverageProfile = {
  hasRC: boolean | null;
  rcCapital: number | null;
  rcOptionalLiability: boolean | null;

  hasOwnDamage: boolean | null;

  /** Capital da cobertura de Choque/Colisão: proxy do valor da viatura. */
  ownDamageCapital: number | null;
  ownDamageDeductible: number | null;

  hasGlass: boolean | null;
  glassVariant: GlassVariant | null;
  glassCapital: number | null;
  glassDeductible: number | null;

  hasTheft: boolean | null;
  hasFire: boolean | null;
  hasTravelAssistance: boolean | null;
  hasLegalProtection: boolean | null;

  vehicleClassHint: VehicleClassHint | null;

  /** Descrições que nenhuma regra reconheceu (diagnóstico). */
  unclassified: string[];
};

/*
 * DEDUCTIBLE. `ValorFranquia` só se aceita se > 0. Nos ficheiros diários a
 * Zurich preenche 0,000 em TODAS as coberturas (inclusive RC, onde não
 * faz sentido), e a consulta individual devolve null; por isso 0 não é
 * "sem franquia" mas "não informado". A `Franquia` bruta (valores 2, 4,
 * 20 sem ValorFranquia) tem significado não confirmado e NÃO é lida.
 */
function positiveOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

function pickMax(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);

  return known.length > 0 ? Math.max(...known) : null;
}

function pickSingle(values: readonly (number | null)[]): number | null {
  const distinct = Array.from(
    new Set(values.filter((value): value is number => value !== null)),
  );

  // Vários valores diferentes: sem forma segura de escolher.
  return distinct.length === 1 ? distinct[0] : null;
}

export function buildCoverageProfile(
  entries: readonly CoverageEntry[],
): CoverageProfile {
  const classified = entries.map((entry) => ({
    entry,
    classification: classifyCoverage(entry.description),
  }));

  const ofKind = (kind: CoverageKind) =>
    classified.filter((item) => item.classification.kind === kind);

  const liability = ofKind("LIABILITY");
  const trusted = liability.length > 0;

  const flag = (kind: CoverageKind): boolean | null =>
    trusted ? ofKind(kind).length > 0 : null;

  const ownDamage = ofKind("OWN_DAMAGE");
  const glass = ofKind("GLASS");

  const glassVariants = new Set(
    glass.map((item) => item.classification.glassVariant),
  );

  const hint =
    classified.find((item) => item.classification.vehicleClassHint !== null)
      ?.classification.vehicleClassHint ?? null;

  return {
    hasRC: trusted ? true : null,
    rcCapital: trusted
      ? pickMax(liability.map((item) => positiveOrNull(item.entry.capital)))
      : null,
    rcOptionalLiability: trusted
      ? liability.some((item) => item.classification.optionalLiability)
      : null,

    hasOwnDamage: flag("OWN_DAMAGE"),
    ownDamageCapital: trusted
      ? pickMax(ownDamage.map((item) => positiveOrNull(item.entry.capital)))
      : null,
    ownDamageDeductible: trusted
      ? pickSingle(
          ownDamage.map((item) => positiveOrNull(item.entry.deductibleValue)),
        )
      : null,

    hasGlass: flag("GLASS"),
    // Com várias variantes na mesma apólice não se escolhe uma.
    glassVariant:
      trusted && glassVariants.size === 1 ? [...glassVariants][0] : null,
    glassCapital: trusted
      ? pickMax(glass.map((item) => positiveOrNull(item.entry.capital)))
      : null,
    glassDeductible: trusted
      ? pickSingle(
          glass.map((item) => positiveOrNull(item.entry.deductibleValue)),
        )
      : null,

    hasTheft: flag("THEFT"),
    hasFire: flag("FIRE"),
    hasTravelAssistance: flag("TRAVEL_ASSISTANCE"),
    hasLegalProtection: flag("LEGAL_PROTECTION"),

    vehicleClassHint: hint,

    unclassified: classified
      .filter((item) => item.classification.kind === null)
      .map((item) => item.entry.description),
  };
}

// ---------- tier de cobertura ----------

/*
 * Tier de cobertura, derivado APENAS do que existe nos dados:
 *
 *   OWN_DAMAGE  tem Choque/Colisão (20 apólices: mediana 705 €)
 *   RC_PLUS     sem Choque/Colisão mas com Furto ou Incêndio (6: mediana 368 €)
 *   RC          nenhuma das anteriores (90: mediana 315 €); inclui Vidros,
 *               Assistência e Proteção Jurídica, que aparecem em quase todas
 *   UNKNOWN     perfil não fiável
 *
 * As distribuições por tier quase não se sobrepõem (OWN_DAMAGE mín. 451 €
 * vs RC P90 466 €), por isso o tier é o sinal dominante.
 */
export type CoverageTier = "RC" | "RC_PLUS" | "OWN_DAMAGE" | "UNKNOWN";

export function deriveCoverageTier(profile: CoverageProfile): CoverageTier {
  if (profile.hasRC !== true) {
    return "UNKNOWN";
  }

  if (profile.hasOwnDamage) {
    return "OWN_DAMAGE";
  }

  if (profile.hasTheft || profile.hasFire) {
    return "RC_PLUS";
  }

  return "RC";
}

/** Tier pedido no simulador (mesmas regras, a partir dos interruptores). */
export function tierFromRequestedCoverages(coverages: {
  ownDamage: boolean;
  collision: boolean;
  fire: boolean;
  theft: boolean;
}): CoverageTier {
  if (coverages.ownDamage || coverages.collision) return "OWN_DAMAGE";
  if (coverages.fire || coverages.theft) return "RC_PLUS";

  return "RC";
}
