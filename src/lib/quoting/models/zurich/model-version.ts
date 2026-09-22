/*
 * Versão do modelo Zurich Auto. ÚNICO sítio onde a string existe.
 *
 * É gravada em cada previsão (EstimatedQuote.modelVersion) e, através dela,
 * em zurich_quote_observations.model_version, para separar o erro medido de
 * cada versão. Subir esta versão sempre que a lógica de estimativa mudar de
 * forma a alterar valores (features, pesos, ajuste, método, intervalo).
 */
export const ZURICH_AUTO_MODEL_VERSION = "zurich-auto-v3";
