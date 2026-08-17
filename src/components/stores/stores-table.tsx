"use client";

import { useState } from "react";
import {
  Building2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Power,
  Users,
} from "lucide-react";

import { toggleStoreStatus } from "@/app/(dashboard)/lojas/actions";

import {
  EditStoreModal,
  type EditableStore,
} from "@/components/stores/edit-store-modal";

type StoreItem = EditableStore;

type StoresTableProps = {
  stores: StoreItem[];
};

export function StoresTable({
  stores,
}: StoresTableProps) {
  const [loadingId, setLoadingId] =
    useState<string | null>(null);

  const [editingStore, setEditingStore] =
    useState<StoreItem | null>(null);

  const [error, setError] =
    useState("");

  async function handleToggle(
    store: StoreItem,
  ) {
    setLoadingId(store.id);
    setError("");

    try {
      await toggleStoreStatus(
        store.id,
        !store.active,
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Erro ao alterar loja.",
      );
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-[#e7e9ec] bg-white shadow-[0_2px_12px_rgba(20,25,35,0.04)]">
        <div className="flex items-center justify-between border-b border-[#eceef1] px-5 py-5 sm:px-6">
          <div>
            <h2 className="font-semibold text-[#20242a]">
              Rede de lojas
            </h2>

            <p className="mt-1 text-sm text-[#7b828d]">
              {stores.length}{" "}
              {stores.length === 1
                ? "loja registada"
                : "lojas registadas"}
            </p>
          </div>

          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f7f8fa] text-[#646c77]">
            <Building2 className="h-5 w-5" />
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {stores.length === 0 ? (
          <div className="flex min-h-[250px] flex-col items-center justify-center px-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f7f8fa] text-[#969ca5]">
              <Building2 className="h-6 w-6" />
            </div>

            <p className="mt-4 font-semibold text-[#31363d]">
              Ainda não existem lojas
            </p>

            <p className="mt-1 max-w-sm text-sm text-[#858c96]">
              Cria a primeira loja para começares a
              associar funcionários, clientes e leads.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 p-4 sm:p-5 md:grid-cols-2 2xl:grid-cols-3">
            {stores.map((store) => (
              <article
                key={store.id}
                className={[
                  "group flex flex-col rounded-2xl border p-5 transition-all",
                  store.active
                    ? "border-[#e6e8eb] bg-white hover:-translate-y-0.5 hover:border-[#dfe2e6] hover:shadow-[0_8px_25px_rgba(20,25,35,0.07)]"
                    : "border-[#ececec] bg-[#fafafa] opacity-75",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-[#ff4b0a]">
                    <Building2 className="h-5 w-5" />
                  </div>

                  <span
                    className={[
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                      store.active
                        ? "bg-green-50 text-green-700"
                        : "bg-red-50 text-red-700",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "h-1.5 w-1.5 rounded-full",
                        store.active
                          ? "bg-green-500"
                          : "bg-red-400",
                      ].join(" ")}
                    />

                    {store.active
                      ? "Ativa"
                      : "Inativa"}
                  </span>
                </div>

                <div className="mt-4">
                  <h3 className="text-base font-semibold text-[#20242a]">
                    {store.name}
                  </h3>

                  <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9a9fa7]">
                    {store.code}
                  </p>
                </div>

                <div className="mt-5 flex-1 space-y-3">
                  <Info
                    icon={MapPin}
                    value={
                      store.city ||
                      store.address ||
                      "Localização não definida"
                    }
                  />

                  <Info
                    icon={Users}
                    value={`${store.employeesCount} ${
                      store.employeesCount === 1
                        ? "funcionário"
                        : "funcionários"
                    }`}
                  />

                  {store.phone && (
                    <Info
                      icon={Phone}
                      value={store.phone}
                    />
                  )}

                  {store.email && (
                    <Info
                      icon={Mail}
                      value={store.email}
                    />
                  )}
                </div>

                <div className="mt-5 grid grid-cols-2 gap-2 border-t border-[#edf0f2] pt-4">
                  <button
                    type="button"
                    onClick={() =>
                      setEditingStore(store)
                    }
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe2e6] bg-white text-sm font-semibold text-[#4d5560] transition hover:border-[#ffcab6] hover:bg-orange-50 hover:text-[#e7430a]"
                  >
                    <Pencil className="h-4 w-4" />
                    Editar
                  </button>

                  <button
                    type="button"
                    disabled={
                      loadingId === store.id
                    }
                    onClick={() =>
                      handleToggle(store)
                    }
                    className={[
                      "inline-flex h-10 items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
                      store.active
                        ? "border-red-200 text-red-600 hover:bg-red-50"
                        : "border-green-200 text-green-700 hover:bg-green-50",
                    ].join(" ")}
                  >
                    <Power className="h-4 w-4" />

                    {loadingId === store.id
                      ? "A guardar..."
                      : store.active
                        ? "Desativar"
                        : "Ativar"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <EditStoreModal
        store={editingStore}
        open={editingStore !== null}
        onClose={() =>
          setEditingStore(null)
        }
      />
    </>
  );
}

type InfoProps = {
  icon: React.ElementType;
  value: string;
};

function Info({
  icon: Icon,
  value,
}: InfoProps) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 text-sm text-[#656d78]">
      <Icon className="h-4 w-4 shrink-0 text-[#9ba1aa]" />

      <span className="truncate">
        {value}
      </span>
    </div>
  );
}