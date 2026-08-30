"use client";

type DailyProduction = {
  date: string;
  label: string;
  policies: number;
  premium: number;
};

type Company = {
  company: string;
  policies: number;
  premium: number;
};

type LeadStatus = {
  status: string;
  count: number;
};

type Line = {
  name: string;
  value: number;
};

type Props = {
  dailyProduction: DailyProduction[];
  companies: Company[];
  leadStatuses: LeadStatus[];
  lines: Line[];

  mode:
    | "production"
    | "companies"
    | "leads"
    | "lines";
};

function currency(
  value: number,
) {
  return new Intl.NumberFormat(
    "pt-PT",
    {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    },
  ).format(value);
}

function statusLabel(
  status: string,
) {
  const labels: Record<
    string,
    string
  > = {
    nova: "Nova",
    em_contacto: "Em contacto",
    a_aguardar: "A aguardar",
    simulacao_enviada:
      "Simulação enviada",
    proposta: "Proposta",
    ganha: "Por validar",
    convertida: "Convertida",
    perdida: "Perdida",

    // compatibilidade com estados antigos
    contactada: "Contactada",
    qualificada: "Qualificada",
  };

  return labels[status] ?? status;
}

export function DashboardCharts({
  dailyProduction,
  companies,
  leadStatuses,
  lines,
  mode,
}: Props) {
  if (mode === "production") {
    return (
      <ProductionChart
        data={dailyProduction}
      />
    );
  }

  if (mode === "companies") {
    return (
      <CompanyChart
        data={companies}
      />
    );
  }

  if (mode === "leads") {
    return (
      <LeadChart
        data={leadStatuses}
      />
    );
  }

  return (
    <LineChart
      data={lines}
    />
  );
}

// ========================================
// PRODUÇÃO 30 DIAS
// ========================================

function ProductionChart({
  data,
}: {
  data: DailyProduction[];
}) {
  const max =
    Math.max(
      ...data.map(
        (item) =>
          item.premium,
      ),
      1,
    );

  if (data.length === 0) {
    return <EmptyChart />;
  }

  return (
    <div>
      <div className="flex h-[220px] items-end gap-1.5">
        {data.map(
          (item) => {
            const height =
              Math.max(
                (item.premium /
                  max) *
                  100,
                item.premium >
                0
                  ? 4
                  : 1,
              );

            return (
              <div
                key={
                  item.date
                }
                className="group relative flex h-full flex-1 items-end"
              >
                <div
                  className="w-full rounded-t-md bg-[#ff4b0a] transition-opacity hover:opacity-80"
                  style={{
                    height: `${height}%`,
                  }}
                />

                <div className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-20 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#20242a] px-3 py-2 text-xs text-white shadow-lg group-hover:block">
                  <p className="font-medium">
                    {item.label}
                  </p>

                  <p>
                    {
                      item.policies
                    }{" "}
                    apólices
                  </p>

                  <p>
                    {currency(
                      item.premium,
                    )}
                  </p>
                </div>
              </div>
            );
          },
        )}
      </div>

      <div className="mt-3 flex justify-between text-[10px] text-[#a0a5ac]">
        <span>
          {
            data[0]
              ?.label
          }
        </span>

        <span>
          {
            data[
              Math.floor(
                data.length /
                  2,
              )
            ]?.label
          }
        </span>

        <span>
          {
            data[
              data.length -
                1
            ]?.label
          }
        </span>
      </div>
    </div>
  );
}

// ========================================
// COMPANHIAS
// ========================================

function CompanyChart({
  data,
}: {
  data: Company[];
}) {
  const max =
    Math.max(
      ...data.map(
        (item) =>
          item.premium,
      ),
      1,
    );

  if (
    data.length === 0
  ) {
    return <EmptyChart />;
  }

  return (
    <div className="space-y-4">
      {data.map(
        (item) => (
          <div
            key={
              item.company
            }
          >
            <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
              <span className="truncate font-medium text-[#343940]">
                {
                  item.company
                }
              </span>

              <span className="shrink-0 text-xs text-[#7d848e]">
                {currency(
                  item.premium,
                )}
              </span>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-[#f0f1f3]">
              <div
                className="h-full rounded-full bg-[#ff4b0a]"
                style={{
                  width: `${Math.max(
                    (item.premium /
                      max) *
                      100,
                    3,
                  )}%`,
                }}
              />
            </div>

            <p className="mt-1 text-[11px] text-[#a0a5ac]">
              {
                item.policies
              }{" "}
              apólices
            </p>
          </div>
        ),
      )}
    </div>
  );
}

// ========================================
// LEADS
// ========================================

function LeadChart({
  data,
}: {
  data: LeadStatus[];
}) {
  const total =
    data.reduce(
      (
        sum,
        item,
      ) =>
        sum +
        item.count,
      0,
    );

  if (
    data.length === 0
  ) {
    return <EmptyChart />;
  }

  const sortedData =
    [...data].sort(
      (a, b) =>
        b.count -
        a.count,
    );

  return (
    <div className="space-y-4">
      <div className="flex h-4 overflow-hidden rounded-full bg-[#f0f1f3]">
        {sortedData.map(
          (item) => {
            const width =
              total > 0
                ? (item.count /
                    total) *
                  100
                : 0;

            return (
              <div
                key={
                  item.status
                }
                className="h-full border-r border-white bg-[#ff4b0a] last:border-r-0"
                style={{
                  width: `${width}%`,
                  opacity:
                    0.45 +
                    Math.min(
                      width /
                        100,
                      0.55,
                    ),
                }}
              />
            );
          },
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {sortedData.map(
          (item) => (
            <div
              key={
                item.status
              }
              className="rounded-xl border border-[#edf0f2] bg-[#fafbfc] p-3"
            >
              <p className="text-xs text-[#7d848e]">
                {statusLabel(
                  item.status,
                )}
              </p>

              <p className="mt-1 text-xl font-semibold text-[#20242a]">
                {
                  item.count
                }
              </p>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

// ========================================
// RAMOS
// ========================================

function LineChart({
  data,
}: {
  data: Line[];
}) {
  const total =
    data.reduce(
      (
        sum,
        item,
      ) =>
        sum +
        item.value,
      0,
    );

  if (
    data.length === 0
  ) {
    return <EmptyChart />;
  }

  return (
    <div className="space-y-3">
      {data
        .slice(0, 8)
        .map(
          (item) => {
            const percentage =
              total > 0
                ? (item.value /
                    total) *
                  100
                : 0;

            return (
              <div
                key={
                  item.name
                }
                className="flex items-center gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-[#343940]">
                      {
                        item.name
                      }
                    </p>

                    <p className="text-xs text-[#7d848e]">
                      {
                        item.value
                      }
                    </p>
                  </div>

                  <div className="h-2 overflow-hidden rounded-full bg-[#f0f1f3]">
                    <div
                      className="h-full rounded-full bg-[#ff4b0a]"
                      style={{
                        width: `${Math.max(
                          percentage,
                          3,
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                <span className="w-11 text-right text-xs text-[#8a9099]">
                  {percentage.toFixed(
                    0,
                  )}
                  %
                </span>
              </div>
            );
          },
        )}
    </div>
  );
}

// ========================================
// EMPTY
// ========================================

function EmptyChart() {
  return (
    <div className="flex h-[180px] items-center justify-center rounded-xl border border-dashed border-[#dfe2e6] text-sm text-[#8a9099]">
      Ainda não existem
      dados suficientes.
    </div>
  );
}