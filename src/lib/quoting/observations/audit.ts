import { readCalibrationSnapshot } from "./calibration-snapshot";
import { isUuid, toFiniteNumber } from "./normalize";

/*
 * Auditoria de observações em que `estimated_premium` possa NÃO ser a
 * estimativa base (por exemplo, guardada como valor calibrado).
 *
 * Regra do sistema: estimated_premium = estimativa BASE, sempre. Esta
 * auditoria só DETETA e PROPÕE; nunca escreve. O SQL gerado é para revisão e
 * execução MANUAL, linha a linha, depois de o utilizador ver exatamente o que
 * mudaria (cada UPDATE só corre se o valor atual for o esperado).
 *
 * Classificação:
 *   OK             sem indício de mistura (estimated_premium = base do snapshot,
 *                  ou não há calibração no snapshot e o valor coincide com o
 *                  pointEstimate guardado)
 *   RECOVERABLE    o snapshot tem calibration.baseEstimate e difere de
 *                  estimated_premium: a base recupera-se do snapshot
 *   UNRECOVERABLE  há indício de mistura mas o snapshot não permite recuperar
 *                  a base (fica para decisão manual; nunca se adivinha)
 */

const TOLERANCE = 0.01;

export type AuditRow = {
  id: string;
  estimated_premium: number;
  estimated_lower: number | null;
  estimated_upper: number | null;
  prediction_snapshot: unknown;
};

export type ProposedBaseValues = {
  estimated_premium: number;

  /** Só se o snapshot guardar o intervalo base; senão null = não mexer. */
  estimated_lower: number | null;
  estimated_upper: number | null;
};

export type BaseEstimateFinding = {
  id: string;
  classification: "OK" | "RECOVERABLE" | "UNRECOVERABLE";
  reason: string;

  currentEstimatedPremium: number;
  snapshotBaseEstimate: number | null;
  snapshotPointEstimate: number | null;

  proposed: ProposedBaseValues | null;
};

export type BaseEstimateAudit = {
  total: number;
  ok: number;
  recoverable: number;
  unrecoverable: number;
  findings: BaseEstimateFinding[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function differs(a: number, b: number): boolean {
  return Math.abs(a - b) > TOLERANCE;
}

export function auditBaseEstimates(rows: readonly AuditRow[]): BaseEstimateAudit {
  const findings = rows.map((row): BaseEstimateFinding => {
    const snapshot = isRecord(row.prediction_snapshot) ? row.prediction_snapshot : {};
    const calibration = readCalibrationSnapshot(snapshot.calibration);
    const snapshotPoint = toFiniteNumber(snapshot.pointEstimate);
    const current = row.estimated_premium;

    const common = {
      id: row.id,
      currentEstimatedPremium: current,
      snapshotBaseEstimate: calibration?.baseEstimate ?? null,
      snapshotPointEstimate: snapshotPoint,
    };

    if (calibration) {
      if (!differs(current, calibration.baseEstimate)) {
        return { ...common, classification: "OK", reason: "estimated_premium = base do snapshot.", proposed: null };
      }

      return {
        ...common,
        classification: "RECOVERABLE",
        reason: `estimated_premium (${current}) difere da base guardada no snapshot (${calibration.baseEstimate}).`,
        proposed: {
          estimated_premium: calibration.baseEstimate,
          estimated_lower: calibration.baseRange?.min ?? null,
          estimated_upper: calibration.baseRange?.max ?? null,
        },
      };
    }

    // Sem snapshot de calibração: só há mistura possível se o valor da coluna
    // não coincidir com o pointEstimate guardado.
    if (snapshotPoint !== null && differs(current, snapshotPoint)) {
      return {
        ...common,
        classification: "UNRECOVERABLE",
        reason:
          "estimated_premium difere do pointEstimate do snapshot e não há calibration.baseEstimate para recuperar a base.",
        proposed: null,
      };
    }

    return {
      ...common,
      classification: "OK",
      reason: "Sem snapshot de calibração: estimated_premium = pointEstimate = base.",
      proposed: null,
    };
  });

  return {
    total: findings.length,
    ok: findings.filter((f) => f.classification === "OK").length,
    recoverable: findings.filter((f) => f.classification === "RECOVERABLE").length,
    unrecoverable: findings.filter((f) => f.classification === "UNRECOVERABLE").length,
    findings,
  };
}

function sqlNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Valor não finito no SQL de reparação.");

  return String(value);
}

/**
 * SQL de reparação PROPOSTO (para revisão e execução manual). Só inclui as
 * RECOVERABLE. Cada UPDATE exige que o estimated_premium atual seja o
 * esperado, por isso não sobrescreve nada que entretanto tenha mudado. Não
 * mexe nas colunas geradas (a BD recalcula os erros a partir da base).
 */
export function buildBaseEstimateRepairSql(audit: BaseEstimateAudit): string {
  const header = [
    "-- PROPOSTA DE CORREÇÃO (NÃO EXECUTAR AUTOMATICAMENTE).",
    "-- Repõe estimated_premium = estimativa BASE guardada em prediction_snapshot.calibration.baseEstimate.",
    "-- Rever linha a linha; cada UPDATE só corre se o valor atual for o esperado.",
    "-- signed_error/absolute_error/relative_error são recalculados pela BD.",
  ];

  const updates = audit.findings
    .filter((finding) => finding.classification === "RECOVERABLE" && finding.proposed)
    .map((finding) => {
      const proposed = finding.proposed as ProposedBaseValues;

      if (!isUuid(finding.id)) throw new Error("Id inválido no SQL de reparação.");

      const sets = [`estimated_premium = ${sqlNumber(proposed.estimated_premium)}`];

      if (proposed.estimated_lower !== null) sets.push(`estimated_lower = ${sqlNumber(proposed.estimated_lower)}`);
      if (proposed.estimated_upper !== null) sets.push(`estimated_upper = ${sqlNumber(proposed.estimated_upper)}`);

      return [
        `-- ${finding.reason}`,
        "UPDATE public.zurich_quote_observations",
        `SET ${sets.join(", ")}`,
        `WHERE id = '${finding.id}' AND estimated_premium = ${sqlNumber(finding.currentEstimatedPremium)};`,
      ].join("\n");
    });

  return updates.length === 0
    ? [...header, "-- Nada a corrigir: nenhuma linha recuperável."].join("\n")
    : [...header, "", ...updates].join("\n\n");
}
