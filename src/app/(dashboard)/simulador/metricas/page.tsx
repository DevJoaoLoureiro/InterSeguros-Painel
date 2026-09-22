import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import {
  MIN_GLOBAL_QUOTES_FOR_PRODUCTION,
  MIN_NEAREST_QUOTES_FOR_PRODUCTION,
  MIN_SEGMENT_QUOTES_FOR_PRODUCTION,
  MIN_SIMILARITY_FOR_NEAREST,
  ZURICH_CALIBRATION_MODE,
} from "@/lib/quoting/models/zurich/calibration/config";
import {
  summarizeObservationResiduals,
  type ObservationResidualSummary,
} from "@/lib/quoting/models/zurich/calibration/zurich-quote-calibration";
import { ZURICH_AUTO_MODEL_VERSION } from "@/lib/quoting/models/zurich/model-version";
import type {
  AccuracyMetrics,
  AccuracyReport,
  CalibrationComparison,
  OutputGroup,
} from "@/lib/quoting/observations/metrics";
import { createSupabaseObservationStore } from "@/lib/quoting/observations/supabase-store";
import {
  REAL_QUOTE_BASES,
  type RealQuoteBasis,
} from "@/lib/quoting/observations/types";
import { getZurichQuoteAccuracyMetrics } from "@/lib/quoting/observations/zurich-quote-observations";

/*
 * Precisão do simulador Zurich Auto contra cotações reais guardadas.
 * Página interna e simples (sem gráficos): só observações VALID.
 */

type SearchParams = Promise<{
  version?: string;
  cver?: string;
  cmode?: string;
  tier?: string;
  basis?: string;
  product?: string;
  from?: string;
  to?: string;
}>;

const eur = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const percent = new Intl.NumberFormat("pt-PT", {
  style: "percent",
  maximumFractionDigits: 0,
});

const money = (value: number | null) => (value === null ? "—" : eur.format(value));
const pct = (value: number | null) => (value === null ? "—" : percent.format(value));

function signedMoney(value: number | null): string {
  if (value === null) return "—";

  return `${value > 0 ? "+" : ""}${eur.format(value)}`;
}

const panelClass =
  "rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]";

const inputClass =
  "h-10 w-full rounded-xl border border-[#e1e4e8] bg-white px-3 text-sm text-[#20242a] outline-none focus:border-[#ff4b0a]";

function isBasis(value: string | undefined): value is RealQuoteBasis {
  return (REAL_QUOTE_BASES as readonly string[]).includes(value ?? "");
}

