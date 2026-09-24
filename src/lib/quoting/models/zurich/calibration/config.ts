import type { CalibrationConfigMode } from "../../../domain/types";
import type { RealQuoteBasis } from "../../../observations/types";

/*
 * Configuração CENTRALIZADA da calibração do simulador Zurich Auto com
 * cotações reais (zurich_quote_observations). Nenhum limiar vive noutro sítio.
 *
 * MODO ATUAL: EXPERIMENTAL. A estimativa calibrada calcula-se e mostra-se ao
 * lado da estimativa histórica, mas o `pointEstimate` principal é SEMPRE a
 * estimativa base. Só em "PRODUCTION" a correção passa a alterar o resultado,
 * e mesmo aí apenas quando a amostra (de observações INDEPENDENTES) e a
 * confiança são suficientes.
 *
 *   DISABLED      não calcula nem lê a BD.
 *   EXPERIMENTAL  calcula e mostra ao lado; nunca altera o preço principal.
 *   PRODUCTION    aplica o valor "productionSafe" (encolhido e limitado) SÓ
 *                 se a amostra e a confiança forem suficientes.
 */
export const ZURICH_CALIBRATION_MODE: CalibrationConfigMode = "EXPERIMENTAL";

// ---------- valor principal apresentado ----------

/**
 * O valor calibrado aparece SEMPRE em GRANDE («Calibração com cotações reais»)
 * quando existe pelo menos uma cotação real utilizável (qualquer estratégia:
 * NEAREST_QUOTES, SEGMENT ou GLOBAL), mesmo com amostra pequena ou vinda de
 * outro tipo de cobertura: a confiança mostrada desce em conformidade e o
 * diagnóstico explica a origem. Só SEM NENHUMA cotação real (mode = "NONE")
 * é que não há valor a mostrar.
 *
 * É só apresentação: o `pointEstimate` guardado continua a ser a estimativa base.
 */

/** Teto de sanidade do valor principal: nunca mais de x6 (ou menos de 1/6) da base. */
export const MAX_HEADLINE_FACTOR = 6;

// ---------- limiares de produção ----------
//
// Escolhidos pela ordem de grandeza do erro medido: com erro relativo típico
// de ~20% (backtest histórico) e uma correção que se quer fiável a ~+-10%,
// são precisas dezenas de observações para o erro-padrão da média descer a
// esse nível; abaixo disso a "correção" seria ruído. Ajustar quando houver
// dados (a dispersão real dos resíduos manda), não antes.

/** Cotações reais elegíveis (qualquer tier) para usar só o viés global. */
export const MIN_GLOBAL_QUOTES_FOR_PRODUCTION = 20;

/** Cotações do mesmo segmento (tier, faixa etária, anos de carta, uso). */
export const MIN_SEGMENT_QUOTES_FOR_PRODUCTION = 15;

/** Cotações muito semelhantes ao pedido (vizinhas mais próximas). */
export const MIN_NEAREST_QUOTES_FOR_PRODUCTION = 5;

/** Similaridade mínima para uma cotação contar como "vizinha". */
export const MIN_SIMILARITY_FOR_NEAREST = 0.6;

/** Nº mínimo para calcular um valor EXPERIMENTAL (só diagnóstico). */
export const MIN_QUOTES_FOR_EXPERIMENT = 1;

/** Máximo de vizinhas usadas. */
export const MAX_NEAREST_QUOTES = 10;

// ---------- observações redundantes ----------

/**
 * Duas cotações do mesmo perfil com o MESMO preço real são a mesma evidência,
 * não duas. A redundância entre duas observações é
 *     similaridade do perfil x concordância do preço real
 * com a concordância a decair com a diferença em log (escala 2%): preços
 * reais iguais ao cêntimo = 1; preços 10% diferentes = ~0 (clientes parecidos
 * com preços diferentes SÃO evidência independente).
 */
export const REDUNDANCY_PRICE_SCALE = 0.02;

/** Acima deste nº de observações não se calcula a matriz O(n^2) (trata-as como independentes). */
export const MAX_REDUNDANCY_COMPARISONS = 300;

// ---------- segurança da correção ----------

