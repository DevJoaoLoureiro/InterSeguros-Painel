"use client";

import {
  Bell,
  Building2,
  ChevronDown,
} from "lucide-react";

import {
  MobileSidebar,
} from "@/components/layout/mobile-sidebar";

type HeaderStore = {
  id: string;
  name: string;
  code: string;
};

type HeaderProfile = {
  full_name: string;
  role: string;
  email?: string;

  store:
    | HeaderStore
    | null;
};

type DashboardHeaderProps = {
  title?: string;
  subtitle?: string;

  profile:
    HeaderProfile;

  stores:
    HeaderStore[];

  selectedStoreId?:
    | string
    | null;
};

function getInitials(
  name: string,
) {
  return name
    .trim()
    .split(/\s+/)
    .map(
      (part) =>
        part[0],
    )
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatRole(
  role: string,
) {
  switch (role) {
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

export function DashboardHeader({
  title = "Dashboard",

  subtitle =
    "Visão geral da atividade comercial",

  profile,

  stores,

  selectedStoreId,
}: DashboardHeaderProps) {
  const initials =
    getInitials(
      profile.full_name,
    );

const currentStoreId =
  selectedStoreId ??
  profile.store?.id ??
  "all";

  function handleStoreChange(
    storeId: string,
  ) {
    document.cookie =
      `selected_store_id=${storeId}; path=/; max-age=31536000; samesite=lax`;

    window.location.reload();
  }

  return (
    <header className="sticky top-0 z-30 w-full border-b border-[#e8eaed] bg-white/95 backdrop-blur">
      <div className="flex min-h-[72px] min-w-0 items-center justify-between gap-2 px-3 sm:px-5 lg:min-h-[94px] lg:px-7">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <MobileSidebar
            profile={
              profile
            }
          />

          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight text-[#17191d] sm:text-2xl">
              {title}
            </h1>

            <p className="mt-0.5 hidden truncate text-xs text-[#777f8a] sm:block sm:text-sm">
              {subtitle}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-3">
          {/* LOJA */}

          <div className="relative hidden md:block">
            <Building2 className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#525963]" />
        <select
          value={currentStoreId}
          onChange={(event) =>
            handleStoreChange(event.target.value)
          }
          className="h-11 min-w-[210px] appearance-none rounded-xl border border-[#e4e6e9] bg-white py-0 pl-11 pr-10 text-sm font-medium text-[#353b44] shadow-sm outline-none transition focus:border-[#ff4b0a]"
        >
          <option value="all">
            Todas as lojas
          </option>

          {stores.map((store) => (
            <option
              key={store.id}
              value={store.id}
            >
              {store.name}
            </option>
          ))}
        </select>

            <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7a818b]" />
          </div>

          {/* NOTIFICAÇÕES */}

          <button
            type="button"
            className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#525963] transition-colors hover:bg-[#f4f5f7]"
            aria-label="Notificações"
          >
            <Bell className="h-5 w-5" />

            <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff4b0a] px-1 text-[9px] font-bold text-white">
              5
            </span>
          </button>

          <div className="hidden h-8 w-px bg-[#e6e8eb] sm:block" />

          {/* PERFIL */}

          <button
            type="button"
            className="hidden items-center gap-2 rounded-xl p-1.5 transition-colors hover:bg-[#f4f5f7] sm:flex xl:pr-3"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#242a32] text-xs font-semibold text-white sm:h-10 sm:w-10 sm:text-sm">
              {initials}
            </div>

            <div className="hidden min-w-0 text-left xl:block">
              <p className="max-w-[160px] truncate text-sm font-semibold text-[#20242a]">
                {
                  profile.full_name
                }
              </p>

              <p className="text-xs text-[#747b85]">
                {formatRole(
                  profile.role,
                )}
              </p>
            </div>

            <ChevronDown className="hidden h-4 w-4 text-[#747b85] xl:block" />
          </button>
        </div>
      </div>
    </header>
  );
}