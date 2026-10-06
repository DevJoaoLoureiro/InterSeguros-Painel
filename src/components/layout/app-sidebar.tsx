"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { canAccessPage, hasFullAccess } from "@/lib/auth/permissions";

import { LogoutButton } from "@/components/auth/logout-button";
import { menuGroups } from "@/components/layout/navigation";

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

  const fullAccess = hasFullAccess(profile.role);

  return (
    <aside
      className={[
        "relative flex h-full shrink-0 flex-col overflow-hidden bg-white text-[#3a3632]",
        mobile ? "w-full" : "w-[270px] border-r border-[#ece7e2]",
      ].join(" ")}
    >
      {/* LOGO — mesma altura da barra de topo (68px) e a mesma linha
          por baixo, para o topo ser uma faixa contínua. */}

      <Link
        href="/dashboard"
        className="flex h-[68px] shrink-0 items-center justify-center overflow-hidden border-b border-[#ece7e2] transition hover:bg-[#faf8f6]"
      >
        {/* A imagem tem muita margem em branco: ampliada (scale não
            mexe na altura da faixa) e cortada pelo overflow. */}
        <img
          src="/interseguroslogo.png"
          alt="Inter Seguros"
          className="h-[64px] w-auto scale-[1.35] object-contain"
        />
      </Link>

      {/* MENU */}

      <nav className="sidebar-scroll relative min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-4">
        {menuGroups.map((group, groupIndex) => {
          // OWNER/ADMIN veem tudo; funcionários só as páginas de
          // EMPLOYEE_PAGES — mesma regra que o proxy aplica ao URL.
          const visibleItems = group.items.filter(
            (item) => fullAccess || canAccessPage(profile.role, item.href),
          );

          // Não mostrar grupos que ficaram sem itens
          if (visibleItems.length === 0) {
            return null;
          }

          return (
            <div key={group.title ?? groupIndex} className="mb-4">
              {group.title && (
                <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b0a79f]">
                  {group.title}
                </p>
              )}

              <div className="space-y-0.5">
                {visibleItems.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);

                  const Icon = item.icon;

                  const badge =
                    item.href === "/vencimentos" && overdueReceiptsCount > 0
                      ? overdueReceiptsCount
                      : undefined;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      className={[
                        "group relative flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition duration-200",
                        isActive
                          ? "bg-gradient-to-r from-[#ff6a2b] to-[#ea5b0c] text-white shadow-[0_6px_16px_rgba(234,91,12,0.32)]"
                          : "text-[#514943] hover:bg-[#f7f2ed] hover:text-[#2b2724]",
                      ].join(" ")}
                    >
                      <Icon
                        className={[
                          "h-[18px] w-[18px] shrink-0 transition duration-200",
                          isActive
                            ? ""
                            : "text-[#948b83] group-hover:scale-110 group-hover:text-[#ea5b0c]",
                        ].join(" ")}
                      />

                      <span className="min-w-0 flex-1 truncate">
                        {item.label}
                      </span>

                      {badge !== undefined && (
                        <span
                          className={[
                            "flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                            isActive
                              ? "bg-white/25 text-white"
                              : "bg-red-500 text-white",
                          ].join(" ")}
                          title="Recibos em atraso"
                        >
                          {badge}
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

      {/* UTILIZADOR */}

      <div className="relative shrink-0 border-t border-[#ece7e2] p-3">
        <div className="mb-1.5 flex items-center gap-3 rounded-xl border border-[#ece7e2] bg-[#faf8f6] p-2.5">
          {/* Mesmo degradê do símbolo do logótipo */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#ff6a2b] via-[#d9570f] to-[#3a3632] text-sm font-semibold text-white shadow-[0_4px_12px_rgba(58,54,50,0.22)]">
            {initials}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[#2b2724]">
              {profile.full_name}
            </p>

            <p className="truncate text-[11px] text-[#948b83]">
              {formatRole(profile.role)} · {storeName}
            </p>
          </div>
        </div>

        <LogoutButton />
      </div>
    </aside>
  );
}
