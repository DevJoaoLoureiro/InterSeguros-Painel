"use client";

import { useState } from "react";
import {
  Building2,
  MoreHorizontal,
  Power,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import { toggleEmployeeStatus } from "@/app/(dashboard)/utilizadores/actions";

type UserItem = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  active: boolean;
  storeName: string | null;
  isCurrentUser: boolean;
};

type UsersTableProps = {
  users: UserItem[];
};

function roleLabel(role: string) {
  switch (role) {
    case "OWNER":
      return "Proprietário";

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

function roleClasses(role: string) {
  switch (role) {
    case "OWNER":
      return "bg-purple-50 text-purple-700 border-purple-100";

    case "ADMIN":
      return "bg-blue-50 text-blue-700 border-blue-100";

    case "GESTOR_LOJA":
      return "bg-amber-50 text-amber-700 border-amber-100";

    default:
      return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function UsersTable({
  users,
}: UsersTableProps) {
  const [loadingId, setLoadingId] =
    useState<string | null>(null);

  const [error, setError] = useState("");

  async function handleToggle(
    user: UserItem,
  ) {
    setLoadingId(user.id);
    setError("");

    try {
      await toggleEmployeeStatus(
        user.id,
        !user.active,
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Erro ao alterar utilizador.",
      );
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[#e7e9ec] bg-white shadow-[0_2px_12px_rgba(20,25,35,0.04)]">
      <div className="flex items-center justify-between border-b border-[#eceef1] px-5 py-5 sm:px-6">
        <div>
          <h2 className="font-semibold text-[#20242a]">
            Funcionários
          </h2>

          <p className="mt-1 text-sm text-[#7b828d]">
            {users.length} utilizadores registados
          </p>
        </div>

        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f7f8fa]">
          <UserRound className="h-5 w-5 text-[#646c77]" />
        </div>
      </div>

      {error && (
        <div className="m-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Desktop */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[900px]">
          <thead className="bg-[#fafbfc]">
            <tr>
              {[
                "Funcionário",
                "Perfil",
                "Loja",
                "Estado",
                "Ações",
              ].map((title) => (
                <th
                  key={title}
                  className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-wide text-[#8a9099]"
                >
                  {title}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {users.map((user) => (
              <tr
                key={user.id}
                className={[
                  "border-t border-[#edf0f2] transition",
                  user.active
                    ? "hover:bg-[#fafbfc]"
                    : "bg-[#fafafa] opacity-70",
                ].join(" ")}
              >
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#242a32] text-xs font-semibold text-white">
                      {initials(user.full_name)}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-[#20242a]">
                          {user.full_name}
                        </p>

                        {user.isCurrentUser && (
                          <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-[#ff4b0a]">
                            Tu
                          </span>
                        )}
                      </div>

                      <p className="mt-0.5 truncate text-xs text-[#7d848e]">
                        {user.email}
                      </p>
                    </div>
                  </div>
                </td>

                <td className="px-6 py-4">
                  <span
                    className={[
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
                      roleClasses(user.role),
                    ].join(" ")}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />

                    {roleLabel(user.role)}
                  </span>
                </td>

                <td className="px-6 py-4">
                  <div className="flex items-center gap-2 text-sm text-[#4d5560]">
                    <Building2 className="h-4 w-4 text-[#9298a1]" />

                    {user.role === "OWNER"
                      ? "Todas as lojas"
                      : user.storeName ??
                        "Sem loja"}
                  </div>
                </td>

                <td className="px-6 py-4">
                  {user.active ? (
                    <span className="inline-flex items-center gap-2 rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700">
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      Ativo
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                      <span className="h-2 w-2 rounded-full bg-red-400" />
                      Inativo
                    </span>
                  )}
                </td>

                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={
                        loadingId === user.id ||
                        (user.isCurrentUser &&
                          user.active)
                      }
                      onClick={() =>
                        handleToggle(user)
                      }
                      className={[
                        "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40",
                        user.active
                          ? "border-red-200 text-red-600 hover:bg-red-50"
                          : "border-green-200 text-green-700 hover:bg-green-50",
                      ].join(" ")}
                    >
                      <Power className="h-3.5 w-3.5" />

                      {loadingId === user.id
                        ? "A guardar..."
                        : user.active
                          ? "Desativar"
                          : "Ativar"}
                    </button>

                    <button
                      type="button"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#e1e4e8] text-[#737b86] hover:bg-[#f5f6f7]"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <div className="divide-y divide-[#edf0f2] md:hidden">
        {users.map((user) => (
          <article
            key={user.id}
            className={[
              "p-4",
              user.active
                ? ""
                : "bg-[#fafafa] opacity-70",
            ].join(" ")}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#242a32] text-xs font-semibold text-white">
                {initials(user.full_name)}
              </div>

              <div className="min-w-0 flex-1">
                <p className="font-semibold text-[#20242a]">
                  {user.full_name}
                </p>

                <p className="mt-0.5 truncate text-xs text-[#7d848e]">
                  {user.email}
                </p>
              </div>

              {user.active ? (
                <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
              ) : (
                <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-[#9298a1]">
                  Perfil
                </p>

                <p className="mt-1 text-sm font-medium">
                  {roleLabel(user.role)}
                </p>
              </div>

              <div>
                <p className="text-xs text-[#9298a1]">
                  Loja
                </p>

                <p className="mt-1 text-sm font-medium">
                  {user.role === "OWNER"
                    ? "Todas"
                    : user.storeName ??
                      "Sem loja"}
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={
                loadingId === user.id ||
                (user.isCurrentUser &&
                  user.active)
              }
              onClick={() =>
                handleToggle(user)
              }
              className={[
                "mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl border text-sm font-semibold disabled:opacity-40",
                user.active
                  ? "border-red-200 text-red-600"
                  : "border-green-200 text-green-700",
              ].join(" ")}
            >
              <Power className="h-4 w-4" />

              {user.active
                ? "Desativar funcionário"
                : "Ativar funcionário"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}