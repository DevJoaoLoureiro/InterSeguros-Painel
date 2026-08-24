import {
  CheckCircle2,
  Link2,
  Settings2,
  UserRoundCog,
} from "lucide-react";

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

      <div>
        <p className="text-sm font-medium text-[#ff4b0a]">
          Integrações
        </p>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
          Responsáveis Libax
        </h1>

        <p className="mt-1 text-sm text-[#737a84]">
          Associa os sellers da Libax aos
          utilizadores do painel.
        </p>
      </div>

      {/* CARDS */}

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[#737a84]">
              Sellers encontrados
            </p>

            <Settings2 className="h-5 w-5 text-[#ff4b0a]" />
          </div>

          <p className="mt-3 text-3xl font-semibold text-[#17191d]">
            {mappings.length}
          </p>
        </div>

        <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[#737a84]">
              Associados
            </p>

            <CheckCircle2 className="h-5 w-5 text-green-600" />
          </div>

          <p className="mt-3 text-3xl font-semibold text-[#17191d]">
            {associated}
          </p>
        </div>

        <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[#737a84]">
              Por associar
            </p>

            <UserRoundCog className="h-5 w-5 text-amber-600" />
          </div>

          <p className="mt-3 text-3xl font-semibold text-[#17191d]">
            {unassociated}
          </p>
        </div>
      </section>

      {/* TABELA */}

      <section className="overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white">
        <div className="border-b border-[#edf0f2] px-5 py-4">
          <h2 className="font-semibold text-[#20242a]">
            Mapeamentos
          </h2>

          <p className="mt-1 text-sm text-[#7d848e]">
            Cada seller Libax deve estar
            associado ao utilizador correto
            do CRM.
          </p>
        </div>

        {mappings.length === 0 ? (
          <div className="px-5 py-14 text-center text-sm text-[#7d848e]">
            Ainda não existem sellers
            registados.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left">
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
                </tr>
              </thead>

              <tbody className="divide-y divide-[#edf0f2]">
                {mappings.map(
                  (mapping) => {
                    const user =
                      mapping.user_id
                        ? usersMap.get(
                            mapping.user_id,
                          )
                        : undefined;

                    const isAssociated =
                      Boolean(
                        mapping.user_id &&
                          mapping.active,
                      );

                    return (
                      <tr
                        key={mapping.id}
                        className="text-sm"
                      >
                        <td className="px-5 py-4">
                          <div>
                            <p className="font-medium text-[#20242a]">
                              {mapping.libax_seller_name ??
                                "Sem nome"}
                            </p>

                            <p className="mt-1 text-xs text-[#8a9099]">
                              Seller Libax
                            </p>
                          </div>
                        </td>

                        <td className="px-5 py-4 text-[#606771]">
                          #{mapping.libax_seller_id}
                        </td>

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

                        <td className="px-5 py-4 text-[#606771]">
                          {user?.store_id ?? "—"}
                        </td>

                        <td className="px-5 py-4">
                          {isAssociated ? (
                            <span className="inline-flex rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                              Associado
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                              Por associar
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}