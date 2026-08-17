"use client";

import { useEffect, useState } from "react";
import {
  Building2,
  Loader2,
  Save,
  X,
} from "lucide-react";

import { updateStore } from "@/app/(dashboard)/lojas/actions";

export type EditableStore = {
  id: string;
  name: string;
  code: string;

  address: string | null;
  postalCode: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;

  active: boolean;
  employeesCount: number;
};

type EditStoreModalProps = {
  store: EditableStore | null;
  open: boolean;
  onClose: () => void;
};

export function EditStoreModal({
  store,
  open,
  onClose,
}: EditStoreModalProps) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const [address, setAddress] =
    useState("");

  const [postalCode, setPostalCode] =
    useState("");

  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  useEffect(() => {
    if (!store) {
      return;
    }

    setName(store.name);
    setCode(store.code);
    setAddress(store.address ?? "");
    setPostalCode(store.postalCode ?? "");
    setCity(store.city ?? "");
    setPhone(store.phone ?? "");
    setEmail(store.email ?? "");
    setError("");
  }, [store]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow =
      "hidden";

    return () => {
      document.body.style.overflow =
        previousOverflow;
    };
  }, [open]);

  if (!open || !store) {
    return null;
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!store) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      await updateStore(store.id, {
        name,
        code,
        address,
        postalCode,
        city,
        phone,
        email,
      });

      onClose();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Erro ao atualizar loja.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Overlay */}
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
      />

      {/* Drawer */}
      <div className="absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col bg-white shadow-2xl">
        <div className="flex h-[78px] shrink-0 items-center justify-between border-b border-[#e8eaed] px-5 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-[#ff4b0a]">
              <Building2 className="h-5 w-5" />
            </div>

            <div>
              <h2 className="font-semibold text-[#20242a]">
                Editar loja
              </h2>

              <p className="text-xs text-[#858c96]">
                {store.name}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#737b86] transition hover:bg-[#f3f4f6]"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex-1 overflow-y-auto p-5 sm:p-7">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Nome da loja"
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

              <div className="sm:col-span-2">
                <Field
                  label="Morada"
                  value={address}
                  onChange={setAddress}
                  placeholder="Rua, número..."
                />
              </div>

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

              <Field
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="braga@interseguros.pt"
              />
            </div>

            <div className="mt-7 rounded-2xl border border-[#eceef1] bg-[#fafbfc] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#8b929c]">
                Informação
              </p>

              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-[#9298a1]">
                    Funcionários
                  </p>

                  <p className="mt-1 font-semibold text-[#252a31]">
                    {store.employeesCount}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-[#9298a1]">
                    Estado
                  </p>

                  <p
                    className={[
                      "mt-1 font-semibold",
                      store.active
                        ? "text-green-700"
                        : "text-red-600",
                    ].join(" ")}
                  >
                    {store.active
                      ? "Ativa"
                      : "Inativa"}
                  </p>
                </div>
              </div>
            </div>

            {error && (
              <div className="mt-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-[#e8eaed] bg-white px-5 py-4 sm:px-7">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="h-11 rounded-xl border border-[#dde1e6] px-5 text-sm font-semibold text-[#4b525c] transition hover:bg-[#f6f7f8]"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#ff4b0a] px-5 text-sm font-semibold text-white transition hover:bg-[#e94308] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  A guardar...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Guardar alterações
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
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

        {required && (
          <span className="ml-1 text-[#ff4b0a]">
            *
          </span>
        )}
      </label>

      <input
        type={type}
        required={required}
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
        placeholder={placeholder}
        className="mt-2 h-11 w-full rounded-xl border border-[#dde1e6] bg-white px-3 text-sm text-[#24272d] outline-none transition placeholder:text-[#a2a7af] focus:border-[#ff4b0a] focus:ring-2 focus:ring-orange-100"
      />
    </div>
  );
}