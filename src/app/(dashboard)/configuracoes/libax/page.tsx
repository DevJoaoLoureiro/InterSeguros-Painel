import {
  CheckCircle2,
  Link2,
  Settings2,
  UserRoundCog,
} from "lucide-react";

import {
  LibaxMappingActions,
} from "@/components/libax/libax-mapping-actions";

import { createAdminClient } from "@/lib/supabase/admin";

type MappingRow = {
  id: string;
  libax_seller_id: number;
  libax_seller_name: string | null;
  user_id: string | null;
  active: boolean;
};

type ProfileRow = {
  id: string;
  full_name: string;
  store_id: string | null;
};

export default async function LibaxSettingsPage() {
  const supabase = createAdminClient();

  const {
    data: mappingsData,
    error: mappingsError,
  } = await supabase
    .from("libax_seller_mappings")
    .select(`
      id,
      libax_seller_id,
      libax_seller_name,
      user_id,
      active
    `)
    .order("libax_seller_name", {
      ascending: true,
    });

  if (mappingsError) {
    throw new Error(
      `Erro ao carregar mappings: ${mappingsError.message}`,
    );
  }

  const {
    data: usersData,
    error: usersError,
  } = await supabase
    .from("profiles")
    .select(`
      id,
      full_name,
      store_id
    `)
    .order("full_name", {
      ascending: true,
    });

  if (usersError) {
    throw new Error(
      `Erro ao carregar utilizadores: ${usersError.message}`,
    );
  }

  const mappings =
    (mappingsData ?? []) as MappingRow[];

  const users =
    (usersData ?? []) as ProfileRow[];

  const usersMap = new Map(
    users.map((user) => [
      user.id,
      user,
    ]),
  );

  const associated =
    mappings.filter(
      (mapping) =>
        mapping.user_id &&
        mapping.active,
    ).length;

  const unassociated =
    mappings.filter(
      (mapping) =>
        !mapping.user_id ||
        !mapping.active,
    ).length;

return (
  <div className="space-y-6">
    {/* HEADER */}

    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm font-medium text-[#ff4b0a]">
          Integrações
        </p>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
          Responsáveis Libax
        </h1>

        <p className="mt-1 max-w-2xl text-sm text-[#737a84]">
          Gere a associação entre os sellers da Libax e os utilizadores do painel.
        </p>
      </div>

      <div className="rounded-xl border border-[#e5e8ec] bg-white px-4 py-2 text-xs text-[#737a84]">
        Associação usada para atribuir apólices e lojas automaticamente
      </div>
    </div>

    {/* CARDS */}

    <section className="grid gap-4 sm:grid-cols-3">
      <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[#737a84]">
              Sellers encontrados
            </p>

            <p className="mt-3 text-3xl font-semibold text-[#17191d]">
              {mappings.length}
            </p>
          </div>

          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50">
            <Settings2 className="h-5 w-5 text-[#ff4b0a]" />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[#737a84]">
              Associados
            </p>

            <p className="mt-3 text-3xl font-semibold text-[#17191d]">
              {associated}
            </p>
          </div>

          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-green-50">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[#737a84]">
              Por associar
            </p>

            <p className="mt-3 text-3xl font-semibold text-[#17191d]">
              {unassociated}
            </p>
          </div>

          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50">
            <UserRoundCog className="h-5 w-5 text-amber-600" />
          </div>
        </div>
      </div>
    </section>

    {/* TABELA */}

    <section className="overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
      <div className="flex flex-col gap-2 border-b border-[#edf0f2] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-[#20242a]">
            Mapeamentos
          </h2>

          <p className="mt-1 text-sm text-[#7d848e]">
            Cada seller Libax deve estar associado ao utilizador correto do CRM.
          </p>
        </div>

        <div className="text-xs text-[#8a9099]">
          {associated} associados · {unassociated} pendentes
        </div>
      </div>

      {mappings.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f5f6f7]">
            <UserRoundCog className="h-6 w-6 text-[#7d848e]" />
          </div>

          <h3 className="mt-4 font-semibold text-[#20242a]">
            Ainda não existem sellers registados
          </h3>

          <p className="mt-1 text-sm text-[#7d848e]">
            Os sellers encontrados através da Libax irão aparecer aqui.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left">
            <thead className="bg-[#fafbfc]">
              <tr className="text-xs font-medium uppercase tracking-wide text-[#8a9099]">
                <th className="px-5 py-3">
                  Responsável Libax
                </th>

                <th className="px-5 py-3">
                  Seller ID
                </th>

                <th className="px-5 py-3">
                  Utilizador CRM
                </th>

                <th className="px-5 py-3">
                  Loja
                </th>

                <th className="px-5 py-3">
                  Estado
                </th>

                <th className="px-5 py-3 text-right">
                  Ação
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[#edf0f2]">
              {mappings.map((mapping) => {
                const user =
                  mapping.user_id
                    ? usersMap.get(mapping.user_id)
                    : undefined;

                const isAssociated =
                  Boolean(
                    mapping.user_id &&
                      mapping.active,
                  );

                const storeName =
                  user?.store_id
                    ? users.find(
                        (profile) =>
                          profile.store_id ===
                          user.store_id,
                      )?.store_id
                    : null;

                return (
                  <tr
                    key={mapping.id}
                    className="text-sm transition hover:bg-[#fafbfc]"
                  >
                    {/* SELLER */}

                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-sm font-semibold text-[#ff4b0a]">
                          {mapping.libax_seller_name
                            ?.slice(0, 1)
                            .toUpperCase() ?? "?"}
                        </div>

                        <div>
                          <p className="font-medium text-[#20242a]">
                            {mapping.libax_seller_name ??
                              "Sem nome"}
                          </p>

                          <p className="mt-1 text-xs text-[#8a9099]">
                            Seller Libax
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* ID */}

                    <td className="px-5 py-4">
                      <span className="inline-flex rounded-lg bg-[#f4f5f7] px-2.5 py-1 text-xs font-medium text-[#59616d]">
                        #{mapping.libax_seller_id}
                      </span>
                    </td>

                    {/* USER CRM */}

                    <td className="px-5 py-4">
                      {user ? (
                        <div className="flex items-center gap-2">
                          <Link2 className="h-4 w-4 text-[#ff4b0a]" />

                          <span className="font-medium text-[#20242a]">
                            {user.full_name}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[#a0a5ac]">
                          Por associar
                        </span>
                      )}
                    </td>

                    {/* STORE */}

                    <td className="px-5 py-4">
                      {user?.store_id ? (
                        <div>
                          <p className="font-medium text-[#20242a]">
                            Loja associada
                          </p>

                          <p className="mt-1 text-xs text-[#8a9099]">
                            {user.store_id}
                          </p>
                        </div>
                      ) : (
                        <span className="text-[#a0a5ac]">
                          —
                        </span>
                      )}
                    </td>

                    {/* STATUS */}

                    <td className="px-5 py-4">
                      {isAssociated ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                          Associado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                          Por associar
                        </span>
                      )}
                    </td>

                    {/* ACTION */}

                    <td className="px-5 py-4">
                      <div className="flex justify-end">
                        <LibaxMappingActions
                          libaxSellerId={
                            mapping.libax_seller_id
                          }
                          libaxSellerName={
                            mapping.libax_seller_name ??
                            "Sem nome"
                          }
                          currentUserId={
                            mapping.user_id
                          }
                          users={users.map(
                            (user) => ({
                              id: user.id,
                              full_name:
                                user.full_name,
                            }),
                          )}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  </div>
);}