/**
 * Encolhimento: a correção "productionSafe" é multiplicada por n/(n + K),
 * com n = amostra efetiva. Com n = 2 fica a ~1/3; com n = 20, ~83%.
 */
export const SHRINKAGE_K = 4;

/**
 * Nenhuma correção "productionSafe" muda o preço mais de x2 (ou /2). O valor
 * BRUTO nunca é limitado: fica sempre visível (calibratedEstimate).
 */
export const MAX_PRODUCTION_FACTOR = 2;

/** Amostra efetiva a partir da qual se usa a mediana / a média aparada. */
export const MEDIAN_MIN_EFFECTIVE_SIZE = 3;
export const TRIMMED_MIN_EFFECTIVE_SIZE = 8;

// ---------- confiança ----------

/** Dispersão (desvio absoluto mediano dos resíduos em log) aceite por nível. */
export const HIGH_MAX_DISPERSION = 0.15;
export const MEDIUM_MAX_DISPERSION = 0.35;

/** HIGH exige este múltiplo do mínimo de produção. */
export const HIGH_SAMPLE_MULTIPLIER = 2;

/** Similaridade média mínima das vizinhas para confiança HIGH. */
export const HIGH_MIN_MEAN_SIMILARITY = 0.75;

// ---------- recência ----------

/**
 * As tarifas mudam: uma cotação com um ano vale ~37% de uma de hoje, com o
 * piso a evitar descartar dados antigos de forma brusca.
 */
export const RECENCY_SCALE_DAYS = 365;
export const RECENCY_FLOOR = 0.25;

// ---------- base do preço ----------

/**
 * Peso de uma observação conforme o que o valor real representa. O pedido é
 * um prémio ANUAL. Só ANNUAL/TOTAL são comparáveis com a estimativa (anual
 * total); INSTALLMENT e COMMERCIAL são outra grandeza (peso 0: excluídas).
 * UNKNOWN não está confirmado: conta com peso reduzido só no modo
 * experimental e NUNCA para os mínimos de produção.
 */
export const BASIS_WEIGHT: Record<RealQuoteBasis, number> = {
  ANNUAL: 1,
  TOTAL: 1,
  UNKNOWN: 0.5,
  INSTALLMENT: 0,
  COMMERCIAL: 0,
};

export const PRODUCTION_BASES: readonly RealQuoteBasis[] = ["ANNUAL", "TOTAL"];

// ---------- similaridade entre cotações reais ----------

export type RealQuoteSimilarityFeature =
  | "licenceYears"
  | "age"
  | "usage"
  | "product"
  | "deductible"
  | "vehicle"
  | "postalRegion"
  | "paymentFrequency"
  | "claims";

/**
 * Pesos relativos. MUITO ALTA: anos de carta e idade. ALTA: uso, produto,
 * franquia, veículo. MÉDIA: região, fracionamento, sinistros. O tier de
 * cobertura não pesa: é um FILTRO (tiers incompatíveis não se misturam) e a
 * recência é um peso multiplicativo à parte.
 */
export const SIMILARITY_WEIGHTS: Record<RealQuoteSimilarityFeature, number> = {
  licenceYears: 5,
  age: 4,
  usage: 2.5,
  product: 2.5,
  deductible: 2.5,
  vehicle: 2.5,
  postalRegion: 1.5,
  paymentFrequency: 1,
  claims: 1.5,
};

/** Escala (anos) da idade: closeness = exp(-(diferença / escala)^2). */
export const AGE_SCALE_YEARS = 8;

/** Escala (em log(1 + anos)) dos anos de carta: os primeiros anos pesam mais. */
export const LICENCE_LOG_SCALE = 0.7;

/** Tolerância a features desconhecidas (0 = penaliza tudo, 1 = ignora). */
export const MISSING_TOLERANCE = 0.6;

/** Expoente do kernel de similaridade nos pesos da correção. */
export const KERNEL_POWER = 2;

// ---------- segmento ----------

/** Diferença máxima de idade (anos) dentro do mesmo segmento. */
export const SEGMENT_MAX_AGE_DIFFERENCE = 10;

/** Faixas de anos de carta (limites superiores, exclusivos). */
export const LICENCE_BANDS = [2, 5, 10] as const;
