"use client";

import {
  Building2,
  CalendarDays,
  Car,
  CircleUserRound,
  CreditCard,
  FileText,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";

import {
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import type {
  PortfolioClient,
  ProfileRow,
} from "@/components/clientes/types";

type Data = {
  stats: {
    client_count: number;
    policy_count: number;
    policies_today: number;
    total_premium: number;
  };
  items: PortfolioClient[];
  page: number;
  totalPages: number;
  totalCount: number;
  companies: string[];
  profiles: ProfileRow[];
};

type Filters = {
  q: string;
  from: string;
  to: string;
  company: string;
  responsible: string;
  sort: "newest" | "oldest";
  page: number;
};

type Props = {
  data: Data;
  filters: Filters;
};

function formatDate(
  value: string | null | undefined,
) {
  if (!value) return "—";

  const date = new Date(
    `${value.slice(0, 10)}T12:00:00`,
  );

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "pt-PT",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    },
  ).format(date);
}

function formatCurrency(
  value: number | null | undefined,
) {
  if (value === null || value === undefined) {
    return "—";
  }

  return new Intl.NumberFormat(
    "pt-PT",
    {
      style: "currency",
      currency: "EUR",
    },
  ).format(value);
}

function getFractionLabel(
  fractionType: number | null,
) {
  const labels: Record<number, string> = {
    0: "Anual",
    1: "Semestral",
    2: "Trimestral",
    3: "Mensal",
  };

  if (fractionType === null) {
    return "—";
  }

  return labels[fractionType] ?? `Tipo ${fractionType}`;
}

