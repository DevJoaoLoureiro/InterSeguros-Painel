"use client";

import { useState } from "react";
import {
  AlertCircle,
  Bell,
  Building2,
  CalendarClock,
  ChevronDown,
  ClipboardList,
  CloudOff,
  ReceiptText,
  Search,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { MobileSidebar } from "@/components/layout/mobile-sidebar";
import { openCommandPalette } from "@/components/layout/navigation";

import type { NotificationItem } from "@/lib/notifications/get-notifications";

type HeaderStore = {
  id: string;
  name: string;
  code: string | null;
};

type HeaderProfile = {
  full_name: string;
  role: string;
  email?: string;

  store: HeaderStore | null;
};

type DashboardHeaderProps = {
  title?: string;
  subtitle?: string;

  profile: HeaderProfile;

  stores: HeaderStore[];

  selectedStoreId?: string | null;

  notifications?: NotificationItem[];
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

/*
 * Título e subtítulo por rota. O layout não os passa, e sem isto todas as
 * páginas mostram o valor por omissão ("Dashboard"). Só as rotas listadas
 * aqui são afetadas.
 */
const PAGE_HEADERS: Record<string, { title: string; subtitle: string }> = {
  "/simulador": {
    title: "Simulador",
    subtitle: "Compare estimativas e cotações de várias seguradoras",
  },
};

function getPageHeader(pathname: string) {
  const match = Object.keys(PAGE_HEADERS).find(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  return match ? PAGE_HEADERS[match] : null;
}

const notificationIcons = {
  task: ClipboardList,
  receipt: ReceiptText,
  renewal: CalendarClock,
  sync: CloudOff,
};

export function DashboardHeader({
  profile,

  stores,

  selectedStoreId,

  notifications = [],
}: DashboardHeaderProps) {
  const initials = getInitials(profile.full_name);

  const pageHeader = getPageHeader(usePathname());

  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const currentStoreId = selectedStoreId ?? profile.store?.id ?? "all";

  function handleStoreChange(storeId: string) {
    document.cookie = `selected_store_id=${storeId}; path=/; max-age=31536000; samesite=lax`;

    window.location.reload();
  }

  return (
    <header className="sticky top-[3px] z-30 w-full border-b border-[#ece7e2] bg-white">
      <div className="flex h-[67px] min-w-0 items-center justify-between gap-2 px-3 sm:px-5 lg:px-7">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <MobileSidebar profile={profile} />

          {/* Só as páginas sem título próprio o mostram aqui. */}
          {pageHeader && (
            <div className="min-w-0 shrink">
              <h1 className="truncate text-lg font-semibold tracking-tight text-[#17191d]">
                {pageHeader.title}
              </h1>

              <p className="hidden truncate text-xs text-[#777f8a] xl:block">
                {pageHeader.subtitle}
              </p>
            </div>
          )}

          {/* PESQUISA RÁPIDA (abre com Ctrl+K) */}

          <button
            type="button"
            onClick={openCommandPalette}
            className="group flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-[#e4e6e9] bg-white/80 px-3 text-sm text-[#8a9099] shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:border-[#ffb899] hover:text-[#59616d] sm:max-w-md"
          >
            <Search className="h-4 w-4 shrink-0 transition-colors group-hover:text-[#ff4b0a]" />
            <span className="flex-1 truncate text-left">
              Procurar cliente ou ir para uma página…
            </span>
            <kbd className="hidden rounded-md border border-[#e4e6e9] bg-[#f7f8f9] px-1.5 py-0.5 font-sans text-[10px] font-medium text-[#7d848e] sm:block">
              Ctrl K
            </kbd>
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-3">
          {/* LOJA */}

          <div className="relative hidden md:block">
            <Building2 className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#525963]" />

            <select
              value={currentStoreId}
              onChange={(event) => handleStoreChange(event.target.value)}
              className="h-10 min-w-[200px] appearance-none rounded-xl border border-[#e4e6e9] bg-white/80 py-0 pl-11 pr-10 text-sm font-medium text-[#353b44] shadow-[0_1px_2px_rgba(16,24,40,0.04)] outline-none transition hover:border-[#ffb899] focus:border-[#ff4b0a]"
            >
              <option value="all">Todas as lojas</option>

              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>

            <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7a818b]" />
          </div>

          {/* NOTIFICAÇÕES */}

          <div className="relative">
            <button
              type="button"
              onClick={() => setNotificationsOpen((v) => !v)}
              className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-transparent text-[#525963] transition hover:border-[#e4e6e9] hover:bg-white"
              aria-label="Notificações"
            >
              <Bell className="h-5 w-5" />

              {notifications.length > 0 && (
                <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff4b0a] px-1 text-[9px] font-bold text-white ring-2 ring-white">
                  {notifications.length}
                </span>
              )}
            </button>

            {notificationsOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setNotificationsOpen(false)}
                  aria-label="Fechar notificações"
                />

                <div className="absolute right-0 top-12 z-50 w-80 animate-pop-in overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_20px_50px_rgba(20,22,27,0.18)]">
                  <div className="border-b border-[#edf0f2] px-4 py-3">
                    <p className="text-sm font-semibold text-[#20242a]">
                      Notificações
                    </p>
                  </div>

                  <div className="max-h-80 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="px-4 py-8 text-center text-sm text-[#8a9099]">
                        Sem notificações pendentes.
                      </p>
                    ) : (
                      <div className="divide-y divide-[#edf0f2]">
                        {notifications.map((notification) => {
                          const Icon =
                            notificationIcons[notification.type];

                          return (
                            <Link
                              key={notification.id}
                              href={notification.href}
                              onClick={() => setNotificationsOpen(false)}
                              className="flex items-start gap-3 px-4 py-3 transition hover:bg-[#fafbfc]"
                            >
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
                                <Icon className="h-4 w-4" />
                              </div>

                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-[#20242a]">
                                  {notification.title}
                                </p>

                                <p className="mt-0.5 flex items-center gap-1 text-xs text-red-600">
                                  <AlertCircle className="h-3 w-3" />
                                  {notification.subtitle}
                                </p>
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="hidden h-8 w-px bg-[#e6e8eb] sm:block" />

          {/* PERFIL */}

          <button
            type="button"
            className="hidden items-center gap-2 rounded-xl p-1.5 transition-colors hover:bg-[#f4f5f7] sm:flex xl:pr-3"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#ff6a2b] via-[#d9570f] to-[#3a3632] text-xs font-semibold text-white shadow-[0_4px_12px_rgba(58,54,50,0.22)]">
              {initials}
            </div>

            <div className="hidden min-w-0 text-left xl:block">
              <p className="max-w-[160px] truncate text-sm font-semibold text-[#20242a]">
                {profile.full_name}
              </p>

              <p className="text-xs text-[#747b85]">
                {formatRole(profile.role)}
              </p>
            </div>

            <ChevronDown className="hidden h-4 w-4 text-[#747b85] xl:block" />
          </button>
        </div>
      </div>
    </header>
  );
}