export default async function ZurichAccuracyPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  const params = await searchParams;

  const filters = {
    modelVersion: params.version?.trim() || null,
    calibrationVersion: params.cver?.trim() || null,
    calibrationMode: params.cmode?.trim() || null,
    coverageTier: params.tier?.trim() || null,
    basis: isBasis(params.basis) ? params.basis : null,
    productCode: params.product?.trim() || null,
    from: params.from?.trim() || null,
    to: params.to?.trim() || null,
  };

  let report: AccuracyReport | null = null;
  let calibrationSummary: ObservationResidualSummary | null = null;
  let failed = false;

  try {
    const store = createSupabaseObservationStore();

    report = await getZurichQuoteAccuracyMetrics(filters, store);

    // Resíduos das cotações reais elegíveis para calibrar (versão atual do modelo).
    calibrationSummary = summarizeObservationResiduals(
      await store.listForCalibration(),
      filters.modelVersion ?? ZURICH_AUTO_MODEL_VERSION,
    );
  } catch (error) {
    // Só a mensagem segura do store (sem dados da BD).
    console.error(
      "[simulador/metricas] Falha ao ler métricas:",
      error instanceof Error ? error.name : "erro",
    );
    failed = true;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[#20242a]">
            Precisão do simulador Zurich Auto
          </h2>

          <p className="mt-0.5 text-sm text-[#7d848e]">
            Erro da estimativa interna contra cotações reais da Zurich
            (apenas observações válidas). Erro = estimado − real: negativo
            significa que o modelo subestimou.
          </p>
        </div>

        <Link
          href="/simulador"
          className="text-sm font-medium text-[#525963] underline-offset-4 hover:text-[#20242a] hover:underline"
        >
          Voltar ao simulador
        </Link>
      </div>

      <form
        method="get"
        className={`${panelClass} grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4`}
      >
        <Filter label="Versão do modelo">
          <input name="version" defaultValue={params.version ?? ""} placeholder="ex.: zurich-auto-v3" className={inputClass} />
        </Filter>

        <Filter label="Versão da calibração">
          <input name="cver" defaultValue={params.cver ?? ""} placeholder="ex.: zurich-calibration-v1 ou NONE" className={inputClass} />
        </Filter>

        <Filter label="Modo da calibração">
          <select name="cmode" defaultValue={params.cmode ?? ""} className={inputClass}>
            <option value="">Todos</option>
            <option value="NONE">Sem calibração</option>
            <option value="EXPERIMENTAL">EXPERIMENTAL</option>
            <option value="PRODUCTION">PRODUCTION</option>
            <option value="DISABLED">DISABLED</option>
          </select>
        </Filter>

        <Filter label="Tipo de cobertura">
          <select name="tier" defaultValue={params.tier ?? ""} className={inputClass}>
            <option value="">Todos</option>
            <option value="RC">RC</option>
            <option value="RC_PLUS">RC+</option>
            <option value="OWN_DAMAGE">Danos próprios</option>
          </select>
        </Filter>

        <Filter label="Base do preço">
          <select name="basis" defaultValue={params.basis ?? ""} className={inputClass}>
            <option value="">Todas</option>
            {REAL_QUOTE_BASES.map((basis) => (
              <option key={basis} value={basis}>
                {basis}
              </option>
            ))}
          </select>
        </Filter>

        <Filter label="Código do produto">
          <input name="product" defaultValue={params.product ?? ""} className={inputClass} />
        </Filter>

        <Filter label="De">
          <input type="date" name="from" defaultValue={params.from ?? ""} className={inputClass} />
        </Filter>

        <Filter label="Até (exclusive)">
          <input type="date" name="to" defaultValue={params.to ?? ""} className={inputClass} />
        </Filter>

        <div className="sm:col-span-3 lg:col-span-4">
          <button
            type="submit"
            className="inline-flex h-10 items-center rounded-xl bg-[#20242a] px-4 text-sm font-medium text-white hover:bg-[#353b44]"
          >
            Aplicar filtros
          </button>
        </div>
      </form>

      {failed && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Não foi possível ler as observações. Tente novamente.
        </p>
      )}

      {report && (
        <>
          {report.warnings.length > 0 && (
            <ul className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              {report.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}

          <Summary title="Modelo base (estimated_premium = estimativa histórica)" metrics={report.overall} />

          <ComparisonBlock comparison={report.calibration} />

          {calibrationSummary && (
            <CalibrationBlock
              summary={calibrationSummary}
              modelVersion={filters.modelVersion ?? ZURICH_AUTO_MODEL_VERSION}
            />
          )}

          <OutputTable groups={report.byOutput} />
          <BreakdownTable title="Por versão do modelo base (métricas base, sem misturar versões)" rows={report.byModelVersion} />
          <BreakdownTable title="Por base do preço" rows={report.byBasis} />
          <BreakdownTable title="Por tipo de cobertura" rows={report.byCoverageTier} />
          <BreakdownTable title="Por produto Zurich" rows={report.byProduct} />
        </>
      )}
    </div>
  );
}

function Filter({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-xs font-medium text-[#525963]">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function Summary({ title, metrics }: { title: string; metrics: AccuracyMetrics }) {
  const rows: [string, string][] = [
    ["Observações válidas", String(metrics.count)],
    ["MAE", money(metrics.mae)],
    ["Median AE", money(metrics.medianAbsoluteError)],
    ["RMSE", money(metrics.rmse)],
    ["Bias médio", signedMoney(metrics.meanSignedError)],
    ["Erro relativo médio", pct(metrics.meanRelativeError)],
    ["Bias relativo médio", pct(metrics.meanSignedRelativeError)],
    ["P50", money(metrics.absErrorP50)],
    ["P75", money(metrics.absErrorP75)],
    ["P90", money(metrics.absErrorP90)],
    ["P95", money(metrics.absErrorP95)],
    ["Subestimadas", pct(metrics.underestimationRate)],
    ["Sobrestimadas", pct(metrics.overestimationRate)],
  ];

  return (
    <section className={`${panelClass} p-5`}>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#8a9099]">{title}</h3>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-[#8a9099]">{label}</dt>
            <dd className="mt-0.5 text-lg font-semibold text-[#20242a]">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function BreakdownTable({
  title,
  rows,
}: {
  title: string;
  rows: Record<string, AccuracyMetrics>;
}) {
  const entries = Object.entries(rows);

  if (entries.length === 0) return null;

  return (
    <section className={`${panelClass} overflow-x-auto p-5`}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[#8a9099]">{title}</h3>

      <table className="mt-3 w-full min-w-[640px] text-left text-sm">
        <thead className="text-xs text-[#8a9099]">
          <tr>
            <th className="py-1.5 pr-3 font-medium">Grupo</th>
            <th className="py-1.5 pr-3 font-medium">N</th>
            <th className="py-1.5 pr-3 font-medium">MAE</th>
            <th className="py-1.5 pr-3 font-medium">Median AE</th>
            <th className="py-1.5 pr-3 font-medium">Bias</th>
            <th className="py-1.5 pr-3 font-medium">P90</th>
            <th className="py-1.5 pr-3 font-medium">Subest.</th>
            <th className="py-1.5 font-medium">Sobrest.</th>
          </tr>
        </thead>

        <tbody className="text-[#353b44]">
          {entries.map(([key, metrics]) => (
            <tr key={key} className="border-t border-[#edf0f2]">
              <td className="py-1.5 pr-3 font-medium">{key}</td>
              <td className="py-1.5 pr-3">{metrics.count}</td>
              <td className="py-1.5 pr-3">{money(metrics.mae)}</td>
              <td className="py-1.5 pr-3">{money(metrics.medianAbsoluteError)}</td>
              <td className="py-1.5 pr-3">{signedMoney(metrics.meanSignedError)}</td>
              <td className="py-1.5 pr-3">{money(metrics.absErrorP90)}</td>
              <td className="py-1.5 pr-3">{pct(metrics.underestimationRate)}</td>
              <td className="py-1.5">{pct(metrics.overestimationRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CalibrationBlock({
  summary,
  modelVersion,
}: {
  summary: ObservationResidualSummary;
  modelVersion: string;
}) {
  const percentiles = summary.residualPercentiles;

  const rows: [string, string][] = [
    ["Observações válidas", String(summary.totalValidObservations)],
    [`Elegíveis (${modelVersion}, base comparável)`, String(summary.eligibleObservations)],
    [
      "Rejeitadas (versão / base / inválidas)",
      `${summary.rejected.modelVersion} / ${summary.rejected.basis} / ${summary.rejected.invalid}`,
    ],
    ["Viés global (real − estimativa)", signedMoney(summary.globalBias)],
    ["Resíduo mediano", signedMoney(summary.medianResidual)],
    ["MAE", money(summary.meanAbsoluteError)],
    [
      "Resíduo relativo P10 / P50 / P90",
      percentiles
        ? `${pct(percentiles.p10)} / ${pct(percentiles.p50)} / ${pct(percentiles.p90)}`
        : "— (menos de 3 observações)",
    ],
    [
      "Por base do preço",
      Object.entries(summary.byBasis)
        .map(([basis, count]) => `${basis}: ${count}`)
        .join(" · ") || "—",
    ],
  ];

  return (
    <section className={`${panelClass} p-5`}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[#8a9099]">
        Calibração com cotações reais
      </h3>

      <p className="mt-1 text-sm text-[#525963]">
        Modo <strong className="font-semibold">{ZURICH_CALIBRATION_MODE}</strong>
        :{" "}
        {ZURICH_CALIBRATION_MODE === "PRODUCTION"
            ? "a estimativa principal só é calibrada quando a amostra é suficiente."
            : "o valor calibrado aparece ao lado da estimativa histórica e não altera o preço principal."}{" "}
        Mínimos para produção: {MIN_NEAREST_QUOTES_FOR_PRODUCTION}{" "}
        vizinhas (semelhança ≥ {MIN_SIMILARITY_FOR_NEAREST}),{" "}
        {MIN_SEGMENT_QUOTES_FOR_PRODUCTION} no segmento ou{" "}
        {MIN_GLOBAL_QUOTES_FOR_PRODUCTION} no global.
      </p>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 border-b border-[#edf0f2] pb-1.5 text-sm">
            <dt className="text-[#8a9099]">{label}</dt>
            <dd className="font-medium text-[#20242a]">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function changeText(value: number | null): string {
  if (value === null) return "—";

  const text = `${value > 0 ? "+" : ""}${(value * 100).toFixed(1).replace(".", ",")}%`;

  return value < 0 ? `${text} (menos erro)` : value > 0 ? `${text} (mais erro)` : text;
}

/*
 * Base vs calibrada nas MESMAS observações (as que têm calibratedEstimate
 * válido). Nunca se misturam: cada coluna mede uma estimativa diferente.
 */
function ComparisonBlock({ comparison }: { comparison: CalibrationComparison }) {
  if (comparison.pairedCount === 0) {
    return (
      <section className={`${panelClass} p-5`}>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[#8a9099]">
          Modelo base vs calibração
        </h3>

        <p className="mt-2 text-sm text-[#525963]">
          Ainda não há observações com valor calibrado guardado. As cotações
          reais já guardadas medem só a estimativa base.
        </p>
      </section>
    );
  }

  const rows: [string, string, string][] = [
    ["Observações", String(comparison.base.count), String(comparison.calibrated.count)],
    ["MAE", money(comparison.base.mae), money(comparison.calibrated.mae)],
    ["Median AE", money(comparison.base.medianAbsoluteError), money(comparison.calibrated.medianAbsoluteError)],
    ["RMSE", money(comparison.base.rmse), money(comparison.calibrated.rmse)],
    ["Bias médio", signedMoney(comparison.base.meanSignedError), signedMoney(comparison.calibrated.meanSignedError)],
    ["P90", money(comparison.base.absErrorP90), money(comparison.calibrated.absErrorP90)],
    ["Subestimadas", pct(comparison.base.underestimationRate), pct(comparison.calibrated.underestimationRate)],
    ["Sobrestimadas", pct(comparison.base.overestimationRate), pct(comparison.calibrated.overestimationRate)],
  ];

  return (
    <section className={`${panelClass} p-5`}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[#8a9099]">
        Modelo base vs calibração (mesmas {comparison.pairedCount} observações)
      </h3>

      {!comparison.sufficient && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Amostra insuficiente ({comparison.pairedCount} de {comparison.minRequired}{" "}
          necessárias): os valores são só indicativos e não permitem concluir
          que a calibração melhora ou piora.
        </p>
      )}

      <table className="mt-3 w-full text-left text-sm">
        <thead className="text-xs text-[#8a9099]">
          <tr>
            <th className="py-1.5 pr-3 font-medium" />
            <th className="py-1.5 pr-3 font-medium">Modelo base</th>
            <th className="py-1.5 font-medium">Calibração</th>
          </tr>
        </thead>

        <tbody className="text-[#353b44]">
          {rows.map(([label, base, calibrated]) => (
            <tr key={label} className="border-t border-[#edf0f2]">
              <td className="py-1.5 pr-3 font-medium">{label}</td>
              <td className="py-1.5 pr-3">{base}</td>
              <td className="py-1.5">{calibrated}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-3 text-sm text-[#525963]">
        Variação do MAE: <strong className="font-semibold">{changeText(comparison.maeChange)}</strong>
        {" · "}Median AE: {changeText(comparison.medianAbsoluteErrorChange)}
        {" · "}P90: {changeText(comparison.p90Change)}
      </p>
    </section>
  );
}

/** Uma linha por saída (modelo base + calibração): nunca se misturam. */
function OutputTable({ groups }: { groups: OutputGroup[] }) {
  if (groups.length === 0) return null;

  return (
    <section className={`${panelClass} overflow-x-auto p-5`}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[#8a9099]">
        Por saída (versão do modelo base + calibração)
      </h3>

      <table className="mt-3 w-full min-w-[720px] text-left text-sm">
        <thead className="text-xs text-[#8a9099]">
          <tr>
            <th className="py-1.5 pr-3 font-medium">Saída</th>
            <th className="py-1.5 pr-3 font-medium">N</th>
            <th className="py-1.5 pr-3 font-medium">MAE base</th>
            <th className="py-1.5 pr-3 font-medium">Bias base</th>
            <th className="py-1.5 pr-3 font-medium">N calibradas</th>
            <th className="py-1.5 pr-3 font-medium">MAE calibrada</th>
            <th className="py-1.5 font-medium">Bias calibrada</th>
          </tr>
        </thead>

        <tbody className="text-[#353b44]">
          {groups.map((group) => (
            <tr key={group.label} className="border-t border-[#edf0f2]">
              <td className="py-1.5 pr-3 font-medium">{group.label}</td>
              <td className="py-1.5 pr-3">{group.base.count}</td>
              <td className="py-1.5 pr-3">{money(group.base.mae)}</td>
              <td className="py-1.5 pr-3">{signedMoney(group.base.meanSignedError)}</td>
              <td className="py-1.5 pr-3">{group.calibrated?.count ?? 0}</td>
              <td className="py-1.5 pr-3">{money(group.calibrated?.mae ?? null)}</td>
              <td className="py-1.5">{signedMoney(group.calibrated?.meanSignedError ?? null)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
