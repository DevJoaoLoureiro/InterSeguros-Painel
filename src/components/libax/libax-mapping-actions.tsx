"use client";

import {
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

type UserOption = {
  id: string;
  full_name: string;
};

type LibaxMappingActionsProps = {
  libaxSellerId: number;
  libaxSellerName: string;
  currentUserId: string | null;
  users: UserOption[];
};

export function LibaxMappingActions({
  libaxSellerId,
  libaxSellerName,
  currentUserId,
  users,
}: LibaxMappingActionsProps) {
  const router =
    useRouter();

  const [
    selectedUserId,
    setSelectedUserId,
  ] = useState(
    currentUserId ?? "",
  );

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState<string | null>(
    null,
  );

  async function handleAssociate() {
    if (!selectedUserId) {
      setError(
        "Seleciona um utilizador.",
      );

      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response =
        await fetch(
          "/api/settings/libax/sellers",
          {
            method: "PUT",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              libaxSellerId,
              libaxSellerName,
              userId:
                selectedUserId,
            }),
          },
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ??
            "Erro ao associar.",
        );
      }

      router.refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Erro desconhecido.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-w-[250px] flex-col gap-2">
      <div className="flex items-center gap-2">
        <select
          value={selectedUserId}
          onChange={(event) =>
            setSelectedUserId(
              event.target.value,
            )
          }
          disabled={loading}
          className="h-10 min-w-[160px] rounded-lg border border-[#e1e4e8] bg-white px-3 text-sm outline-none focus:border-[#ff4b0a]"
        >
          <option value="">
            Selecionar utilizador
          </option>

          {users.map(
            (user) => (
              <option
                key={user.id}
                value={user.id}
              >
                {user.full_name}
              </option>
            ),
          )}
        </select>

        <button
          type="button"
          onClick={
            handleAssociate
          }
          disabled={
            loading ||
            !selectedUserId
          }
          className="h-10 rounded-lg bg-[#ff4b0a] px-4 text-sm font-medium text-white transition hover:bg-[#e94308] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading
            ? "A guardar..."
            : currentUserId
              ? "Alterar"
              : "Associar"}
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}