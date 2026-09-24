
export type ProductLine =
  | "AUTO"
  | "WORK_ACCIDENT"
  | "PERSONAL_ACCIDENT"
  | "TRAVEL"
  | "HOME"
  | "LIFE"
  | "HEALTH"
  | "SAVINGS"
  | "OTHER";

export type QuoteRequest = {
  requestId: string;
  clientId?: string | null;

  productLine: ProductLine;
  requestedAt: string;

  customer: {
    birthDate: string | null;
    postalCode: string | null;
    nif?: string | null;

    drivingLicenceDate: string | null;

    occupation?: string | null;

    usage:
      | "PRIVATE"
      | "PROFESSIONAL"
      | "MIXED"
      | "TVDE"
      | "TAXI"
      | "OTHER";
  };

  vehicle: {
    registration: string | null;

    make: string | null;
    model: string | null;
    version: string | null;

    firstRegistrationDate: string | null;

    fuelType: string | null;
    engineCc: number | null;
    powerKw: number | null;

    marketValue: number | null;

    annualKm: number | null;
  } | null;

  claims: {
    claims1Y: number | null;
    claims3Y: number | null;
    claims5Y: number | null;

    atFaultClaims3Y: number | null;
  } | null;

  requestedCoverages: {
    liability: boolean;

    ownDamage: boolean;

    collision: boolean;
    fire: boolean;
    theft: boolean;
    glass: boolean;
    assistance: boolean;
    legalProtection: boolean;

    deductible: number | null;
  };

  paymentFrequency:
    | "ANNUAL"
    | "SEMIANNUAL"
    | "QUARTERLY"
    | "MONTHLY"
    | "OTHER";

  bonusMalus?: {
    class: string | null;
    coefficient: number | null;
    claimFreeYears: number | null;
  } | null;

  metadata?: Record<string, unknown>;
};

/* ------------------------------------------------------------------ *
 * RESULTADOS
 *
 * Cada companhia devolve exatamente UM resultado por pedido, sempre
 * com o mesmo discriminante `status`:
 *
 *   ESTIMATED  -> estimativa interna (modelo próprio). NÃO é preço firme.
 *   FIRM       -> cotação real vinda da companhia (API, portal ou manual).
 *   restantes  -> sem preço: dados insuficientes, ramo não suportado,
 *                 timeout ou erro.
 *
 * Como são tipos distintos, o compilador impede tratar uma estimativa
 * como cotação firme (ou o contrário) sem verificar `status`.
 * ------------------------------------------------------------------ */

export type ConfidenceLevel = "LOW" | "MEDIUM" | "HIGH";

export type QuoteStatus =
  | "ESTIMATED"
  | "FIRM"
  | "INSUFFICIENT_DATA"
  | "NOT_SUPPORTED"
  | "TIMEOUT"
  | "ERROR";

export type QuoteSource =
  | "INTERNAL_MODEL"
  | "INSURER_API"
  | "INSURER_PORTAL"
  | "MANUAL";

/*
 * O que representa o valor de um prémio. Só valores com a MESMA base
 * são comparáveis entre si.
 *
 *   ANNUAL_COMMERCIAL  -> prémio comercial anual (sem encargos/impostos)
 *   ANNUAL_TOTAL       -> total anual a pagar (com encargos/impostos)
 *   INSTALLMENT_TOTAL  -> total a pagar por prestação (fracionamento)
 *   UNKNOWN            -> base ainda não confirmada
 */
export type PremiumBasis =
  | "ANNUAL_COMMERCIAL"
  | "ANNUAL_TOTAL"
  | "INSTALLMENT_TOTAL"
  | "UNKNOWN";

export type PriceRange = {
  min: number;
  max: number;
};

export type InsurerQuoteBase = {
  insurerCode: string;
  insurerName: string;
  productLine: ProductLine;

  /** Explicações legíveis (como se chegou ao valor, ou porque não há valor). */
  reasons: string[];

  /** Avisos que não impedem o resultado mas reduzem a sua fiabilidade. */
  warnings: string[];

  generatedAt: string;
};

/**
 * Diagnóstico quantitativo de uma estimativa histórica. Tudo JSON-seguro
 * (atravessa a fronteira servidor -> cliente) e opcional: a UI pode
 * mostrar só uma parte, e modelos que não o calculam não o preenchem.
 */
