"use client";

import { useState } from "react";
import { createEmployee } from "@/app/(dashboard)/utilizadores/actions";

type Store = {
  id: string;
  name: string;
};

type CreateUserFormProps = {
  stores: Store[];
};

export function CreateUserForm({
  stores,
}: CreateUserFormProps) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<
    "OWNER" | "ADMIN" | "GESTOR_LOJA" | "COMERCIAL"
  >("COMERCIAL");
  const [storeId, setStoreId] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setLoading(true);
    setMessage("");

    try {
      await createEmployee({
        fullName,
        email,
        password,
        role,
        storeId: role === "OWNER" ? null : storeId || null,
      });

      setMessage("Funcionário criado com sucesso.");

      setFullName("");
      setEmail("");
      setPassword("");
      setRole("COMERCIAL");
      setStoreId("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Erro ao criar funcionário.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5 rounded-2xl border border-[#e7e9ec] bg-white p-6 shadow-sm"
    >
      <div>
        <h2 className="text-lg font-semibold">
          Criar funcionário
        </h2>

        <p className="mt-1 text-sm text-[#6b7280]">
          Cria o acesso e associa o utilizador a uma loja.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="text-sm font-medium">
            Nome
          </label>

          <input
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="mt-2 h-11 w-full rounded-xl border border-[#dde1e6] px-3 outline-none focus:border-[#ff4b0a]"
            placeholder="Nome completo"
          />
        </div>

        <div>
          <label className="text-sm font-medium">
            Email
          </label>

          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-2 h-11 w-full rounded-xl border border-[#dde1e6] px-3 outline-none focus:border-[#ff4b0a]"
            placeholder="utilizador@interseguros.pt"
          />
        </div>

        <div>
          <label className="text-sm font-medium">
            Palavra-passe temporária
          </label>

          <input
            required
            minLength={8}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-2 h-11 w-full rounded-xl border border-[#dde1e6] px-3 outline-none focus:border-[#ff4b0a]"
          />
        </div>

        <div>
          <label className="text-sm font-medium">
            Tipo de utilizador
          </label>

          <select
            value={role}
            onChange={(e) =>
              setRole(
                e.target.value as
                  | "OWNER"
                  | "ADMIN"
                  | "GESTOR_LOJA"
                  | "COMERCIAL",
              )
            }
            className="mt-2 h-11 w-full rounded-xl border border-[#dde1e6] bg-white px-3"
          >
            <option value="COMERCIAL">
              Comercial
            </option>

            <option value="GESTOR_LOJA">
              Gestor de Loja
            </option>

            <option value="ADMIN">
              Administrador
            </option>

            <option value="OWNER">
              Proprietário
            </option>
          </select>
        </div>

        {role !== "OWNER" && (
          <div className="md:col-span-2">
            <label className="text-sm font-medium">
              Loja
            </label>

            <select
              required
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-[#dde1e6] bg-white px-3"
            >
              <option value="">
                Selecionar loja
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
          </div>
        )}
      </div>

      {message && (
        <p className="rounded-xl bg-[#f7f8fc] px-4 py-3 text-sm">
          {message}
        </p>
      )}

      <button
        disabled={loading}
        type="submit"
        className="h-11 rounded-xl bg-[#ff4b0a] px-5 text-sm font-semibold text-white hover:bg-[#e94308] disabled:opacity-50"
      >
        {loading
          ? "A criar..."
          : "Criar funcionário"}
      </button>
    </form>
  );
}