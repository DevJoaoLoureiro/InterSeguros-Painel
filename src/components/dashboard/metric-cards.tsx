import type { LucideIcon } from "lucide-react";
import {
  BadgeEuro,
  MessageCircle,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";

type Metric = {
  label: string;
  value: string;
  change: string;
  description: string;
  icon: LucideIcon;
  iconClassName: string;
};

const metrics: Metric[] = [
  {
    label: "Novas Leads (Chat)",
    value: "128",
    change: "+18%",
    description: "vs mês anterior",
    icon: MessageCircle,
    iconClassName: "bg-orange-100 text-[#ff4b0a]",
  },
  {
    label: "Simulações Enviadas",
    value: "86",
    change: "+12%",
    description: "vs mês anterior",
    icon: Send,
    iconClassName: "bg-blue-100 text-blue-600",
  },
  {
    label: "Leads Convertidas",
    value: "32",
    change: "+14%",
    description: "vs mês anterior",
    icon: ShieldCheck,
    iconClassName: "bg-green-100 text-green-600",
  },
  {
    label: "Renovações",
    value: "45",
    change: "+20%",
    description: "vs mês anterior",
    icon: RefreshCw,
    iconClassName: "bg-purple-100 text-purple-600",
  },
  {
    label: "Prémios Gerados",
    value: "27.450 €",
    change: "+15%",
    description: "vs mês anterior",
    icon: BadgeEuro,
    iconClassName: "bg-amber-100 text-amber-600",
  },
];

export function MetricCards() {
  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
      {metrics.map((metric) => {
        const Icon = metric.icon;

        return (
          <article
            key={metric.label}
            className="rounded-2xl border border-[#e7e9ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]"
          >
            <div className="flex items-start gap-4">
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${metric.iconClassName}`}
              >
                <Icon className="h-5 w-5" />
              </div>

              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-[#4e5560]">
                  {metric.label}
                </p>

                <div className="mt-1 flex items-end gap-2">
                  <p className="text-2xl font-semibold tracking-tight text-[#17191d]">
                    {metric.value}
                  </p>
                  <span className="pb-1 text-xs font-semibold text-green-600">
                    {metric.change}
                  </span>
                </div>

                <p className="mt-2 text-[11px] text-[#818792]">
                  {metric.description}
                </p>
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}
