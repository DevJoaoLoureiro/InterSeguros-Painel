import { Download, Plus } from "lucide-react";

type LeadsHeaderProps = {
  total: number;
};

export function LeadsHeader({
  total,
}: LeadsHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-[#17191d]">
          Leads
        </h2>

        <p className="mt-1 text-sm text-[#6b7280]">
          Gere as oportunidades recebidas através do chatbot.
        </p>

        <p className="mt-2 text-xs font-medium text-[#8a9099]">
          {total} leads registadas
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#dde1e6] bg-white px-4 text-sm font-semibold text-[#424852] transition-colors hover:bg-[#f5f6f7]"
        >
          <Download className="h-4 w-4" />
          Exportar
        </button>

        <button
          type="button"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#ff4b0a] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#e94308]"
        >
          <Plus className="h-4 w-4" />
          Nova lead
        </button>
      </div>
    </div>
  );
}