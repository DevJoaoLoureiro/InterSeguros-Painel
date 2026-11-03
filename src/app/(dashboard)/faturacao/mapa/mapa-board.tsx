"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  Landmark,
  Printer,
  Trophy,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";

/*
 * official  fecho oficial registado (Prévoir)
 * estimate  calculado a partir dos recibos, ainda sem fecho (Prévoir)
 * actual    recibos pagos (Zurich)
 * partial   mês em curso / sync parado a meio do mês
 * nodata    sem dados da companhia nesse mês
 * future    mês que ainda não chegou
 */
export type MonthCell = {
  amount: number | null;
  kind: "official" | "estimate" | "actual" | "partial" | "nodata" | "future";
  receipts: number;
  // Imposto de selo da comissão Não Vida (null no filtro Vida e nos
  // meses sem dados). Oficial = "Retenção (Imposto Selo) AP" do fecho
  // da Prévoir; o resto é estimativa de 2%.
  stampDuty: number | null;
  stampDutyOfficial: boolean;
};

// Vida inclui os Financeiros (PPR/capitalização são ramo Vida).
export type CommissionFilter = "todos" | "vida" | "naoVida";

export type CompanyRow = {
  company: string;
  color: string;
  // Por filtro, 12 posições (janeiro a dezembro).
  months: Record<CommissionFilter, MonthCell[]>;
};

/* Linha já com o filtro aplicado (o que a tabela e o gráfico mostram). */
type ViewRow = {
  company: string;
  color: string;
  months: MonthCell[];
};

const FILTERS: { id: CommissionFilter; label: string; hint: string }[] = [
  { id: "todos", label: "Todos", hint: "Vida + Não Vida" },
  { id: "vida", label: "Vida", hint: "Inclui Financeiros (PPR, capitalização)" },
  { id: "naoVida", label: "Não Vida", hint: "AP, Saúde, Auto, Habitação…" },
];

type Props = {
  year: number;
  currentYear: number;
  currentMonthIndex: number;
  rows: CompanyRow[];
  zurichStaleSince: string | null;
};

const MONTHS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

