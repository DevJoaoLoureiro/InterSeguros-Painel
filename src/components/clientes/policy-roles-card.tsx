"use client";

import { useState, useTransition } from "react";
import {
  BadgeCheck,
  Handshake,
  Loader2,
  Megaphone,
  Pencil,
  Plus,
  UserRound,
  Users,
} from "lucide-react";

import {
  quickCreatePartner,
  updatePolicyRoles,
  type PartnerOption,
  type PolicyRolesData,
  type PolicyRolesPatch,
  type RolePerson,
} from "@/app/(dashboard)/clientes/policy-roles-action";

export const PARTNER_TYPE_LABELS: Record<string, string> = {
  PARTNER: "Parceiro",
  COMPANY: "Empresa",
  PERSON: "Pessoa",
};

const avatarPalette = [
  "bg-[#ff4b0a]",
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-pink-500",
  "bg-cyan-600",
];

function avatarColor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return avatarPalette[Math.abs(hash) % avatarPalette.length];
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

const selectClass =
  "h-9 w-full rounded-lg border border-[#e4e6e9] bg-white px-2.5 text-sm outline-none transition focus:border-[#ff4b0a]";

const linkButton =
  "inline-flex items-center gap-1 text-xs font-semibold text-[#ff4b0a] transition hover:text-[#df3f06] disabled:cursor-not-allowed disabled:opacity-50";

// ============================================================
// PEÇAS
// ============================================================

