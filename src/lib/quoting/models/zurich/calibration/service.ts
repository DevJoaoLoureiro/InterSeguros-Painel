import type {
  CalibrationConfigMode,
  EstimateCalibration,
  QuoteRequest,
} from "../../../domain/types";
import type { ObservationStore } from "../../../observations/types";
import { ZURICH_CALIBRATION_MODE } from "./config";
import { calibrateZurichEstimate } from "./zurich-quote-calibration";

/*
 * Carrega as cotações reais (UMA leitura paginada) e calibra. Nunca lança:
 * se a leitura falhar, devolve calibração NONE com o motivo, para o cálculo
 * da estimativa histórica não depender da tabela de observações.
 */

export type GetZurichCalibrationParams = {
  request: QuoteRequest;
  baseEstimate: number;
  baseRange?: { min: number; max: number } | null;
  modelVersion: string;
  store: Pick<ObservationStore, "listForCalibration">;
  now?: Date;
  configMode?: CalibrationConfigMode;
};

export async function getZurichCalibration(
  params: GetZurichCalibrationParams,
): Promise<EstimateCalibration> {
  const configMode = params.configMode ?? ZURICH_CALIBRATION_MODE;

  const common = {
    request: params.request,
    baseEstimate: params.baseEstimate,
    baseRange: params.baseRange,
    modelVersion: params.modelVersion,
    now: params.now,
    configMode,
  };

  // Desativada: nem sequer se lê a BD.
  if (configMode === "DISABLED") {
    return calibrateZurichEstimate({ ...common, observations: [] });
  }

  try {
    const observations = await params.store.listForCalibration();

    return calibrateZurichEstimate({ ...common, observations });
  } catch (error) {
    // Só o nome/código: a mensagem do Postgres pode conter dados pessoais.
    console.error(
      "[calibração Zurich] Falha ao ler cotações reais:",
      error instanceof Error ? error.name : "erro",
    );

    return {
      ...calibrateZurichEstimate({ ...common, observations: [] }),
      reason: "Não foi possível ler as cotações reais neste momento.",
    };
  }
}
