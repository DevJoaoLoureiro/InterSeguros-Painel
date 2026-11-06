import Link from "next/link";
import { CalendarClock, ReceiptText } from "lucide-react";

/*
 * Vencimentos e Recibos são uma só entrada no menu: "A tratar"
 * (/vencimentos) e "Histórico de recibos" (/recibos) são separadores
 * da mesma secção.
 */

const SECTIONS = [
  { key: "todo", label: "A tratar", href: "/vencimentos", icon: CalendarClock },
  {
    key: "history",
    label: "Histórico de recibos",
    href: "/recibos",
    icon: ReceiptText,
  },
] as const;

export function VencimentosRecibosHeader({
  current,
  description,
  actions,
}: {
  current: (typeof SECTIONS)[number]["key"];
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-[#ff4b0a]">Carteira</p>

          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
            Vencimentos e Recibos
          </h1>

          <p className="mt-1 text-sm text-[#737a84]">{description}</p>
        </div>

        {actions}
      </div>

      <nav className="flex gap-1 border-b border-[#e5e8ec]">
        {SECTIONS.map((section) => {
          const active = section.key === current;
          const Icon = section.icon;

          return (
            <Link
              key={section.key}
              href={section.href}
              aria-current={active ? "page" : undefined}
              className={[
                "-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition",
                active
                  ? "border-[#ff4b0a] text-[#20242a]"
                  : "border-transparent text-[#7d848e] hover:text-[#40464f]",
              ].join(" ")}
            >
              <Icon className="h-4 w-4" />
              {section.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