function PersonChip({
  person,
  currentUserId,
  fallback = "Por associar",
}: {
  person: RolePerson | null;
  currentUserId: string;
  fallback?: string;
}) {
  if (!person) {
    return <span className="text-sm text-[#b0b5bb]">{fallback}</span>;
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ${avatarColor(person.full_name)}`}
      >
        {initials(person.full_name)}
      </span>
      <span className="truncate text-sm font-medium text-[#333842]">
        {person.full_name}
      </span>
      {person.id === currentUserId && (
        <span className="rounded bg-[#fff3ee] px-1.5 py-0.5 text-[10px] font-semibold text-[#ff4b0a]">
          Tu
        </span>
      )}
    </span>
  );
}

function RoleRow({
  icon: Icon,
  label,
  hint,
  children,
}: {
  icon: typeof UserRound;
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex w-36 shrink-0 items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#8a9099]" />
        <div>
          <p className="text-sm font-medium text-[#20242a]">{label}</p>
          <p className="text-[11px] leading-tight text-[#a0a5ac]">{hint}</p>
        </div>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function PersonSelect({
  profiles,
  value,
  onSave,
  onCancel,
  pending,
}: {
  profiles: RolePerson[];
  value: string | null;
  onSave: (id: string | null) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const [selected, setSelected] = useState(value ?? "");

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className={selectClass}
        autoFocus
      >
        <option value="">— Ninguém —</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.full_name}
          </option>
        ))}
      </select>
      <EditorButtons
        pending={pending}
        onSave={() => onSave(selected || null)}
        onCancel={onCancel}
      />
    </div>
  );
}

function EditorButtons({
  pending,
  onSave,
  onCancel,
  saveDisabled = false,
}: {
  pending: boolean;
  onSave: () => void;
  onCancel: () => void;
  saveDisabled?: boolean;
}) {
  return (
    <div className="flex shrink-0 gap-1.5">
      <button
        type="button"
        onClick={onSave}
        disabled={pending || saveDisabled}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#ff4b0a] px-3 text-xs font-semibold text-white transition hover:bg-[#e64409] disabled:opacity-50"
      >
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Guardar
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="h-9 rounded-lg px-3 text-xs font-medium text-[#606771] transition hover:bg-[#f4f5f7]"
      >
        Cancelar
      </button>
    </div>
  );
}

// ============================================================
// CARTÃO
// ============================================================

type Editing = "acquirer" | "issuer" | "commercial" | "origin" | null;

/*
 * Os dados vêm do painel da apólice (getPolicyPanel, um só pedido
 * para recibos + intervenientes). O cartão só faz pedidos ao guardar.
 */
export function PolicyRolesCard({
  policyId,
  data,
  loadError,
  onChange,
}: {
  policyId: string;
  data: PolicyRolesData | null;
  loadError: string | null;
  onChange: (data: PolicyRolesData) => void;
}) {
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [pending, startTransition] = useTransition();

  const error = saveError ?? loadError;
  const setError = setSaveError;

  function save(patch: PolicyRolesPatch) {
    setError(null);

    startTransition(async () => {
      try {
        const result = await updatePolicyRoles(policyId, patch);
        onChange(result);
        setEditing(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Não foi possível guardar.",
        );
      }
    });
  }

  return (
    <section className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-sm">
      <h3 className="flex items-center gap-2 font-semibold text-[#20242a]">
        <Users className="h-4 w-4 text-[#ff4b0a]" />
        Intervenientes
      </h3>
      <p className="mt-1 text-xs text-[#8a9099]">
        A mesma pessoa pode ter vários papéis.
      </p>

      {!data && !error && (
        <div className="mt-4 flex items-center gap-2 text-sm text-[#7d848e]">
          <Loader2 className="h-4 w-4 animate-spin" />A carregar...
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {data && (
        <RolesBody
          data={data}
          editing={editing}
          setEditing={(value) => {
            setError(null);
            setEditing(value);
          }}
          pending={pending}
          save={save}
          onPartnerCreated={(partner) =>
            onChange({
              ...data,
              partners: [...data.partners, partner].sort((a, b) =>
                a.name.localeCompare(b.name),
              ),
            })
          }
        />
      )}
    </section>
  );
}

function RolesBody({
  data,
  editing,
  setEditing,
  pending,
  save,
  onPartnerCreated,
}: {
  data: PolicyRolesData;
  editing: Editing;
  setEditing: (value: Editing) => void;
  pending: boolean;
  save: (patch: PolicyRolesPatch) => void;
  onPartnerCreated: (partner: PartnerOption) => void;
}) {
  const { roles, profiles, currentUserId, isAdmin, canEdit } = data;

  // Não-admins só mexem em papéis vazios ou que são deles.
  const canChange = (holder: RolePerson | null) =>
    canEdit && (isAdmin || !holder || holder.id === currentUserId);

  const originHolderIsOther =
    roles.origin?.type === "partner" ||
    (roles.origin?.type === "user" && roles.origin.user.id !== currentUserId);

  const canChangeOrigin = canEdit && (isAdmin || !originHolderIsOther);

  return (
    <div className="mt-2 divide-y divide-[#f1f2f4]">
      {/* ANGARIADOR */}

      <RoleRow icon={Megaphone} label="Angariador" hint="Quem trouxe o cliente">
        {editing === "acquirer" ? (
          <PersonSelect
            profiles={profiles}
            value={roles.acquirer?.id ?? null}
            pending={pending}
            onSave={(id) => save({ acquirerUserId: id })}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PersonChip person={roles.acquirer} currentUserId={currentUserId} />
            {canChange(roles.acquirer) && (
              <div className="flex gap-3">
                {!roles.acquirer && (
                  <button
                    type="button"
                    className={linkButton}
                    disabled={pending}
                    onClick={() => save({ acquirerUserId: currentUserId })}
                  >
                    Sou eu
                  </button>
                )}
                <button
                  type="button"
                  className={linkButton}
                  onClick={() => setEditing("acquirer")}
                >
                  <Pencil className="h-3 w-3" />
                  {roles.acquirer ? "Alterar" : "Escolher"}
                </button>
              </div>
            )}
          </div>
        )}
      </RoleRow>

      {/* GESTOR */}

      <RoleRow icon={BadgeCheck} label="Gestor" hint="Quem emitiu a apólice">
        {editing === "issuer" && isAdmin ? (
          <PersonSelect
            profiles={profiles}
            value={roles.issuer?.id ?? null}
            pending={pending}
            onSave={(id) => save({ issuedByUserId: id })}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PersonChip
              person={roles.issuer}
              currentUserId={currentUserId}
              fallback="Ainda ninguém indicou que emitiu"
            />

            {canEdit && (
              <div className="flex gap-3">
                {!roles.issuer && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => save({ issuedByUserId: currentUserId })}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#ffd5c2] bg-[#fff6f1] px-3 text-xs font-semibold text-[#ff4b0a] transition hover:border-[#ff4b0a] disabled:opacity-50"
                  >
                    <BadgeCheck className="h-3.5 w-3.5" />
                    Fui eu que emiti
                  </button>
                )}

                {roles.issuer?.id === currentUserId && !isAdmin && (
                  <button
                    type="button"
                    className={linkButton}
                    disabled={pending}
                    onClick={() => save({ issuedByUserId: null })}
                  >
                    Não fui eu
                  </button>
                )}

                {isAdmin && (
                  <button
                    type="button"
                    className={linkButton}
                    onClick={() => setEditing("issuer")}
                  >
                    <Pencil className="h-3 w-3" />
                    Corrigir
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </RoleRow>

      {/* COMERCIAL */}

      <RoleRow icon={UserRound} label="Comercial" hint="Acompanha o cliente">
        {editing === "commercial" ? (
          <PersonSelect
            profiles={profiles}
            value={roles.commercial?.id ?? null}
            pending={pending}
            onSave={(id) => save({ commercialUserId: id })}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PersonChip
              person={roles.commercial}
              currentUserId={currentUserId}
            />
            {canChange(roles.commercial) && (
              <div className="flex gap-3">
                {!roles.commercial && (
                  <button
                    type="button"
                    className={linkButton}
                    disabled={pending}
                    onClick={() => save({ commercialUserId: currentUserId })}
                  >
                    Associar-me
                  </button>
                )}
                <button
                  type="button"
                  className={linkButton}
                  onClick={() => setEditing("commercial")}
                >
                  <Pencil className="h-3 w-3" />
                  {roles.commercial ? "Alterar" : "Escolher"}
                </button>
              </div>
            )}
          </div>
        )}
      </RoleRow>

      {/* ORIGEM */}

      <RoleRow
        icon={Handshake}
        label="Origem"
        hint="Parceiro ou funcionário"
      >
        {editing === "origin" ? (
          <OriginEditor
            data={data}
            pending={pending}
            onSave={(origin) => save({ origin })}
            onCancel={() => setEditing(null)}
            onPartnerCreated={onPartnerCreated}
          />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {roles.origin?.type === "partner" ? (
              <span className="inline-flex min-w-0 items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#f4f5f7] text-[#59616d]">
                  <Handshake className="h-3.5 w-3.5" />
                </span>
                <span className="truncate text-sm font-medium text-[#333842]">
                  {roles.origin.partner.name}
                </span>
                <span className="rounded bg-[#f4f5f7] px-1.5 py-0.5 text-[10px] font-semibold text-[#59616d]">
                  {PARTNER_TYPE_LABELS[roles.origin.partner.partner_type ?? ""] ??
                    "Parceiro"}
                </span>
              </span>
            ) : (
              <PersonChip
                person={roles.origin?.type === "user" ? roles.origin.user : null}
                currentUserId={currentUserId}
                fallback="Sem origem indicada"
              />
            )}

            {canChangeOrigin && (
              <button
                type="button"
                className={linkButton}
                onClick={() => setEditing("origin")}
              >
                <Pencil className="h-3 w-3" />
                {roles.origin ? "Alterar" : "Indicar"}
              </button>
            )}
          </div>
        )}
      </RoleRow>
    </div>
  );
}

// ============================================================
// EDITOR DA ORIGEM
// ============================================================

function OriginEditor({
  data,
  pending,
  onSave,
  onCancel,
  onPartnerCreated,
}: {
  data: PolicyRolesData;
  pending: boolean;
  onSave: (origin: PolicyRolesPatch["origin"]) => void;
  onCancel: () => void;
  onPartnerCreated: (partner: PartnerOption) => void;
}) {
  const current = data.roles.origin;

  const [kind, setKind] = useState<"none" | "partner" | "user">(
    current?.type ?? "partner",
  );
  const [partnerId, setPartnerId] = useState(
    current?.type === "partner" ? current.partner.id : "",
  );
  const [userId, setUserId] = useState(
    current?.type === "user" ? current.user.id : "",
  );

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("PARTNER");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creatingPending, startCreate] = useTransition();

  function handleSave() {
    if (kind === "none") return onSave(null);
    if (kind === "partner" && partnerId) {
      return onSave({ type: "partner", id: partnerId });
    }
    if (kind === "user" && userId) return onSave({ type: "user", id: userId });
  }

  function handleCreatePartner() {
    setCreateError(null);

    startCreate(async () => {
      try {
        const partner = await quickCreatePartner({
          name: newName,
          partnerType: newType,
        });
        onPartnerCreated(partner);
        setPartnerId(partner.id);
        setCreating(false);
        setNewName("");
      } catch (err) {
        setCreateError(
          err instanceof Error ? err.message : "Erro ao criar parceiro.",
        );
      }
    });
  }

  const canSave =
    kind === "none" ||
    (kind === "partner" && Boolean(partnerId)) ||
    (kind === "user" && Boolean(userId));

  return (
    <div className="space-y-2.5">
      <div className="inline-flex w-full rounded-lg border border-[#e4e6e9] p-0.5">
        {(
          [
            { value: "partner", label: "Parceiro externo" },
            { value: "user", label: "Funcionário" },
            { value: "none", label: "Sem origem" },
          ] as const
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setKind(option.value)}
            className={[
              "h-8 flex-1 rounded-md text-xs font-medium transition",
              kind === option.value
                ? "bg-[#ff4b0a] text-white"
                : "text-[#59616d] hover:bg-[#f4f5f7]",
            ].join(" ")}
          >
            {option.label}
          </button>
        ))}
      </div>

      {kind === "partner" && !creating && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            className={selectClass}
          >
            <option value="">— Escolher parceiro —</option>
            {data.partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.partner_type && PARTNER_TYPE_LABELS[p.partner_type]
                  ? ` (${PARTNER_TYPE_LABELS[p.partner_type]})`
                  : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-dashed border-[#d5d8dc] px-3 text-xs font-medium text-[#59616d] transition hover:border-[#ff4b0a] hover:text-[#ff4b0a]"
          >
            <Plus className="h-3.5 w-3.5" />
            Novo parceiro
          </button>
        </div>
      )}

      {kind === "partner" && creating && (
        <div className="space-y-2 rounded-lg border border-[#edf0f2] bg-[#fafbfc] p-2.5">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nome (ex.: Parceiro Mais Negócio)"
              className={selectClass}
              autoFocus
            />
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              className={`${selectClass} sm:w-36`}
            >
              {Object.entries(PARTNER_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {createError && <p className="text-xs text-red-600">{createError}</p>}
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={handleCreatePartner}
              disabled={creatingPending || !newName.trim()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#20242a] px-3 text-xs font-semibold text-white transition hover:bg-black disabled:opacity-50"
            >
              {creatingPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Criar parceiro
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="h-8 rounded-lg px-3 text-xs font-medium text-[#606771] transition hover:bg-[#f4f5f7]"
            >
              Voltar
            </button>
          </div>
        </div>
      )}

      {kind === "user" && (
        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className={selectClass}
        >
          <option value="">— Escolher funcionário —</option>
          {data.profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      )}

      {!creating && (
        <div className="flex justify-end">
          <EditorButtons
            pending={pending}
            saveDisabled={!canSave}
            onSave={handleSave}
            onCancel={onCancel}
          />
        </div>
      )}
    </div>
  );
}
