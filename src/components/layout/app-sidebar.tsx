"use client";

import type { ElementType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  CalendarDays,
  ChevronDown,
  CircleUserRound,
  FileText,
  Gauge,
  MessageCircle,
  ReceiptText,
  Settings,
  Target,
  Users,
} from "lucide-react";

import { LogoutButton } from "@/components/auth/logout-button";

type SidebarProfile = {
  full_name: string;
  role: string;
  email?: string;
  store:
    | {
        id: string;
        name: string;
        code: string | null;
      }
    | null;
};

type AppSidebarProps = {
  mobile?: boolean;
  profile: SidebarProfile;
  overdueReceiptsCount?: number;
};

type MenuItem = {
  label: string;
  href: string;
  icon: ElementType;
  badge?: number;
};

type MenuGroup = {
  title?: string;
  items: MenuItem[];
};

const menuGroups: MenuGroup[] = [
  {
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: Gauge,
      },
    ],
  },
  {
    title: "LEADS",
    items: [
      {
        label: "Leads (Chat)",
        href: "/leads",
        icon: MessageCircle,
      },
    ],
  },
  {
    title: "CARTEIRA",
    items: [
      {
        label: "Clientes",
        href: "/clientes",
        icon: Users,
      },
      {
        label: "Recibos",
        href: "/recibos",
        icon: ReceiptText,
      },
      {
        label: "Vencimentos",
        href: "/vencimentos",
        icon: CalendarDays,
      },
      {
        label: "Carteira por Loja",
        href: "/carteira",
        icon: Building2,
      },
    ],
  },
  {
    title: "ATIVIDADES",
    items: [
      {
        label: "Tarefas",
        href: "/tarefas",
        icon: FileText,
      },
      {
        label: "Oportunidades",
        href: "/oportunidades",
        icon: Target,
      },
    ],
  },
  {
    title: "ANÁLISES",
    items: [
      {
        label: "Estatísticas",
        href: "/estatisticas",
        icon: BarChart3,
      },
    ],
  },
  {
    title: "GESTÃO",
    items: [
      {
        label: "Lojas",
        href: "/lojas",
        icon: Building2,
      },
      {
        label: "Utilizadores",
        href: "/utilizadores",
        icon: CircleUserRound,
      },
      {
        label: "Configurações",
        href: "/configuracoes",
        icon: Settings,
      },
    ],
  },
];

function getInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatRole(role: string) {
  switch (role) {
    case "OWNER":
      return "Owner";
    case "ADMIN":
      return "Administrador";
    case "GESTOR_LOJA":
      return "Gestor de Loja";
    case "COMERCIAL":
      return "Comercial";
    default:
      return role;
  }
}

export function AppSidebar({
  mobile = false,
  profile,
  overdueReceiptsCount = 0,
}: AppSidebarProps) {
  const pathname = usePathname();

  const initials = getInitials(profile.full_name);
  const storeName = profile.store?.name ?? "Sem loja atribuída";

  const isOwnerOrAdmin =
    profile.role === "OWNER" || profile.role === "ADMIN";

  return (
    <aside
      className={[
        "flex h-dvh shrink-0 flex-col bg-white",
        mobile
          ? "w-full border-r-0"
          : "w-[270px] border-r border-[#e8eaed]",
      ].join(" ")}
    >
      <div className="flex h-[94px] shrink-0 items-center border-b border-[#e8eaed] px-6">
        <img
          src="/interseguroslogo.png"
          alt="Inter Seguros Logo"
          className="h-15 w-auto object-contain"
        />
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
        {menuGroups.map((group, groupIndex) => {
          // Toda a secção GESTÃO é exclusiva de OWNER e ADMIN
          if (group.title === "GESTÃO" && !isOwnerOrAdmin) {
            return null;
          }

          const visibleItems = group.items.filter((item) => {
            // Carteira por Loja e Estatísticas também são
            // exclusivas de OWNER e ADMIN
            const restrictedToOwnerAndAdmin =
              item.href === "/carteira" ||
              item.href === "/estatisticas";

            if (restrictedToOwnerAndAdmin) {
              return isOwnerOrAdmin;
            }

            return true;
          });

          // Não mostrar grupos que ficaram sem itens
          if (visibleItems.length === 0) {
            return null;
          }

          return (
            <div
              key={group.title ?? groupIndex}
              className={groupIndex === 0 ? "mb-5" : "mb-6"}
            >
              {group.title && (
                <p className="mb-2 px-3 text-[11px] font-semibold tracking-wide text-[#7a8390]">
                  {group.title}
                </p>
              )}

              <div className="space-y-1">
                {visibleItems.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);

                  const Icon = item.icon;

                  const dynamicBadge =
                    item.href === "/vencimentos" &&
                    overdueReceiptsCount > 0
                      ? overdueReceiptsCount
                      : item.badge;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={[
                        "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-[#ff4b0a] text-white shadow-sm"
                          : "text-[#31363f] hover:bg-[#f4f5f7]",
                      ].join(" ")}
                    >
                      <Icon className="h-[18px] w-[18px] shrink-0" />

                      <span className="min-w-0 flex-1 truncate">
                        {item.label}
                      </span>

                      {dynamicBadge !== undefined && (
                        <span
                          className={[
                            "flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                            isActive
                              ? "bg-white/20 text-white"
                              : "bg-red-500 text-white",
                          ].join(" ")}
                        >
                          {dynamicBadge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-[#e8eaed] p-3">
        <button
          type="button"
          className="mb-2 flex w-full items-center gap-3 rounded-xl border border-[#e8eaed] p-3 text-left transition-colors hover:bg-[#f7f8fa]"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#242a32] text-sm font-semibold text-white">
            {initials}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[#24272d]">
              {profile.full_name}
            </p>

            <p className="truncate text-xs text-[#707782]">
              {storeName}
            </p>

            <p className="mt-0.5 truncate text-[11px] text-[#9aa0a8]">
              {formatRole(profile.role)}
            </p>
          </div>

          <ChevronDown className="h-4 w-4 shrink-0 text-[#707782]" />
        </button>

        <LogoutButton />
      </div>
    </aside>
  );
}