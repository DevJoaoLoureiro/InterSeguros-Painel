import type { LeadStatus } from "@/types/lead";

const statusConfig: Record<
  LeadStatus,
  {
    label: string;
    className: string;
  }
> = {
  nova: {
    label: "Nova",
    className: "bg-orange-100 text-orange-700",
  },
  em_contacto: {
    label: "Em contacto",
    className: "bg-blue-100 text-blue-700",
  },
  a_aguardar: {
    label: "A aguardar",
    className: "bg-amber-100 text-amber-700",
  },
  simulacao_enviada: {
    label: "Simulação enviada",
    className: "bg-purple-100 text-purple-700",
  },
  convertida: {
    label: "Convertida",
    className: "bg-green-100 text-green-700",
  },
  perdida: {
    label: "Perdida",
    className: "bg-red-100 text-red-700",
  },
};

type LeadStatusBadgeProps = {
  status: LeadStatus;
};

export function LeadStatusBadge({
  status,
}: LeadStatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${config.className}`}
    >
      {config.label}
    </span>
  );
}