export type EstimateDiagnostics = {
  /** Base do prémio histórico usado como alvo e como foi verificada. */
  target: {
    basis: PremiumBasis;
    source: string;
    /** Fração (0..1) do peso dos comparáveis com alvo confirmado por recibos. */
    confirmedShare: number;
    note: string;
  };

  selection: {
    /** 0 = comparáveis excelentes ... 4 = carteira completa. */
    fallbackLevel: number;
    fallbackLabel: string;
    strongComparables: number;
    secondaryComparables: number;
    effectiveSampleSize: number;
    meanSimilarity: number;
    minSimilarity: number;
    /** Apólices históricas elegíveis de onde saíram os comparáveis. */
    poolSize: number;
  };

  estimator: {
    method: string;
    /** Estimativa só com comparáveis ajustados, e previsão direta do modelo. */
    comparablesEstimate: number;
    modelPrediction: number | null;
    modelBlend: number;
    dispersion: number | null;
    outliersAdjusted: number;
  };

  /** Intervalo derivado dos resíduos históricos (não é um IC do preço real). */
  interval: {
    nominalCoverage: number;
    /** Erro relativo (real/previsto - 1) aplicado abaixo e acima da estimativa. */
    lowerError: number;
    upperError: number;
    source: "SEGMENT" | "GLOBAL" | "FALLBACK_RULE";
    residuals: number;
  };

  /** Erro do modelo no backtest para este tipo de cobertura (null = sem histórico). */
  historicalError: {
    segment: string;
    n: number;
    mae: number | null;
    medianAbsoluteError: number | null;
    absErrorP90: number | null;
    medianApe: number | null;
    biasPct: number | null;
  } | null;

  confidence: {
    score: number;
    components: Record<string, number>;
    /** Regra que limitou o nível, se alguma. */
    cap: string | null;
  };

  /** Efeitos multiplicativos ajustados aos dados (ex.: idade por ano). */
  adjustments: { term: string; percentEffect: number }[];

  mainFactors: string[];
  unavailableData: string[];

  /** Que dados do pedido o modelo usa e onde existem no histórico. */
  inputUsage: {
    input: string;
    usedByModel: boolean;
    existsInHistory: boolean;
    role: "SIMILARITY" | "ADJUSTMENT" | "INFORMATIVE" | "IDENTIFICATION_ONLY";
    note: string;
  }[];
};

export type CalibrationMode = "NONE" | "GLOBAL" | "SEGMENT" | "NEAREST_QUOTES";

/** Política global da calibração com cotações reais (ver calibration/config.ts). */
export type CalibrationConfigMode = "DISABLED" | "EXPERIMENTAL" | "PRODUCTION";

/**
 * Correção aprendida com cotações reais guardadas (zurich_quote_observations).
 * Vem SEPARADA da estimativa histórica: enquanto `applied` for false o
 * `pointEstimate` do resultado é a estimativa base, sem qualquer alteração.
 * Tudo JSON-seguro e opcional.
 */
export type EstimateCalibration = {
  /** Versão da calibração (independente da versão do modelo base). */
  version: string;

  configMode: CalibrationConfigMode;
  mode: CalibrationMode;

  /** true = a amostra não cumpre o critério de produção: só diagnóstico. */
  experimental: boolean;

  /** true = o pointEstimate do resultado JÁ inclui esta correção. */
  applied: boolean;

  /** Amostra e qualidade suficientes para uso em produção. */
  eligibleForProduction: boolean;

  /** Estimativa histórica original (o pointEstimate do modelo, sem calibração). */
  baseEstimate: number;

  /** Intervalo da estimativa base (o priceRange do resultado pode estar escalado). */
  baseRange: { min: number; max: number } | null;

  /** Valor bruto que os dados apontam (sem encolhimento nem limites). */
  calibratedEstimate: number;

  /**
   * Valor a mostrar em GRANDE («Calibração com cotações reais»): o calibrado, com
   * um teto de sanidade, quando há cotações do mesmo tipo de cobertura
   * (vizinhas ou segmento). null = mostrar a estimativa histórica. É só
   * apresentação: o pointEstimate e o que se guarda (estimated_premium) não mudam.
   */
  headlineEstimate: number | null;

  /** Valor com encolhimento por amostra pequena e limite de correção (modo PRODUCTION). */
  productionSafeEstimate: number;
  clamped: boolean;

  /** Diferença do valor bruto face à base. */
  adjustment: { amount: number; percent: number | null };

  /** Nº BRUTO de observações usadas / das quais com base ANNUAL/TOTAL. */
  sampleSize: number;
  productionSampleSize: number;

  /**
   * Amostra efetiva: desconta pesos concentrados E observações quase iguais
   * (mesmo perfil, mesmo preço real), que valem quase como uma só.
   */
  effectiveSampleSize: number | null;

  confidence: ConfidenceLevel;
  reason: string;
  modelVersion: string;

  diagnostics: {
    totalValidObservations: number;
    consideredObservations: number;

    /** Observações válidas descartadas, por motivo. */
    rejected: {
      modelVersion: number;
      basis: number;
      tier: number;
      invalid: number;

      /**
       * Observações RETROACTIVE_PORTFOLIO (recalculadas a partir de apólices
       * já emitidas, não de uma simulação real): nunca calibram o valor
       * principal, só servem de diagnóstico próprio (ver metrics.ts).
       */
      retroactive: number;
    };

    /** Média e mediana do resíduo em euros (real - base) e MAE, sobre as elegíveis. */
    globalBias: number | null;
    medianResidual: number | null;
    meanAbsoluteError: number | null;

    /** Resíduo relativo (real/base - 1) do método escolhido. */
    weightedResidual: number | null;

    /** Percentis do resíduo relativo das elegíveis. */
    residualPercentiles: { p10: number; p50: number; p90: number } | null;

    meanSimilarity: number | null;

    /** Observações INDEPENDENTES (redundantes contam quase como uma) e as de base ANNUAL/TOTAL. */
    independentObservations: number | null;
    independentProductionObservations: number | null;

    /** Método usado e o que cada um daria (relativo). */
    robustness: "NONE" | "MEDIAN" | "TRIMMED";
    methods: {
      weightedMean: number | null;
      weightedMedian: number | null;
      trimmedMean: number | null;
    };

    /** Mínimo de observações para produção neste modo (null em NONE). */
    requiredForProduction: number | null;
  };
};