export default function ClientsList({
  data,
  filters,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Input de pesquisa: estado local para não perder o
  // que se escreve enquanto o debounce não dispara.
  const [qInput, setQInput] = useState(filters.q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQInput(filters.q);
  }, [filters.q]);

  function pushFilters(
    next: Partial<Filters>,
    resetPage = true,
  ) {
    const merged: Filters = {
      ...filters,
      ...next,
      page: resetPage ? 1 : filters.page,
    };

    const url = new URLSearchParams();

    if (merged.q) url.set("q", merged.q);
    if (merged.from) url.set("from", merged.from);
    if (merged.to) url.set("to", merged.to);
    if (merged.company) url.set("company", merged.company);
    if (merged.responsible) url.set("responsible", merged.responsible);
    if (merged.sort !== "newest") url.set("sort", merged.sort);
    if (merged.page > 1) url.set("page", String(merged.page));

    startTransition(() => {
      router.replace(`${pathname}?${url.toString()}`);
    });
  }

  function handleSearchChange(value: string) {
    setQInput(value);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      pushFilters({ q: value });
    }, 400);
  }

  function goToPage(page: number) {
    pushFilters({ page }, false);
  }

  const hasFilters = Boolean(
    filters.q ||
      filters.from ||
      filters.to ||
      filters.company ||
      filters.responsible ||
      filters.sort !== "newest",
  );

  function clearFilters() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    setQInput("");

    startTransition(() => {
      router.replace(pathname);
    });
  }

  return (
    <div className="space-y-6">
      {/* HEADER */}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-[#ff4b0a]">
            Carteira
          </p>

          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
            Clientes
          </h1>

          <p className="mt-1 text-sm text-[#707782]">
            Clientes e apólices sincronizados com a Libax.
          </p>
        </div>

        <div className="inline-flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2 text-sm font-medium text-green-700">
          <ShieldCheck className="h-4 w-4" />
          Sincronização Libax ativa
        </div>
      </div>

      {/* CARDS */}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Clientes"
          value={String(data.stats.client_count)}
          subtitle="Na carteira"
          icon={<Users className="h-5 w-5 text-[#ff4b0a]" />}
        />

        <MetricCard
          title="Apólices"
          value={String(data.stats.policy_count)}
          subtitle="Importadas"
          icon={<FileText className="h-5 w-5 text-blue-600" />}
        />

        <MetricCard
          title="Emitidas hoje"
          value={String(data.stats.policies_today)}
          subtitle="Produção de hoje"
          icon={<CalendarDays className="h-5 w-5 text-green-600" />}
        />

        <MetricCard
          title="Prémio"
          value={formatCurrency(data.stats.total_premium)}
          subtitle="Total registado"
          icon={<CreditCard className="h-5 w-5 text-violet-600" />}
        />
      </section>

      {/* FILTROS */}

      <section
        className={`rounded-2xl border border-[#e5e8ec] bg-white p-4 shadow-[0_2px_10px_rgba(20,25,35,0.04)] transition-opacity ${
          isPending ? "opacity-60" : ""
        }`}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa0a8]" />

            <input
              type="search"
              value={qInput}
              onChange={(event) => handleSearchChange(event.target.value)}
              placeholder="Nome, NIF ou apólice..."
              className="w-full rounded-xl border border-[#e1e4e8] py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-[#ff4b0a]"
            />
          </div>

          <input
            type="date"
            value={filters.from}
            onChange={(event) => pushFilters({ from: event.target.value })}
            className="rounded-xl border border-[#e1e4e8] px-4 py-2.5 text-sm outline-none focus:border-[#ff4b0a]"
          />

          <input
            type="date"
            value={filters.to}
            onChange={(event) => pushFilters({ to: event.target.value })}
            className="rounded-xl border border-[#e1e4e8] px-4 py-2.5 text-sm outline-none focus:border-[#ff4b0a]"
          />

          <select
            value={filters.company}
            onChange={(event) => pushFilters({ company: event.target.value })}
            className="rounded-xl border border-[#e1e4e8] px-4 py-2.5 text-sm outline-none"
          >
            <option value="">Todas as companhias</option>

            {data.companies.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <select
            value={filters.responsible}
            onChange={(event) => pushFilters({ responsible: event.target.value })}
            className="rounded-xl border border-[#e1e4e8] px-4 py-2.5 text-sm outline-none"
          >
            <option value="">Todos os responsáveis</option>

            {data.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.full_name}
              </option>
            ))}
          </select>

          <select
            value={filters.sort}
            onChange={(event) =>
              pushFilters({
                sort: event.target.value as "newest" | "oldest",
              })
            }
            className="rounded-xl border border-[#e1e4e8] px-4 py-2.5 text-sm outline-none"
          >
            <option value="newest">Mais recentes</option>
            <option value="oldest">Mais antigas</option>
          </select>
        </div>

        <div className="mt-3 flex items-center justify-between gap-4">
          <p className="text-sm text-[#7d848e]">
            {data.totalCount} cliente{data.totalCount === 1 ? "" : "s"}
          </p>

          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-[#ff4b0a]"
            >
              <X className="h-4 w-4" />
              Limpar filtros
            </button>
          )}
        </div>
      </section>

      {/* CARTEIRA */}

      <section className="overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        <div className="flex items-center justify-between border-b border-[#edf0f2] px-5 py-4">
          <div>
            <h2 className="font-semibold text-[#20242a]">
              Carteira de clientes
            </h2>

            <p className="mt-1 text-sm text-[#7d848e]">
              Clientes e respetivas apólices.
            </p>
          </div>
        </div>

        {data.items.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f5f6f7]">
              <CircleUserRound className="h-6 w-6 text-[#7d848e]" />
            </div>

            <h3 className="mt-4 font-semibold text-[#20242a]">
              Nenhum resultado
            </h3>

            <p className="mt-1 text-sm text-[#7d848e]">
              Experimenta alterar ou limpar os filtros.
            </p>
          </div>
        ) : (
          <div
            className={`divide-y divide-[#edf0f2] transition-opacity ${
              isPending ? "opacity-60" : ""
            }`}
          >
            {data.items.map(({ client, policies }) => (
              <article
                key={client.id}
                className="p-5 transition hover:bg-[#fafbfc]"
              >
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 xl:w-[30%]">
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50">
                        <CircleUserRound className="h-5 w-5 text-[#ff4b0a]" />
                      </div>

                      <div className="min-w-0">
                        <h3 className="truncate font-semibold text-[#20242a]">
                          {client.name}
                        </h3>

                        <p className="mt-1 text-sm text-[#7d848e]">
                          NIF {client.nif ?? "—"}
                        </p>

                        <p className="mt-1 text-xs text-[#a0a5ac]">
                          ID Libax: {client.external_id}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="space-y-3">
                      {policies.map((policy) => {
                        const assignedProfile = policy.assigned_user_id
                          ? data.profiles.find((p) => p.id === policy.assigned_user_id)
                          : undefined;

                        return (
                          <div
                            key={policy.id}
                            className="grid gap-4 rounded-xl border border-[#e8eaed] bg-[#fafbfc] p-4 md:grid-cols-2 xl:grid-cols-[1.2fr_1.2fr_0.8fr_0.9fr_1fr]"
                          >
                            <div>
                              <div className="flex items-center gap-2 text-xs font-medium text-[#8a9099]">
                                <Building2 className="h-3.5 w-3.5" />
                                Companhia
                              </div>

                              <p className="mt-1 text-sm font-semibold text-[#20242a]">
                                {policy.company_name ?? "—"}
                              </p>

                              <p className="mt-1 text-xs text-[#7d848e]">
                                Apólice {policy.policy_number}
                              </p>
                            </div>

                            <div>
                              <div className="flex items-center gap-2 text-xs font-medium text-[#8a9099]">
                                <Car className="h-3.5 w-3.5" />
                                Seguro
                              </div>

                              <p className="mt-1 text-sm font-semibold text-[#20242a]">
                                {policy.line_name ?? policy.product_name ?? "—"}
                              </p>

                              <p className="mt-1 truncate text-xs text-[#7d848e]">
                                {policy.product_name ?? "—"}
                              </p>
                            </div>

                            <div>
                              <p className="text-xs font-medium text-[#8a9099]">
                                Prémio
                              </p>

                              <p className="mt-1 text-sm font-semibold text-[#20242a]">
                                {formatCurrency(policy.premium)}
                              </p>

                              <p className="mt-1 text-xs text-[#7d848e]">
                                {getFractionLabel(policy.fraction_type)}
                              </p>
                            </div>

                            <div>
                              <p className="text-xs font-medium text-[#8a9099]">
                                Emissão
                              </p>

                              <p className="mt-1 text-sm font-semibold text-[#20242a]">
                                {formatDate(policy.issue_date)}
                              </p>

                              <p className="mt-1 text-xs text-[#7d848e]">
                                Renova {formatDate(policy.renew_date)}
                              </p>
                            </div>

                            <div>
                              <p className="text-xs font-medium text-[#8a9099]">
                                Responsável
                              </p>

                              {assignedProfile ? (
                                <>
                                  <p className="mt-1 text-sm font-semibold text-[#20242a]">
                                    {assignedProfile.full_name}
                                  </p>

                                  <p className="mt-1 text-xs text-[#7d848e]">
                                    {policy.responsible_name
                                      ? `${policy.responsible_name} · Libax`
                                      : "Associado ao painel"}
                                  </p>
                                </>
                              ) : policy.responsible_name ? (
                                <>
                                  <p className="mt-1 text-sm font-semibold text-amber-700">
                                    {policy.responsible_name}
                                  </p>

                                  <p className="mt-1 text-xs font-medium text-amber-600">
                                    Por associar ao painel
                                  </p>
                                </>
                              ) : (
                                <>
                                  <p className="mt-1 text-sm font-semibold text-[#20242a]">
                                    Sem responsável
                                  </p>

                                  <p className="mt-1 text-xs text-[#7d848e]">
                                    Não definido na Libax
                                  </p>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        {data.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-[#edf0f2] px-5 py-3">
            <p className="text-xs text-[#8a9099]">
              Página {data.page} de {data.totalPages}
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={data.page <= 1}
                onClick={() => goToPage(data.page - 1)}
                className="rounded-lg border border-[#e1e4e8] px-3 py-1.5 text-xs font-medium text-[#59616d] transition hover:bg-[#f5f6f7] disabled:opacity-40"
              >
                Anterior
              </button>

              <button
                type="button"
                disabled={data.page >= data.totalPages}
                onClick={() => goToPage(data.page + 1)}
                className="rounded-lg border border-[#e1e4e8] px-3 py-1.5 text-xs font-medium text-[#59616d] transition hover:bg-[#f5f6f7] disabled:opacity-40"
              >
                Seguinte
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({
  title,
  value,
  subtitle,
  icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-[#737a84]">{title}</p>

        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f7f7f8]">
          {icon}
        </div>
      </div>

      <p className="mt-4 text-2xl font-semibold tracking-tight text-[#17191d]">
        {value}
      </p>

      <p className="mt-1 text-xs text-[#8a9099]">{subtitle}</p>
    </div>
  );
}