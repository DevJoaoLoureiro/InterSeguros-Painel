/*
 * Versão da CALIBRAÇÃO com cotações reais. É independente da versão do modelo
 * base (`ZURICH_AUTO_MODEL_VERSION`): a linha de uma observação representa
 *
 *     modelo base X  +  calibração Y  +  cotação real
 *
 * `model_version` guarda SEMPRE a versão do modelo base; esta versão vai para
 * `prediction_snapshot.calibration.version`. Nunca se inventa uma model_version
 * nova só porque a UI mostrou um valor calibrado.
 *
 * Subir quando o algoritmo de calibração mudar de forma a alterar valores
 * (similaridade, pesos, estimador do resíduo, tratamento de redundância).
 */
export const ZURICH_CALIBRATION_VERSION = "zurich-calibration-v1";
