import { Circle } from "lucide-react";

import type { LeadPriority } from "@/types/lead";

const priorityConfig: Record<
  LeadPriority,
  {
    label: string;
    className: string;
  }
> = {
  baixa: {
    label: "Baixa",
    className: "text-slate-500",
  },
  media: {
    label: "Média",
    className: "text-blue-600",
  },
  alta: {
    label: "Alta",
    className: "text-orange-600",
  },
  urgente: {
    label: "Urgente",
    className: "text-red-600",
  },
};

type LeadPriorityBadgeProps = {
  priority: LeadPriority;
};

export function LeadPriorityBadge({
  priority,
}: LeadPriorityBadgeProps) {
  const config = priorityConfig[priority];

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold ${config.className}`}
    >
      <Circle className="h-2.5 w-2.5 fill-current" />
      {config.label}
    </span>
  );
}