const KIND_LABEL: Record<MonthCell["kind"], string> = {
  official: "Fecho oficial",
  estimate: "Estimativa",
  actual: "Recibos pagos",
  partial: "Em curso",
  nodata: "Sem dados",
  future: "—",
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("pt-PT", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

/* Topo do eixo arredondado (1, 2, 2.5 ou 5 × 10^n) para ticks limpos. */
function niceMax(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((factor) => factor * power >= value)!;
  return step * power;
}

function viewRows(rows: CompanyRow[], filter: CommissionFilter): ViewRow[] {
  return rows.map((row) => ({
    company: row.company,
    color: row.color,
    months: row.months[filter],
  }));
}

/* Total do mês somando as companhias; null quando nenhuma tem dados. */
function totalsByMonth(rows: ViewRow[]): (number | null)[] {
  return MONTHS.map((_, index) => {
    const cells = rows.map((row) => row.months[index]);
    return cells.every((cell) => cell.amount === null)
      ? null
      : round(cells.reduce((sum, cell) => sum + (cell.amount ?? 0), 0));
  });
}

/* Imposto de selo do mês somando as companhias; null sem dados. */
function stampDutyByMonth(rows: ViewRow[]): (number | null)[] {
  return MONTHS.map((_, index) => {
    const cells = rows.map((row) => row.months[index]);
    return cells.every((cell) => cell.stampDuty === null)
      ? null
      : round(cells.reduce((sum, cell) => sum + (cell.stampDuty ?? 0), 0));
  });
}

/*
 * CSV para Excel em português: separador ";", vírgula decimal e BOM
 * (sem o BOM o Excel estraga os acentos). Meses sem valor ficam vazios.
 * Leva as três tabelas (Vida, Não Vida e Total) — é o que a
 * contabilidade precisa, seja qual for o filtro no ecrã.
 */
function downloadCsv(year: number, rows: CompanyRow[]) {
  const number = (value: number | null) =>
    value === null ? "" : value.toFixed(2).replace(".", ",");
  const header = [
    "Companhia",
    ...MONTH_NAMES.map((name) => name[0].toUpperCase() + name.slice(1)),
    `Total ${year}`,
  ];

  const section = (title: string, filter: CommissionFilter): string[][] => {
    const view = viewRows(rows, filter);
    const monthTotals = totalsByMonth(view);

    return [
      [title],
      header,
      ...view.map((row) => [
        row.company,
        ...row.months.map((cell) => number(cell.amount)),
        number(round(row.months.reduce((sum, cell) => sum + (cell.amount ?? 0), 0))),
      ]),
      [
        "Total",
        ...monthTotals.map(number),
        number(round(monthTotals.reduce<number>((sum, value) => sum + (value ?? 0), 0))),
      ],
      ...(filter === "vida"
        ? []
        : (() => {
            const stamp = stampDutyByMonth(view);
            const net = monthTotals.map((total, index) =>
              total === null ? null : round(total - (stamp[index] ?? 0)),
            );
            const sumOf = (values: (number | null)[]) =>
              number(round(values.reduce<number>((sum, value) => sum + (value ?? 0), 0)));

            return [
              ...view.map((row) => [
                `Imposto de selo — ${row.company}${row.company === "Zurich" ? " (estimado 2%)" : ""}`,
                ...row.months.map((cell) => number(cell.stampDuty)),
                sumOf(row.months.map((cell) => cell.stampDuty)),
              ]),
              ["Total imposto de selo", ...stamp.map(number), sumOf(stamp)],
              ["Líquido após imposto de selo", ...net.map(number), sumOf(net)],
            ];
          })()),
      [],
    ];
  };

  const lines: string[][] = [
    [`Mapa de comissões ${year}`],
    [],
    ...section("VIDA (inclui Financeiros)", "vida"),
    ...section("NÃO VIDA", "naoVida"),
    ...section("TOTAL", "todos"),
    ["Comissões por mês, em euros."],
    ["Zurich: comissão de cobrança + angariação dos recibos pagos, pelo mês de pagamento."],
    ["Prévoir: Vida líquido; Não Vida = AP bruto (Total bruto calculado AP, antes do imposto de selo) + Saúde. Fecho oficial quando registado; nos restantes meses, estimativa a partir dos recibos."],
  ];

  const estimateMonths = viewRows(rows, "todos")
    .flatMap((row) =>
      row.months.map((cell, index) =>
        cell.kind === "estimate" || cell.kind === "partial"
          ? `${row.company} ${MONTH_NAMES[index]} (${KIND_LABEL[cell.kind].toLowerCase()})`
          : null,
      ),
    )
    .filter(Boolean) as string[];

  if (estimateMonths.length > 0) {
    lines.push([`Valores provisórios: ${estimateMonths.join(", ")}.`]);
  }

  const csv = lines
    .map((line) => line.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(";"))
    .join("\r\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `mapa-comissoes-${year}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function MetricCard({
  label,
  value,
  description,
  icon,
  tone = "default",
}: {
  label: string;
  value: string;
  description: React.ReactNode;
  icon: React.ReactNode;
  tone?: "default" | "orange";
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)] transition duration-200 hover:-translate-y-0.5 hover:border-[#ffd2bf] hover:shadow-[0_12px_30px_rgba(20,25,35,0.09)]">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-[#ff4b0a]/[0.06] transition-transform duration-300 group-hover:scale-150"
      />

      <div className="relative flex items-center justify-between">
        <p className="text-sm font-medium text-[#737a84]">{label}</p>

        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#fff1ea] to-[#ffe2d3] text-[#ff4b0a]">
          {icon}
        </div>
      </div>

      <p
        className={`relative mt-4 text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl ${
          tone === "orange" ? "text-[#ff4b0a]" : "text-[#17191d]"
        }`}
      >
        {value}
      </p>

      <div className="relative mt-1 text-xs text-[#8a9099]">{description}</div>
    </div>
  );
}

function KindMark({ kind }: { kind: MonthCell["kind"] }) {
  if (kind === "official") {
    return (
      <span
        title="Fecho oficial"
        className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[#2f9e6b] align-middle"
      />
    );
  }
  if (kind === "estimate") {
    return <span title="Estimativa" className="ml-0.5 text-[#b07a3c]">*</span>;
  }
  if (kind === "partial") {
    return <span title="Em curso" className="ml-0.5 text-[#b07a3c]">†</span>;
  }
  return null;
}

export function MapaComissoesBoard({
  year,
  currentYear,
  currentMonthIndex,
  rows: allRows,
  zurichStaleSince,
}: Props) {
  const router = useRouter();
  const [hovered, setHovered] = useState<number | null>(null);
  const [filter, setFilter] = useState<CommissionFilter>("todos");

  const rows = useMemo(() => viewRows(allRows, filter), [allRows, filter]);
  const monthTotals = useMemo(() => totalsByMonth(rows), [rows]);
  const activeFilter = FILTERS.find((item) => item.id === filter)!;

  const companyTotals = rows.map((row) =>
    round(row.months.reduce((sum, cell) => sum + (cell.amount ?? 0), 0)),
  );
  const yearTotal = round(companyTotals.reduce((sum, value) => sum + value, 0));

  // Imposto de selo (só Não Vida): por mês, por companhia e no ano.
  const showStampDuty = filter !== "vida";
  const stampByMonth = useMemo(() => stampDutyByMonth(rows), [rows]);
  const stampByCompany = rows.map((row) =>
    round(row.months.reduce((sum, cell) => sum + (cell.stampDuty ?? 0), 0)),
  );
  const stampTotal = round(stampByCompany.reduce((sum, value) => sum + value, 0));
  const stampAllOfficial = rows.every((row) =>
    row.months.every((cell) => cell.stampDuty === null || cell.stampDutyOfficial),
  );

  const monthsWithData = monthTotals.filter(
    (value): value is number => value !== null && value > 0,
  );
  const average = monthsWithData.length
    ? yearTotal / monthsWithData.length
    : 0;

  const bestIndex = monthTotals.reduce<number | null>(
    (best, value, index) =>
      value !== null && (best === null || value > (monthTotals[best] ?? 0))
        ? index
        : best,
    null,
  );

  // Comparação: último mês completo com dados vs o anterior.
  const lastClosed = (() => {
    for (let index = Math.min(currentMonthIndex - (year === currentYear ? 1 : 0), 11); index > 0; index--) {
      const value = monthTotals[index];
      const previous = monthTotals[index - 1];
      if (value !== null && previous !== null && previous > 0) {
        return { index, change: (value - previous) / previous };
      }
    }
    return null;
  })();

  const scaleMax = niceMax(Math.max(0, ...monthsWithData));
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((fraction) => scaleMax * fraction);

  const years = Array.from(
    { length: currentYear - 2024 + 1 },
    (_, index) => 2024 + index,
  );

  function goToYear(next: number) {
    router.push(`/faturacao/mapa?ano=${next}`);
  }

  const hasEstimates = rows.some((row) =>
    row.months.some((cell) => cell.kind === "estimate"),
  );
  const hasPartial = rows.some((row) =>
    row.months.some((cell) => cell.kind === "partial"),
  );

  return (
    <div className="space-y-6">
      {/* CABEÇALHO */}

      <section className="relative overflow-hidden rounded-3xl border border-[#f0e6de] bg-white p-6 shadow-[0_10px_34px_rgba(58,54,50,0.07)] sm:p-7">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#ea5b0c] via-[#c2551f] to-[#3a3632]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-[#ff4b0a]/[0.13] blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-28 left-1/4 h-64 w-64 rounded-full bg-[#3a3632]/[0.06] blur-3xl"
        />

        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[#ea5b0c]">
              Carteira · Faturação
            </p>

            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[#2b2724]">
              Mapa de comissões {year}
            </h1>

            <p className="mt-2 max-w-xl text-sm text-[#6b625b]">
              Comissões de todas as companhias, mês a mês — pronto a enviar à
              contabilidade.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <div className="inline-flex h-10 items-center rounded-xl border border-[#ece7e2] bg-white/80 p-1 shadow-[0_1px_2px_rgba(58,54,50,0.05)] backdrop-blur">
              <button
                type="button"
                aria-label="Ano anterior"
                disabled={year <= years[0]}
                onClick={() => goToYear(year - 1)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#3a3632] transition hover:bg-[#fff1ea] hover:text-[#ea5b0c] disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              <span className="min-w-[3.5rem] text-center text-sm font-semibold tabular-nums text-[#2b2724]">
                {year}
              </span>

              <button
                type="button"
                aria-label="Ano seguinte"
                disabled={year >= currentYear}
                onClick={() => goToYear(year + 1)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#3a3632] transition hover:bg-[#fff1ea] hover:text-[#ea5b0c] disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => window.print()}
              className="group inline-flex h-10 items-center gap-2 rounded-xl border border-[#ece7e2] bg-white/80 px-3.5 text-sm font-medium text-[#3a3632] shadow-[0_1px_2px_rgba(58,54,50,0.05)] backdrop-blur transition hover:-translate-y-0.5 hover:border-[#ffb899] hover:shadow-[0_8px_20px_rgba(234,91,12,0.14)]"
            >
              <Printer className="h-4 w-4 text-[#ea5b0c]" />
              Imprimir / PDF
            </button>

            <button
              type="button"
              onClick={() => downloadCsv(year, allRows)}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-[#ff4b0a] to-[#ea5b0c] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(234,91,12,0.25)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_26px_rgba(234,91,12,0.32)]"
            >
              <Download className="h-4 w-4" />
              Exportar Excel
            </button>
          </div>
        </div>
      </section>

      {/* FILTRO VIDA / NÃO VIDA */}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label="Ramo"
          className="inline-flex w-full rounded-2xl border border-[#e5e8ec] bg-white p-1 shadow-[0_2px_10px_rgba(20,25,35,0.04)] sm:w-auto"
        >
          {FILTERS.map((item) => {
            const active = item.id === filter;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(item.id)}
                className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition sm:flex-none sm:px-5 ${
                  active
                    ? "bg-gradient-to-r from-[#ff4b0a] to-[#ea5b0c] text-white shadow-[0_6px_16px_rgba(234,91,12,0.25)]"
                    : "text-[#5d646e] hover:bg-[#fff4ee] hover:text-[#ea5b0c]"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <p className="text-xs text-[#8a9099]">
          A mostrar <span className="font-medium text-[#5d646e]">{activeFilter.label}</span>
          {" · "}
          {activeFilter.hint}. O Excel leva sempre Vida, Não Vida e Total.
        </p>
      </div>

      {/* AVISO: SYNC ZURICH PARADO */}

      {zurichStaleSince ? (
        <div className="flex items-start gap-3 rounded-2xl border border-[#f6d9a8] bg-[#fff8ec] px-4 py-3 text-sm text-[#7a5310]">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#d48a12]" />
          <p>
            <span className="font-semibold">Zurich sem sincronização desde{" "}
            {new Intl.DateTimeFormat("pt-PT", {
              timeZone: "Europe/Lisbon",
              day: "2-digit",
              month: "long",
            }).format(new Date(zurichStaleSince))}
            .</span>{" "}
            Os meses seguintes da Zurich aparecem sem dados até o acesso ser
            reposto — não envie esses meses à contabilidade como definitivos.
          </p>
        </div>
      ) : null}

      {/* MÉTRICAS */}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={filter === "todos" ? `Total ${year}` : `${activeFilter.label} ${year}`}
          value={formatCurrency(yearTotal)}
          tone="orange"
          icon={<Wallet className="h-5 w-5" />}
          description={
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {rows.map((row, index) => (
                <span key={row.company} className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: row.color }}
                  />
                  {row.company}{" "}
                  {yearTotal > 0
                    ? `${Math.round((companyTotals[index] / yearTotal) * 100)}%`
                    : "—"}
                </span>
              ))}
            </div>
          }
        />

        {showStampDuty ? (
          <MetricCard
            label="Imposto de selo"
            value={formatCurrency(stampTotal)}
            icon={<Landmark className="h-5 w-5" />}
            description={
              <>
                Líquido após selo:{" "}
                <span className="font-medium text-[#5d646e]">
                  {formatCurrency(round(yearTotal - stampTotal))}
                </span>
                <span className="block">
                  {stampAllOfficial
                    ? "Valores oficiais"
                    : "Oficial nos fechos Prévoir · restante estimado a 2%"}
                </span>
              </>
            }
          />
        ) : (
          <MetricCard
            label="Média mensal"
            value={formatCurrency(average)}
            icon={<CalendarRange className="h-5 w-5" />}
            description={`${monthsWithData.length} ${
              monthsWithData.length === 1 ? "mês" : "meses"
            } com comissões`}
          />
        )}

        <MetricCard
          label="Melhor mês"
          value={bestIndex !== null ? formatCurrency(monthTotals[bestIndex] ?? 0) : "—"}
          icon={<Trophy className="h-5 w-5" />}
          description={
            bestIndex !== null
              ? `${MONTH_NAMES[bestIndex][0].toUpperCase()}${MONTH_NAMES[bestIndex].slice(1)} de ${year}`
              : "Ainda sem dados"
          }
        />

        <MetricCard
          label={
            lastClosed
              ? `${MONTH_NAMES[lastClosed.index][0].toUpperCase()}${MONTH_NAMES[lastClosed.index].slice(1)} vs. ${MONTH_NAMES[lastClosed.index - 1]}`
              : "Evolução mensal"
          }
          value={
            lastClosed
              ? `${lastClosed.change >= 0 ? "+" : ""}${(lastClosed.change * 100).toLocaleString("pt-PT", { maximumFractionDigits: 1 })}%`
              : "—"
          }
          icon={
            lastClosed && lastClosed.change < 0 ? (
              <TrendingDown className="h-5 w-5" />
            ) : (
              <TrendingUp className="h-5 w-5" />
            )
          }
          description={
            lastClosed
              ? `${formatCurrency(monthTotals[lastClosed.index] ?? 0)} face a ${formatCurrency(monthTotals[lastClosed.index - 1] ?? 0)}`
              : "Precisa de dois meses com dados"
          }
        />
      </section>

      {/* GRÁFICO MENSAL */}

      <section className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-[#20242a]">
              Evolução mensal{filter !== "todos" ? ` · ${activeFilter.label}` : ""}
            </h2>
            <p className="mt-1 text-sm text-[#7d848e]">
              Comissões por companhia. Passe o rato por um mês para ver o
              detalhe.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            {rows.map((row) => (
              <span
                key={row.company}
                className="inline-flex items-center gap-2 text-sm text-[#5d646e]"
              >
                <span
                  className="h-2.5 w-2.5 rounded-[3px]"
                  style={{ backgroundColor: row.color }}
                />
                {row.company}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-6 overflow-x-auto">
          <div className="relative min-w-[560px] pl-12">
            {/* Grelha e eixo */}
            <div className="pointer-events-none absolute inset-y-0 left-0 right-0 bottom-7">
              {ticks.map((tick) => (
                <div
                  key={tick}
                  className="absolute left-0 right-0 flex items-center"
                  style={{ bottom: `${(tick / scaleMax) * 100}%` }}
                >
                  <span className="w-10 pr-2 text-right text-[11px] tabular-nums text-[#a0a6ae]">
                    {formatCompact(tick)}
                  </span>
                  <span className="h-px flex-1 bg-[#eef0f2]" />
                </div>
              ))}
            </div>

            <div className="relative flex h-[260px] items-stretch">
              {MONTHS.map((label, index) => {
                const total = monthTotals[index];
                const isHovered = hovered === index;
                const isFuture = rows.every(
                  (row) => row.months[index].kind === "future",
                );
                const segments = rows
                  .map((row) => ({
                    row,
                    cell: row.months[index],
                  }))
                  .filter(({ cell }) => (cell.amount ?? 0) > 0);

                return (
                  <div
                    key={label}
                    onMouseEnter={() => setHovered(index)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(index)}
                    onBlur={() => setHovered(null)}
                    tabIndex={0}
                    aria-label={`${MONTH_NAMES[index]}: ${total !== null ? formatCurrency(total) : "sem dados"}`}
                    className="relative flex flex-1 cursor-default flex-col items-center outline-none"
                  >
                    {/* Banda de hover (área de toque maior do que a barra) */}
                    <div
                      className={`absolute inset-x-1 bottom-7 top-0 rounded-xl transition ${
                        isHovered ? "bg-[#fff4ee]" : ""
                      }`}
                    />

                    <div className="relative flex w-full flex-1 flex-col items-center justify-end pb-0">
                      {segments.length > 0 ? (
                        <div
                          className="flex w-full max-w-[24px] flex-col-reverse gap-[2px] transition-all duration-500"
                          style={{
                            height: `${((total ?? 0) / scaleMax) * 100}%`,
                          }}
                        >
                          {segments.map(({ row, cell }, segmentIndex) => (
                            <div
                              key={row.company}
                              className={`w-full ${
                                segmentIndex === segments.length - 1
                                  ? "rounded-t-[4px]"
                                  : ""
                              } ${cell.kind === "estimate" || cell.kind === "partial" ? "opacity-60" : ""}`}
                              style={{
                                flexGrow: cell.amount ?? 0,
                                backgroundColor: row.color,
                              }}
                            />
                          ))}
                        </div>
                      ) : (
                        <div
                          className={`h-px w-6 ${
                            isFuture ? "bg-[#e5e8ec]" : "border-t border-dashed border-[#c9ced4]"
                          }`}
                        />
                      )}
                    </div>

                    <span
                      className={`relative mt-2 h-5 text-xs ${
                        isHovered
                          ? "font-semibold text-[#ea5b0c]"
                          : isFuture
                            ? "text-[#c2c7ce]"
                            : "text-[#7d848e]"
                      }`}
                    >
                      {label}
                    </span>

                    {/* Tooltip */}
                    {isHovered && !isFuture ? (
                      <div
                        className={`pointer-events-none absolute top-2 z-20 w-56 rounded-xl border border-[#e5e8ec] bg-white p-3 text-left shadow-[0_16px_40px_rgba(20,25,35,0.14)] ${
                          index < 2
                            ? "left-0"
                            : index > 9
                              ? "right-0"
                              : "left-1/2 -translate-x-1/2"
                        }`}
                      >
                        <p className="text-xs font-semibold capitalize text-[#20242a]">
                          {MONTH_NAMES[index]} {year}
                        </p>
                        <div className="mt-2 space-y-1.5">
                          {rows.map((row) => {
                            const cell = row.months[index];
                            return (
                              <div
                                key={row.company}
                                className="flex items-center justify-between gap-2 text-xs"
                              >
                                <span className="inline-flex items-center gap-1.5 text-[#5d646e]">
                                  <span
                                    className="h-2 w-2 rounded-full"
                                    style={{ backgroundColor: row.color }}
                                  />
                                  {row.company}
                                </span>
                                <span className="text-right">
                                  <span className="font-medium tabular-nums text-[#20242a]">
                                    {cell.amount !== null
                                      ? formatCurrency(cell.amount)
                                      : "—"}
                                  </span>
                                  <span className="block text-[10px] text-[#a0a6ae]">
                                    {KIND_LABEL[cell.kind]}
                                    {cell.receipts > 0
                                      ? ` · ${cell.receipts} recibos`
                                      : ""}
                                  </span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-2 flex items-center justify-between border-t border-[#eef0f2] pt-2 text-xs">
                          <span className="font-medium text-[#5d646e]">Total</span>
                          <span className="font-semibold tabular-nums text-[#ea5b0c]">
                            {total !== null ? formatCurrency(total) : "—"}
                          </span>
                        </div>
                        {showStampDuty && stampByMonth[index] !== null ? (
                          <div className="mt-1 space-y-0.5 text-[11px] text-[#8a9099]">
                            <div className="flex items-center justify-between">
                              <span>Imposto de selo</span>
                              <span className="tabular-nums">
                                −{formatCurrency(stampByMonth[index] ?? 0)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between font-medium text-[#5d646e]">
                              <span>Líquido</span>
                              <span className="tabular-nums">
                                {formatCurrency(round((total ?? 0) - (stampByMonth[index] ?? 0)))}
                              </span>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* TABELA PARA A CONTABILIDADE */}

      <section className="overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eef0f2] px-5 py-4">
          <div>
            <h2 className="font-semibold text-[#20242a]">
              Mapa mensal{filter !== "todos" ? ` · ${activeFilter.label}` : ""}
            </h2>
            <p className="mt-1 text-sm text-[#7d848e]">
              Valores em euros, por companhia e mês, antes do imposto de selo.
              {showStampDuty
                ? " O selo (2% sobre a comissão Não Vida) aparece por baixo de cada companhia."
                : " O filtro Vida não tem imposto de selo."}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-sm">
            <thead>
              <tr className="text-xs font-medium uppercase tracking-wide text-[#8a9099]">
                <th className="sticky left-0 z-10 bg-white px-5 py-3 text-left">
                  Companhia
                </th>
                {MONTHS.map((month, index) => (
                  <th
                    key={month}
                    onMouseEnter={() => setHovered(index)}
                    onMouseLeave={() => setHovered(null)}
                    className={`px-3 py-3 text-right transition ${
                      hovered === index ? "bg-[#fff4ee] text-[#ea5b0c]" : ""
                    }`}
                  >
                    {month}
                  </th>
                ))}
                <th className="bg-[#fff8f5] px-5 py-3 text-right text-[#ea5b0c]">
                  Total {year}
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row, rowIndex) => (
                <Fragment key={row.company}>
                <tr
                  className="group border-t border-[#eef0f2] transition hover:bg-[#fcfcfb]"
                >
                  <td className="sticky left-0 z-10 bg-white px-5 py-4 transition group-hover:bg-[#fcfcfb]">
                    <span className="inline-flex items-center gap-2 font-medium text-[#20242a]">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: row.color }}
                      />
                      {row.company}
                    </span>
                    <div className="mt-2 h-1 w-24 overflow-hidden rounded-full bg-[#f1f2f4]">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${yearTotal > 0 ? (companyTotals[rowIndex] / yearTotal) * 100 : 0}%`,
                          backgroundColor: row.color,
                        }}
                      />
                    </div>
                  </td>

                  {row.months.map((cell, index) => (
                    <td
                      key={MONTHS[index]}
                      onMouseEnter={() => setHovered(index)}
                      onMouseLeave={() => setHovered(null)}
                      title={`${KIND_LABEL[cell.kind]}${cell.receipts > 0 ? ` · ${cell.receipts} recibos` : ""}`}
                      className={`whitespace-nowrap px-3 py-4 text-right tabular-nums transition ${
                        hovered === index ? "bg-[#fff4ee]" : ""
                      } ${
                        cell.amount === null
                          ? "text-[#c2c7ce]"
                          : cell.kind === "estimate" || cell.kind === "partial"
                            ? "italic text-[#6b625b]"
                            : "text-[#20242a]"
                      }`}
                    >
                      {cell.amount === null
                        ? cell.kind === "nodata"
                          ? "s/ dados"
                          : "—"
                        : formatCurrency(cell.amount)}
                      <KindMark kind={cell.kind} />
                    </td>
                  ))}

                  <td className="whitespace-nowrap bg-[#fff8f5] px-5 py-4 text-right font-semibold tabular-nums text-[#20242a]">
                    {formatCurrency(companyTotals[rowIndex])}
                  </td>
                </tr>

                {showStampDuty ? (
                  <tr className="text-xs text-[#8a9099]">
                    <td className="sticky left-0 z-10 bg-white py-2 pl-10 pr-5">
                      Imposto de selo
                      <span className="ml-1 text-[10px] text-[#a0a6ae]">
                        {row.months.some((cell) => cell.stampDutyOfficial)
                          ? "(oficial nos fechos)"
                          : "(estimado 2%)"}
                      </span>
                    </td>
                    {row.months.map((cell, index) => (
                      <td
                        key={MONTHS[index]}
                        onMouseEnter={() => setHovered(index)}
                        onMouseLeave={() => setHovered(null)}
                        className={`whitespace-nowrap px-3 py-2 text-right tabular-nums transition ${
                          hovered === index ? "bg-[#fff4ee]" : ""
                        } ${cell.stampDutyOfficial ? "text-[#5d646e]" : "italic"}`}
                      >
                        {cell.stampDuty === null || cell.stampDuty === 0
                          ? "—"
                          : `−${formatCurrency(cell.stampDuty)}`}
                      </td>
                    ))}
                    <td className="whitespace-nowrap bg-[#fff8f5] px-5 py-2 text-right tabular-nums">
                      −{formatCurrency(stampByCompany[rowIndex])}
                    </td>
                  </tr>
                ) : null}
                </Fragment>
              ))}
            </tbody>

            <tfoot>
              <tr className="border-t-2 border-[#ece7e2] bg-[#fafaf9] font-semibold">
                <td className="sticky left-0 z-10 bg-[#fafaf9] px-5 py-4 text-[#20242a]">
                  Total
                </td>
                {monthTotals.map((total, index) => (
                  <td
                    key={MONTHS[index]}
                    onMouseEnter={() => setHovered(index)}
                    onMouseLeave={() => setHovered(null)}
                    className={`whitespace-nowrap px-3 py-4 text-right tabular-nums transition ${
                      hovered === index ? "bg-[#ffeadf]" : ""
                    } ${total === null ? "text-[#c2c7ce]" : "text-[#20242a]"}`}
                  >
                    {total === null ? "—" : formatCurrency(total)}
                  </td>
                ))}
                <td className="whitespace-nowrap bg-gradient-to-r from-[#fff1ea] to-[#ffe2d3] px-5 py-4 text-right text-base tabular-nums text-[#ea5b0c]">
                  {formatCurrency(yearTotal)}
                </td>
              </tr>

              {showStampDuty ? (
                <>
                  <tr className="bg-[#fafaf9] text-sm text-[#6b625b]">
                    <td className="sticky left-0 z-10 bg-[#fafaf9] px-5 py-3">
                      Imposto de selo
                    </td>
                    {stampByMonth.map((stamp, index) => (
                      <td
                        key={MONTHS[index]}
                        onMouseEnter={() => setHovered(index)}
                        onMouseLeave={() => setHovered(null)}
                        className={`whitespace-nowrap px-3 py-3 text-right tabular-nums transition ${
                          hovered === index ? "bg-[#ffeadf]" : ""
                        }`}
                      >
                        {stamp === null || stamp === 0
                          ? "—"
                          : `−${formatCurrency(stamp)}`}
                      </td>
                    ))}
                    <td className="whitespace-nowrap bg-[#fff8f5] px-5 py-3 text-right tabular-nums">
                      −{formatCurrency(stampTotal)}
                    </td>
                  </tr>

                  <tr className="border-t border-[#ece7e2] bg-[#fafaf9] font-semibold">
                    <td className="sticky left-0 z-10 bg-[#fafaf9] px-5 py-4 text-[#20242a]">
                      Líquido após selo
                    </td>
                    {monthTotals.map((total, index) => (
                      <td
                        key={MONTHS[index]}
                        onMouseEnter={() => setHovered(index)}
                        onMouseLeave={() => setHovered(null)}
                        className={`whitespace-nowrap px-3 py-4 text-right tabular-nums transition ${
                          hovered === index ? "bg-[#ffeadf]" : ""
                        } ${total === null ? "text-[#c2c7ce]" : "text-[#20242a]"}`}
                      >
                        {total === null
                          ? "—"
                          : formatCurrency(round(total - (stampByMonth[index] ?? 0)))}
                      </td>
                    ))}
                    <td className="whitespace-nowrap bg-[#fff8f5] px-5 py-4 text-right tabular-nums text-[#20242a]">
                      {formatCurrency(round(yearTotal - stampTotal))}
                    </td>
                  </tr>
                </>
              ) : null}
            </tfoot>
          </table>
        </div>

        {/* LEGENDA */}

        <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-[#eef0f2] px-5 py-4 text-xs text-[#7d848e]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#2f9e6b]" />
            Fecho oficial (Prévoir)
          </span>
          {hasEstimates ? (
            <span>
              <span className="text-[#b07a3c]">*</span> Estimativa a partir dos
              recibos — passa a oficial ao registar o fecho
            </span>
          ) : null}
          {hasPartial ? (
            <span>
              <span className="text-[#b07a3c]">†</span> Mês em curso ou
              incompleto
            </span>
          ) : null}
          <span>
            Zurich: cobrança + angariação dos recibos pagos, pelo mês de
            pagamento
          </span>
        </div>
      </section>
    </div>
  );
}
