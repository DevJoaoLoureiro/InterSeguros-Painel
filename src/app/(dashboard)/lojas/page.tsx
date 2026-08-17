import type { ElementType } from "react";
import { redirect } from "next/navigation";

import {
  Building2,
  Store,
  UserRoundCheck,
} from "lucide-react";

import { CreateStoreForm } from "@/components/stores/create-store-form";
import { StoresTable } from "@/components/stores/stores-table";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function StoresPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  if (profile.role !== "OWNER") {
    redirect("/dashboard");
  }

  const admin = createAdminClient();

  const { data: stores, error } = await admin
    .from("stores")
    .select(`
      id,
      name,
      code,
      address,
      postal_code,
      city,
      phone,
      email,
      active,
      profiles (
        id
      )
    `)
    .order("name");

  if (error) {
    throw new Error(
      `Erro ao carregar lojas: ${error.message}`,
    );
  }

  const mappedStores =
    stores?.map((store) => ({
      id: store.id,
      name: store.name,
      code: store.code,

      address:
        store.address ?? null,

      postalCode:
        store.postal_code ?? null,

      city:
        store.city ?? null,

      phone:
        store.phone ?? null,

      email:
        store.email ?? null,

      active:
        store.active,

      employeesCount:
        Array.isArray(store.profiles)
          ? store.profiles.length
          : 0,
    })) ?? [];

  const activeStores =
    mappedStores.filter(
      (store) => store.active,
    ).length;

  const totalEmployees =
    mappedStores.reduce(
      (total, store) =>
        total + store.employeesCount,
      0,
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[#17191d]">
          Lojas
        </h1>

        <p className="mt-1 text-sm text-[#6b7280]">
          Gere a rede de lojas e os respetivos
          funcionários.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <Metric
          title="Lojas"
          value={mappedStores.length}
          icon={Building2}
        />

        <Metric
          title="Lojas ativas"
          value={activeStores}
          icon={Store}
        />

        <Metric
          title="Funcionários"
          value={totalEmployees}
          icon={UserRoundCheck}
        />
      </section>

      <CreateStoreForm />

      <StoresTable
        stores={mappedStores}
      />
    </div>
  );
}

type MetricProps = {
  title: string;
  value: number;
  icon: ElementType;
};

function Metric({
  title,
  value,
  icon: Icon,
}: MetricProps) {
  return (
    <article className="rounded-2xl border border-[#e7e9ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-[#747b85]">
            {title}
          </p>

          <p className="mt-2 text-3xl font-semibold tracking-tight text-[#17191d]">
            {value}
          </p>
        </div>

        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50 text-[#ff4b0a]">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </article>
  );
}