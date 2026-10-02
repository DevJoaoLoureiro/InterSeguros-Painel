"use client";

import { useState, useTransition } from "react";
import { Handshake, Loader2, Pencil, Plus, Search, X } from "lucide-react";

import { PARTNER_TYPE_LABELS } from "@/components/clientes/policy-roles-card";

import {
  createPartner,
  setPartnerActive,
  updatePartner,
  type PartnerInput,
  type PartnerRow,
} from "./actions";

const inputClass =
  "mt-1.5 h-10 w-full rounded-lg border border-[#e4e6e9] bg-white px-3 text-sm outline-none transition focus:border-[#ff4b0a]";

export function PartnersBoard({
  partners,
  isAdmin,
}: {
  partners: PartnerRow[];
  isAdmin: boolean;
}) {
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<PartnerRow | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const query = search.trim().toLowerCase();

  const visible = partners.filter(
    (p) =>
      (showInactive || p.active) &&
      (!query ||
        p.name.toLowerCase().includes(query) ||
        (p.nif ?? "").includes(query)),
  );

  const inactiveCount = partners.filter((p) => !p.active).length;

  function toggleActive(partner: PartnerRow) {
    setError(null);

    startTransition(async () => {
      try {
        await setPartnerActive(partner.id, !partner.active);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao atualizar.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#a0a5ac]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar nome ou NIF..."
              className="h-10 w-full rounded-xl border border-[#e4e6e9] bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[#ff4b0a]"
            />
          </div>

          {inactiveCount > 0 && (
            <label className="inline-flex items-center gap-2 text-sm text-[#59616d]">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="h-4 w-4 accent-[#ff4b0a]"
              />
              Mostrar desativados ({inactiveCount})
            </label>
          )}
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#ff4b0a] px-4 text-sm font-medium text-white shadow-sm transition hover:bg-[#e64409]"
          >
            <Plus className="h-4 w-4" />
            Novo parceiro
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-16 text-center">
            <Handshake className="h-8 w-8 text-[#d5d8dc]" />
            <p className="text-sm text-[#8a9099]">
              {partners.length === 0
                ? "Ainda não há parceiros. Cria o primeiro (ex.: Parceiro Mais Negócio)."
                : "Nenhum parceiro corresponde à pesquisa."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[#eef0f2]">
            {visible.map((partner) => (
              <li
                key={partner.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-[#ff4b0a]">
                    <Handshake className="h-5 w-5" />
                  </span>

                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#20242a]">
                      {partner.name}
                      <span className="rounded bg-[#f4f5f7] px-1.5 py-0.5 text-[10px] font-semibold text-[#59616d]">
                        {PARTNER_TYPE_LABELS[partner.partner_type ?? ""] ??
                          "Parceiro"}
                      </span>
                      {!partner.active && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                          Desativado
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-[#8a9099]">
                      {[
                        partner.nif ? `NIF ${partner.nif}` : null,
                        partner.email,
                        partner.phone,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Sem contactos"}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-4">
                  <span className="text-xs text-[#8a9099]">
                    {partner.policies_count} apólice
                    {partner.policies_count === 1 ? "" : "s"}
                  </span>

                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditing(partner)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[#ff4b0a] hover:text-[#df3f06]"
                      >
                        <Pencil className="h-3 w-3" />
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleActive(partner)}
                        className="text-xs font-medium text-[#7d848e] hover:text-[#20242a]"
                      >
                        {partner.active ? "Desativar" : "Reativar"}
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <PartnerModal
          partner={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function PartnerModal({
  partner,
  onClose,
}: {
  partner: PartnerRow | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(partner?.name ?? "");
  const [partnerType, setPartnerType] = useState(
    partner?.partner_type ?? "PARTNER",
  );
  const [nif, setNif] = useState(partner?.nif ?? "");
  const [email, setEmail] = useState(partner?.email ?? "");
  const [phone, setPhone] = useState(partner?.phone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    if (!name.trim()) {
      setError("O nome é obrigatório.");
      return;
    }

    const input: PartnerInput = {
      name,
      partnerType,
      nif: nif || null,
      email: email || null,
      phone: phone || null,
    };

    setError(null);

    startTransition(async () => {
      try {
        if (partner) {
          await updatePartner(partner.id, input);
        } else {
          await createPartner(input);
        }
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao guardar.");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#edf0f2] px-5 py-4">
          <h2 className="font-semibold text-[#20242a]">
            {partner ? "Editar parceiro" : "Novo parceiro"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#a0a5ac] transition hover:bg-[#f4f5f7] hover:text-[#606771]"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3.5 px-5 py-4">
          <div>
            <label className="text-xs font-medium text-[#7d848e]">Nome</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Parceiro Mais Negócio"
              autoFocus
              className={inputClass}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-[#7d848e]">Tipo</label>
            <div className="mt-1.5 inline-flex w-full rounded-lg border border-[#e4e6e9] p-0.5">
              {Object.entries(PARTNER_TYPE_LABELS).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPartnerType(value)}
                  className={[
                    "h-8 flex-1 rounded-md text-xs font-medium transition",
                    partnerType === value
                      ? "bg-[#ff4b0a] text-white"
                      : "text-[#59616d] hover:bg-[#f4f5f7]",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-[#7d848e]">
                NIF (opcional)
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={nif}
                onChange={(e) => setNif(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[#7d848e]">
                Telefone (opcional)
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-[#7d848e]">
              Email (opcional)
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-[#edf0f2] px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-lg px-4 text-sm font-medium text-[#606771] transition hover:bg-[#f4f5f7]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#ff4b0a] px-4 text-sm font-medium text-white shadow-sm transition hover:bg-[#e64409] disabled:opacity-50"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
