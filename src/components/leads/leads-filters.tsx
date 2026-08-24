import { Search, SlidersHorizontal, X } from "lucide-react";

type LeadsFiltersProps = {
  search: string;
  status: string;
  insuranceType: string;
  store: string;
  stores: StoreOption[];
  onSearchChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onInsuranceTypeChange: (value: string) => void;
  onStoreChange: (value: string) => void;
  onClear: () => void;
};
type StoreOption = {
  id: string;
  name: string;
};


export function LeadsFilters({
  search,
  status,
  insuranceType,
  store,
  stores,
  onSearchChange,
  onStatusChange,
  onInsuranceTypeChange,
  onStoreChange,
  onClear,
}: LeadsFiltersProps) {
  const hasFilters =
    search !== "" ||
    status !== "todos" ||
    insuranceType !== "todos" ||
    store !== "todas";

  return (
    <div className="rounded-2xl border border-[#e7e9ec] bg-white p-4 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#424852]">
        <SlidersHorizontal className="h-4 w-4" />
        Filtros
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(240px,1fr)_190px_190px_170px_auto]">
        <div className="relative min-w-0">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a9099]" />

          <input
            value={search}
            onChange={(event) =>
              onSearchChange(event.target.value)
            }
            placeholder="Nome, telefone ou email"
            className="h-11 w-full rounded-xl border border-[#e1e4e8] bg-white pl-10 pr-4 text-sm outline-none transition focus:border-[#ff4b0a] focus:ring-2 focus:ring-orange-100"
          />
        </div>

        <select
          value={status}
          onChange={(event) =>
            onStatusChange(event.target.value)
          }
          className="h-11 min-w-0 rounded-xl border border-[#e1e4e8] bg-white px-3 text-sm outline-none focus:border-[#ff4b0a]"
        >
          <option value="todos">Todos os estados</option>
          <option value="nova">Nova</option>
          <option value="em_contacto">Em contacto</option>
          <option value="a_aguardar">A aguardar</option>
          <option value="simulacao_enviada">
            Simulação enviada
          </option>
          <option value="convertida">Convertida</option>
          <option value="perdida">Perdida</option>
        </select>

        <select
          value={insuranceType}
          onChange={(event) =>
            onInsuranceTypeChange(event.target.value)
          }
          className="h-11 min-w-0 rounded-xl border border-[#e1e4e8] bg-white px-3 text-sm outline-none focus:border-[#ff4b0a]"
        >
          <option value="todos">Todos os seguros</option>
          <option value="Automóvel">Automóvel</option>
          <option value="Vida">Vida</option>
          <option value="Multirriscos">Multirriscos</option>
          <option value="Acidentes Pessoais">
            Acidentes Pessoais
          </option>
        </select>

          <select
        value={store}
        onChange={(event) =>
          onStoreChange(event.target.value)
        }
        className="h-11 min-w-0 rounded-xl border border-[#e1e4e8] bg-white px-3 text-sm outline-none focus:border-[#ff4b0a]"
      >
        <option value="todas">
          Todas as lojas
        </option>

        {stores.map((storeItem) => (
          <option
            key={storeItem.id}
            value={storeItem.id}
          >
            {storeItem.name}
          </option>
        ))}
      </select>

        <button
          type="button"
          onClick={onClear}
          disabled={!hasFilters}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#e1e4e8] px-4 text-sm font-medium text-[#59616d] transition hover:bg-[#f5f6f7] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <X className="h-4 w-4" />
          Limpar
        </button>
      </div>
    </div>
  );
}