import type { Lead, LeadStatus } from "@/types/lead";

type LeadsSummaryProps = {
  leads: Lead[];
  selectedStatus: string;
  onStatusChange: (status: string) => void;
};

const cards: Array<{
  label: string;
  status: LeadStatus;
  accentClassName: string;
}> = [
  {
    label: "Novas",
    status: "nova",
    accentClassName: "bg-orange-500",
  },
  {
    label: "Em contacto",
    status: "em_contacto",
    accentClassName: "bg-blue-500",
  },
  {
    label: "A aguardar",
    status: "a_aguardar",
    accentClassName: "bg-amber-500",
  },
  {
    label: "Convertidas",
    status: "convertida",
    accentClassName: "bg-green-500",
  },
  {
    label: "Perdidas",
    status: "perdida",
    accentClassName: "bg-red-500",
  },
];

export function LeadsSummary({
  leads,
  selectedStatus,
  onStatusChange,
}: LeadsSummaryProps) {
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => {
        const total = leads.filter(
          (lead) => lead.status === card.status,
        ).length;

        const isSelected = selectedStatus === card.status;

        return (
          <button
            key={card.status}
            type="button"
            onClick={() =>
              onStatusChange(isSelected ? "todos" : card.status)
            }
            className={[
              "relative overflow-hidden rounded-2xl border bg-white p-5 text-left shadow-[0_2px_10px_rgba(20,25,35,0.04)] transition",
              isSelected
                ? "border-[#ff4b0a] ring-2 ring-orange-100"
                : "border-[#e7e9ec] hover:-translate-y-0.5 hover:shadow-md",
            ].join(" ")}
          >
            <div
              className={`absolute inset-x-0 top-0 h-1 ${card.accentClassName}`}
            />

            <p className="text-sm font-medium text-[#6b7280]">
              {card.label}
            </p>

            <p className="mt-2 text-3xl font-semibold tracking-tight text-[#17191d]">
              {total}
            </p>
          </button>
        );
      })}
    </section>
  );
}