/** Estimativa interna. Nunca deve ser apresentada como preço firme. */
export type EstimatedQuote = InsurerQuoteBase & {
  status: "ESTIMATED";
  source: "INTERNAL_MODEL";

  premiumBasis: PremiumBasis;

  pointEstimate: number;
  priceRange: PriceRange;
  confidence: ConfidenceLevel;

  /** Score quantitativo (0..100) por trás de `confidence`, quando o modelo o calcula. */
  confidenceScore?: number;

  /** Nº de riscos históricos usados; null se o modelo não for histórico. */
  comparablePolicies: number | null;

  /**
   * Dados do pedido que efetivamente influenciaram este valor, em texto
   * legível (lista completa: o que não consta não o alterou).
   *
   *   []         -> nenhum dado do pedido alterou o valor
   *   undefined  -> o modelo não declara os seus fatores
   */
  consideredFactors?: string[];

  /** Diagnóstico detalhado; ausente em modelos que não o calculam. */
  diagnostics?: EstimateDiagnostics;

  /**
   * Calibração com cotações reais. Se `applied`, o `pointEstimate` JÁ é o valor
   * calibrado e a estimativa histórica original está em `baseEstimate`; se não,
   * o `pointEstimate` é a estimativa base e o valor calibrado só aqui aparece.
   */
  calibration?: EstimateCalibration;

  modelVersion: string;
};

/** Cotação real obtida junto da companhia. */
export type FirmQuote = InsurerQuoteBase & {
  status: "FIRM";
  source: Exclude<QuoteSource, "INTERNAL_MODEL">;

  premiumBasis: PremiumBasis;

  /** Valor cotado, expresso na base indicada em `premiumBasis`. */
  premium: number;

  commercialPremium: number | null;
  totalPremium: number | null;

  validUntil: string | null;
  externalReference: string | null;
};

/** Companhia sem preço para este pedido. */
export type UnavailableQuote = InsurerQuoteBase & {
  status:
    | "INSUFFICIENT_DATA"
    | "NOT_SUPPORTED"
    | "TIMEOUT"
    | "ERROR";

  /**
   * Campos de QuoteRequest em falta (ex.: "customer.birthDate").
   * Preenchido em INSUFFICIENT_DATA quando o modelo os indica;
   * vazio nos restantes estados.
   */
  missingData: string[];
};

/** Resultado de uma companhia, seja qual for o desfecho. */
export type InsurerQuoteResult =
  | EstimatedQuote
  | FirmQuote
  | UnavailableQuote;

export type QuoteComparison = {
  requestId: string;
  productLine: ProductLine;

  results: InsurerQuoteResult[];

  /*
   * A mais barata só é indicada quando os valores são comparáveis
   * (mesma `premiumBasis`, e conhecida). Caso contrário fica null e
   * o motivo aparece em `warnings`.
   */
  cheapestEstimated: EstimatedQuote | null;
  cheapestFirm: FirmQuote | null;

  warnings: string[];

  generatedAt: string;
};