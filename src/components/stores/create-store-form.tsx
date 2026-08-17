"use client";

import { useState } from "react";
import { Building2, Plus } from "lucide-react";

import { createStore } from "@/app/(dashboard)/lojas/actions";

export function CreateStoreForm() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setLoading(true);
    setMessage("");
    setError("");

    try {
      await createStore({
        name,
        code,
        address,
        postalCode,
        city,
        phone,
        email,
      });

      setMessage("Loja criada com sucesso.");

      setName("");
      setCode("");
      setAddress("");
      setPostalCode("");
      setCity("");
      setPhone("");
      setEmail("");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Erro ao criar loja.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-[#e7e9ec] bg-white p-6 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50 text-[#ff4b0a]">
          <Building2 className="h-5 w-5" />
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#20242a]">
            Criar loja
          </h2>

          <p className="mt-1 text-sm text-[#6b7280]">
            Adiciona uma nova loja à rede Inter Seguros.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Field
          label="Nome"
          required
          value={name}
          onChange={setName}
          placeholder="Loja de Braga"
        />

        <Field
          label="Código"
          required
          value={code}
          onChange={setCode}
          placeholder="BRAGA"
        />

        <Field
          label="Morada"
          value={address}
          onChange={setAddress}
          placeholder="Rua..."
        />

        <Field
          label="Código postal"
          value={postalCode}
          onChange={setPostalCode}
          placeholder="4700-000"
        />

        <Field
          label="Cidade"
          value={city}
          onChange={setCity}
          placeholder="Braga"
        />

        <Field
          label="Telefone"
          value={phone}
          onChange={setPhone}
          placeholder="253 000 000"
        />

        <div className="md:col-span-2">
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="braga@interseguros.pt"
          />
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {message && (
        <p className="mt-4 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700">
          {message}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#ff4b0a] px-5 text-sm font-semibold text-white hover:bg-[#e94308] disabled:opacity-50"
      >
        <Plus className="h-4 w-4" />

        {loading ? "A criar..." : "Criar loja"}
      </button>
    </form>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
};

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
}: FieldProps) {
  return (
    <div>
      <label className="text-sm font-medium text-[#333842]">
        {label}
      </label>

      <input
        type={type}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 h-11 w-full rounded-xl border border-[#dde1e6] px-3 text-sm outline-none transition focus:border-[#ff4b0a] focus:ring-2 focus:ring-orange-100"
      />
    </div>
  );
}