import type { LeadStatus } from "@/types/lead";

type LeadStatusBadgeProps = {
  status: LeadStatus;
};

const statusConfig: Record<
  LeadStatus,
  {
    label: string;
    className: string;
  }
> = {
  nova: {
    label: "Nova",
    className: "bg-blue-50 text-blue-700",
  },

  em_contacto: {
    label: "Em contacto",
    className: "bg-amber-50 text-amber-700",
  },

  a_aguardar: {
    label: "A aguardar",
    className: "bg-yellow-50 text-yellow-700",
  },

  simulacao_enviada: {
    label: "Simulação enviada",
    className: "bg-violet-50 text-violet-700",
  },

  proposta: {
    label: "Proposta",
    className: "bg-purple-50 text-purple-700",
  },

  ganha: {
    label: "Ganha",
    className: "bg-emerald-50 text-emerald-700",
  },

  convertida: {
    label: "Convertida",
    className: "bg-green-50 text-green-700",
  },

  perdida: {
    label: "Perdida",
    className: "bg-red-50 text-red-700",
  },
};

export function LeadStatusBadge({
  status,
}: LeadStatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        config.className,
      ].join(" ")}
    >
      {config.label}
    </span>
  );
}