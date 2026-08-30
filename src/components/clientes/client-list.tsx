"use client";

import {
  CreditCard,
  FileText,
  Search,
  ShieldCheck,
  UserRound,
  Users,
  X,
} from "lucide-react";

import { PolicyDetailsDrawer } from "@/components/clientes/policy-details-drawer";
import { ClientsTable } from "@/components/clientes/clients-table";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import { getClientsPortfolioData } from "@/app/(dashboard)/clientes/action";

import type { ClientsPortfolioData } from "@/components/clientes/types";

// ==========================================
// TYPES
// ==========================================

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
  data: ClientsPortfolioData;
  filters: Filters;
};

// ==========================================
// FORMATTERS
// ==========================================

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "—";
  }

  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

// ==========================================
// COMPONENT
// ==========================================

export default function ClientsList({
  data: initialData,
  filters: initialFilters,
}: Props) {
  const [data, setData] = useState(initialData);

  const [selectedClient, setSelectedClient] = useState<
    ClientsPortfolioData["items"][number] | null
  >(null);

  const [filters, setFilters] = useState(initialFilters);
  const [qInput, setQInput] = useState(initialFilters.q);
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);

  const [isPending, startTransition] = useTransition();

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const requestIdRef = useRef(0);

  useEffect(() => {
    setQInput(filters.q);
  }, [filters.q]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // ========================================
  // COMERCIAIS vs GESTORES
  // ========================================

  const commercials = data.profiles.filter(
    (profile) => profile.role === "COMERCIAL",
  );

  const managers = data.profiles.filter(
    (profile) => profile.role === "GESTOR_LOJA",
  );

  const visibleItems = onlyUnassigned
    ? data.items.filter((item) =>
        item.policies.some((policy) => !policy.commercial_user_id),
      )
    : data.items;

  // ========================================
  // URL
  // ========================================

  function updateUrl(nextFilters: Filters) {
    const params = new URLSearchParams();

    if (nextFilters.q) {
      params.set("q", nextFilters.q);
    }

    if (nextFilters.from) {
      params.set("from", nextFilters.from);
    }

    if (nextFilters.to) {
      params.set("to", nextFilters.to);
    }

    if (nextFilters.company) {
      params.set("company", nextFilters.company);
    }

    if (nextFilters.responsible) {
      params.set("responsible", nextFilters.responsible);
    }

    if (nextFilters.sort !== "newest") {
      params.set("sort", nextFilters.sort);
    }

    if (nextFilters.page > 1) {
      params.set("page", String(nextFilters.page));
    }

    const query = params.toString();

    const url = query
      ? `${window.location.pathname}?${query}`
      : window.location.pathname;

    window.history.replaceState(null, "", url);
  }

  // ========================================
  // LOAD DATA
  // ========================================

  async function loadData(nextFilters: Filters) {
    const requestId = ++requestIdRef.current;

    setFilters(nextFilters);
    updateUrl(nextFilters);

    startTransition(async () => {
      try {
        const result = await getClientsPortfolioData({
          search: nextFilters.q,
          from: nextFilters.from,
          to: nextFilters.to,
          company: nextFilters.company,
          responsible: nextFilters.responsible,
          sort: nextFilters.sort,
          page: nextFilters.page,
        });

        if (requestId !== requestIdRef.current) {
          return;
        }

        setData(result);

        if (result.page !== nextFilters.page) {
          const corrected = {
            ...nextFilters,
            page: result.page,
          };

          setFilters(corrected);
          updateUrl(corrected);
        }
      } catch (error) {
        console.error(
          "Erro ao carregar carteira V2:",
          error,
        );
      }
    });
  }

  function pushFilters(next: Partial<Filters>, resetPage = true) {
    const nextFilters: Filters = {
      ...filters,
      ...next,
      page: resetPage ? 1 : next.page ?? filters.page,
    };

    void loadData(nextFilters);
  }

  function handleSearchChange(value: string) {
    setQInput(value);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      pushFilters({ q: value.trim() });
    }, 250);
  }

  function goToPage(page: number) {
    pushFilters({ page }, false);
  }

  function clearFilters() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    setQInput("");
    setOnlyUnassigned(false);

    const cleared: Filters = {
      q: "",
      from: "",
      to: "",
      company: "",
      responsible: "",
      sort: "newest",
      page: 1,
    };

    void loadData(cleared);
  }

  const hasFilters = Boolean(
    filters.q ||
      filters.from ||
      filters.to ||
      filters.company ||
      filters.responsible ||
      filters.sort !== "newest",
  );

  // ========================================
  // UI
  // ========================================

  return (
    <div className="space-y-6">
      {/* ====================================
          HEADER
      ==================================== */}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-[#ff4b0a]">
            Carteira
          </p>

          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
            Clientes
          </h1>

          <p className="mt-1 text-sm text-[#707782]">
            Clientes e apólices centralizados no Inter Seguros.
          </p>
        </div>

        <div className="inline-flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2 text-sm font-medium text-green-700">
          <ShieldCheck className="h-4 w-4" />
          Dados das seguradoras ativos
        </div>
      </div>

      {/* ====================================
          METRICS
      ==================================== */}

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
          subtitle="No âmbito selecionado"
          icon={<FileText className="h-5 w-5 text-blue-600" />}
        />

        <MetricCard
          title="Apólices ativas"
          value={String(data.stats.active_policy_count)}
          subtitle="Estado ativo"
          icon={<ShieldCheck className="h-5 w-5 text-green-600" />}
        />

        <MetricCard
          title="Carteira anualizada"
          value={formatCurrency(data.stats.annualized_premium)}
          subtitle="Apólices ativas"
          icon={<CreditCard className="h-5 w-5 text-violet-600" />}
        />
      </section>

      {/* ====================================
          FILTERS
      ==================================== */}

      <section
        className={`rounded-2xl border border-[#e5e8ec] bg-white p-4 shadow-[0_2px_10px_rgba(20,25,35,0.04)] transition-opacity ${
          isPending ? "opacity-60" : ""
        }`}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa0a8]" />

            <input
              type="search"
              value={qInput}
              onChange={(event) =>
                handleSearchChange(event.target.value)
              }
              placeholder="Nome, NIF ou apólice..."
              className="w-full rounded-xl border border-[#e1e4e8] py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-[#ff4b0a]"
            />
          </div>

          <input
            type="date"
            value={filters.from}
            onChange={(event) =>
              pushFilters({ from: event.target.value })
            }
            className="rounded-xl border border-[#e1e4e8] px-4 py-2.5 text-sm outline-none focus:border-[#ff4b0a]"
          />

          <input
            type="date"
            value={filters.to}
            onChange={(event) =>
              pushFilters({ to: event.target.value })
            }
            className="rounded-xl border border-[#e1e4e8] px-4 py-2.5 text-sm outline-none focus:border-[#ff4b0a]"
          />

          <select
            value={filters.company}
            onChange={(event) =>
              pushFilters({ company: event.target.value })
            }
            className="rounded-xl border border-[#e1e4e8] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#ff4b0a]"
          >
            <option value="">Todas as companhias</option>

            {data.companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>

        {commercials.length > 0 && (
        <select
          value={filters.responsible}
          onChange={(event) =>
            pushFilters({ responsible: event.target.value })
          }
          className="rounded-xl border border-[#e1e4e8] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#ff4b0a]"
        >
          <option value="">Todos os comerciais</option>

          {commercials.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.full_name}
            </option>
          ))}
        </select>
      )}

          <select
            value={filters.responsible}
            onChange={(event) =>
              pushFilters({ responsible: event.target.value })
            }
            className="rounded-xl border border-[#e1e4e8] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#ff4b0a]"
          >
            <option value="">Todos os gestores</option>

            {managers.map((profile) => (
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
            className="rounded-xl border border-[#e1e4e8] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#ff4b0a]"
          >
            <option value="newest">Mais recentes</option>
            <option value="oldest">Mais antigas</option>
          </select>
        </div>

        
      </section>

      {/* ====================================
          CLIENT LIST
      ==================================== */}

      <ClientsTable
        items={visibleItems}
        onSelectClient={setSelectedClient}
        totalCount={data.totalCount}
        onlyUnassigned={onlyUnassigned}
        onToggleUnassigned={() => setOnlyUnassigned((v) => !v)}
        hasFilters={hasFilters}
        onClearFilters={clearFilters}
      />

      {/* PAGINATION */}

      {data.totalPages > 1 && (
        <div className="flex items-center justify-between rounded-2xl border border-[#e5e8ec] bg-white px-5 py-3 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
          <p className="text-xs text-[#8a9099]">
            Página {data.page} de {data.totalPages}
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={data.page <= 1 || isPending}
              onClick={() => goToPage(data.page - 1)}
              className="rounded-lg border border-[#e1e4e8] px-3 py-1.5 text-xs font-medium text-[#59616d] transition hover:bg-[#f5f6f7] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Anterior
            </button>

            <button
              type="button"
              disabled={data.page >= data.totalPages || isPending}
              onClick={() => goToPage(data.page + 1)}
              className="rounded-lg border border-[#e1e4e8] px-3 py-1.5 text-xs font-medium text-[#59616d] transition hover:bg-[#f5f6f7] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Seguinte
            </button>
          </div>
        </div>
      )}

      <PolicyDetailsDrawer
        clientName={selectedClient?.client.name ?? ""}
        clientNif={selectedClient?.client.nif ?? null}
        policies={selectedClient?.policies ?? []}
        open={Boolean(selectedClient)}
        onClose={() => setSelectedClient(null)}
      />
    </div>
  );
}

// ==========================================
// METRIC CARD
// ==========================================

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