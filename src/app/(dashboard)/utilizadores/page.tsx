import {
  Building2,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";
import { redirect } from "next/navigation";

import { CreateUserForm } from "@/components/users/create-user-form";
import { UsersTable } from "@/components/users/users-table";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function UsersPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  if (profile.role !== "OWNER") {
    redirect("/dashboard");
  }

  const admin = createAdminClient();

  const { data: stores } = await admin
    .from("stores")
    .select("id, name")
    .eq("active", true)
    .order("name");

  const { data: profiles } = await admin
    .from("profiles")
    .select(`
      id,
      full_name,
      role,
      active,
      store:stores (
        id,
        name
      )
    `)
    .order("full_name");

  const {
    data: { users: authUsers },
  } = await admin.auth.admin.listUsers();

  const emails = new Map(
    authUsers.map((user) => [
      user.id,
      user.email ?? "",
    ]),
  );

  const users =
    profiles?.map((user) => {
      const store = Array.isArray(user.store)
        ? user.store[0] ?? null
        : user.store;

      return {
        id: user.id,
        full_name: user.full_name,
        email: emails.get(user.id) ?? "",
        role: user.role,
        active: user.active,
        storeName: store?.name ?? null,
        isCurrentUser: user.id === profile.id,
      };
    }) ?? [];

  const activeUsers = users.filter(
    (user) => user.active,
  ).length;

  const managers = users.filter((user) =>
    ["OWNER", "ADMIN", "GESTOR_LOJA"].includes(
      user.role,
    ),
  ).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#17191d]">
            Utilizadores
          </h1>

          <p className="mt-1 text-sm text-[#6b7280]">
            Gere funcionários, acessos, funções e
            respetivas lojas.
          </p>
        </div>
      </div>

      {/* Estatísticas */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Funcionários"
          value={users.length}
          icon={Users}
        />

        <MetricCard
          title="Ativos"
          value={activeUsers}
          icon={UserCheck}
        />

        <MetricCard
          title="Gestão"
          value={managers}
          icon={ShieldCheck}
        />

        <MetricCard
          title="Lojas"
          value={stores?.length ?? 0}
          icon={Building2}
        />
      </section>

      {/* Criar */}
      <CreateUserForm
        stores={stores ?? []}
      />

      {/* Lista */}
      <UsersTable users={users} />
    </div>
  );
}

type MetricCardProps = {
  title: string;
  value: number;
  icon: React.ElementType;
};

function MetricCard({
  title,
  value,
  icon: Icon,
}: MetricCardProps) {
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