"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Eye,
  EyeOff,
  IdCard,
  Landmark,
  Loader2,
  MapPin,
  Phone,
  RefreshCw,
} from "lucide-react";

import {
  getClientProfile,
  type ClientProfile,
} from "@/app/(dashboard)/clientes/client-profile-action";

// ============================================================
// RÓTULOS DOS CAMPOS DAS COMPANHIAS
// ============================================================

const FIELD_LABELS: Record<string, string> = {
  // Zurich
  IDCliente: "ID na companhia",
  NomeCliente: "Nome",
  Morada: "Morada",
  Localidade: "Localidade",
  CodigoPostal: "Código postal",
  OrdemPostal: "Ordem postal",
  LocalidadePostal: "Localidade postal",
  Pais: "País",
  NIF: "NIF",
  Telefone: "Telefone",
  Telemovel: "Telemóvel",
  Fax: "Fax",
  Email: "Email",
  NCartaoIdentificacao: "Nº cartão de identificação",
  DataNascimento: "Data de nascimento",
  Tipo: "Tipo de cliente",
  Sexo: "Sexo",
  CodigoAtividade: "Código de atividade",
  NomeAtividade: "Profissão / atividade",
  EstadoCivil: "Estado civil",
  Filhos: "Filhos",
  NIB: "NIB / IBAN",
  CodSituacao: "Código de situação",
  Situacao: "Situação",
  DataUltimaAlteracao: "Última alteração na companhia",
  Zurich4You: "Zurich4You",
  RecDocPorEmail: "Documentos por email",
  DataAtualizacaoTipoCliente: "Atualização do tipo de cliente",

  // Prévoir
  nome: "Nome",
  sexo: "Sexo",
  nif: "NIF",
  morada: "Morada",
  codigoPostal: "Código postal",
  localidade: "Localidade",
};

// Campos que não vale a pena repetir no detalhe por companhia.
const HIDDEN_FIELDS = new Set(["OrdemPostal", "CodSituacao"]);

const SENSITIVE_FIELDS = new Set(["NIB", "NCartaoIdentificacao"]);

// ============================================================
// HELPERS
// ============================================================

function formatDate(value: string | null | undefined) {
  if (!value) return null;

  // Zurich manda "DD-MM-AAAA HH:mm:ss".
  const pt = value.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (pt) return `${pt[1]}/${pt[2]}/${pt[3]}`;

  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value: string | null) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function ageFrom(birthDate: string | null) {
  if (!birthDate) return null;

  const birth = new Date(`${birthDate.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(birth.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    today.getMonth() < birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());

  if (beforeBirthday) age -= 1;

  return age;
}

function formatValue(key: string, value: unknown) {
  if (value === null || value === undefined) return null;

  const text = String(value).trim();
  if (!text) return null;

  if (key.toLowerCase().startsWith("data")) return formatDate(text);

  if (text === "S" || text.toLowerCase() === "true") return "Sim";
  if (text === "N" || text.toLowerCase() === "false") return "Não";

  return text;
}

function sexLabel(value: string | null) {
  if (!value) return null;
  const v = value.trim().toUpperCase();
  if (v === "M" || v === "MASCULINO") return "Masculino";
  if (v === "F" || v === "FEMININO") return "Feminino";
  return value;
}

function mask(value: string) {
  return value.length <= 4
    ? "••••"
    : `${"•".repeat(Math.min(value.length - 4, 12))}${value.slice(-4)}`;
}

const POSTAL_RE = /^\d{4}(-\d{3})?$/;

/*
 * Alguns clientes vêm da companhia com código postal e localidade
 * trocados (ex.: postal_code = "PORTUGAL", city = "4730-423 RIO MAU").
 * Para mostrar, extraímos o código postal de onde ele estiver.
 */
function resolveAddress(client: ClientProfile) {
  const postal = client.postal_code?.trim() ?? "";
  const city = client.city?.trim() ?? "";

  if (postal && POSTAL_RE.test(postal)) {
    return { postal, city, swapped: false };
  }

  const inCity = city.match(/^(\d{4}-\d{3})\s*(.*)$/);

  if (inCity) {
    return {
      postal: inCity[1],
      city: inCity[2] || city,
      swapped: Boolean(postal),
    };
  }

  return { postal, city, swapped: false };
}

/* Primeiro valor preenchido entre as várias companhias. */
function fromProviders(client: ClientProfile, ...keys: string[]) {
  for (const provider of client.providers) {
    for (const key of keys) {
      const value = provider.metadata[key];
      if (value !== null && value !== undefined && String(value).trim()) {
        return String(value).trim();
      }
    }
  }
  return null;
}

// ============================================================
// PEÇAS
// ============================================================

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Building2;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-sm">
      <h3 className="flex items-center gap-2 font-semibold text-[#20242a]">
        <Icon className="h-4 w-4 text-[#ff4b0a]" />
        {title}
      </h3>
      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
        {children}
      </dl>
    </section>
  );
}

function Item({
  label,
  value,
  wide = false,
  children,
}: {
  label: string;
  value?: React.ReactNode;
  wide?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs text-[#8a9099]">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-[#333842]">
        {children ?? (value || <span className="text-[#b0b5bb]">—</span>)}
      </dd>
    </div>
  );
}

function SensitiveValue({ value }: { value: string }) {
  const [visible, setVisible] = useState(false);

  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono">{visible ? value : mask(value)}</span>
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="rounded p-0.5 text-[#a0a5ac] transition hover:text-[#40464f]"
        aria-label={visible ? "Esconder" : "Mostrar"}
      >
        {visible ? (
          <EyeOff className="h-3.5 w-3.5" />
        ) : (
          <Eye className="h-3.5 w-3.5" />
        )}
      </button>
    </span>
  );
}

// ============================================================
// ABA
// ============================================================

export function ClientDataTab({
  clientId,
  preloaded,
  waiting = false,
}: {
  clientId: string;
  // Ficha que veio no pedido do painel (getClientPanel).
  preloaded?: ClientProfile | null;
  // O painel ainda está a carregar: esperar por ele em vez de fazer
  // outro pedido (as server actions correm uma de cada vez).
  waiting?: boolean;
}) {
  const [fetched, setFetched] = useState<ClientProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const client = preloaded ?? fetched;
  const shouldFetch = !preloaded && !waiting;

  useEffect(() => {
    if (!shouldFetch) return;

    let cancelled = false;

    getClientProfile(clientId)
      .then((result) => {
        if (!cancelled) setFetched(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Erro ao carregar cliente.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, shouldFetch]);

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-[#7d848e]">
        <Loader2 className="h-4 w-4 animate-spin" />A carregar dados do
        cliente...
      </div>
    );
  }

  const address = resolveAddress(client);
  const age = ageFrom(client.birth_date);

  const mobile = fromProviders(client, "Telemovel");
  const landline = fromProviders(client, "Telefone");
  const fax = fromProviders(client, "Fax");
  const iban = fromProviders(client, "NIB");
  const idCard = fromProviders(client, "NCartaoIdentificacao");

  return (
    <div className="space-y-5">
      {/* IDENTIFICAÇÃO */}

      <Section title="Identificação" icon={IdCard}>
        <Item label="Nome" value={client.name} wide />
        <Item label="NIF" value={client.nif} />
        <Item
          label="Data de nascimento"
          value={
            client.birth_date
              ? `${formatDate(client.birth_date)}${age !== null ? ` (${age} anos)` : ""}`
              : null
          }
        />
        <Item label="Sexo" value={sexLabel(fromProviders(client, "Sexo", "sexo"))} />
        <Item label="Estado civil" value={fromProviders(client, "EstadoCivil")} />
        <Item label="Profissão / atividade" value={fromProviders(client, "NomeAtividade")} />
        <Item label="Filhos" value={fromProviders(client, "Filhos")} />
        <Item label="Tipo de cliente" value={fromProviders(client, "Tipo")} />
        <Item label="Nº cartão de identificação">
          {idCard ? <SensitiveValue value={idCard} /> : undefined}
        </Item>
      </Section>

      {/* CONTACTOS */}

      <Section title="Contactos" icon={Phone}>
        <Item label="Email" wide>
          {client.email ? (
            <a
              href={`mailto:${client.email}`}
              className="text-[#ff4b0a] hover:underline"
            >
              {client.email}
            </a>
          ) : undefined}
        </Item>
        <Item label="Telemóvel">
          {mobile || client.phone ? (
            <a
              href={`tel:${mobile ?? client.phone}`}
              className="text-[#ff4b0a] hover:underline"
            >
              {mobile ?? client.phone}
            </a>
          ) : undefined}
        </Item>
        <Item label="Telefone" value={landline} />
        <Item label="Fax" value={fax} />
        <Item
          label="Documentos por email"
          value={formatValue("RecDocPorEmail", fromProviders(client, "RecDocPorEmail"))}
        />
      </Section>

      {/* MORADA */}

      <Section title="Morada" icon={MapPin}>
        <Item label="Rua" value={client.street} wide />
        <Item label="Código postal" value={address.postal} />
        <Item label="Localidade" value={address.city} />
        <Item label="País" value={client.country} />

        {address.swapped && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:col-span-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            A companhia enviou o código postal e a localidade trocados. Aqui
            já aparecem corrigidos.
          </div>
        )}
      </Section>

      {/* BANCO */}

      {iban && (
        <Section title="Dados bancários" icon={Landmark}>
          <Item label="NIB / IBAN" wide>
            <SensitiveValue value={iban} />
          </Item>
        </Section>
      )}

      {/* POR COMPANHIA */}

      {client.providers.map((provider) => {
        const entries = Object.entries(provider.metadata)
          .filter(([key]) => !HIDDEN_FIELDS.has(key))
          .map(([key, value]) => ({
            key,
            label: FIELD_LABELS[key] ?? key,
            value: formatValue(key, value),
          }))
          .filter((entry) => entry.value);

        return (
          <section
            key={`${provider.company_id}-${provider.external_id}`}
            className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-semibold text-[#20242a]">
                <Building2 className="h-4 w-4 text-[#ff4b0a]" />
                Ficha na {provider.company_name}
              </h3>

              <span className="inline-flex items-center gap-1 text-[11px] text-[#a0a5ac]">
                <RefreshCw className="h-3 w-3" />
                {formatDateTime(provider.last_synced_at)}
              </span>
            </div>

            {entries.length > 0 ? (
              <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                {entries.map((entry) => (
                  <Item key={entry.key} label={entry.label}>
                    {SENSITIVE_FIELDS.has(entry.key) ? (
                      <SensitiveValue value={entry.value as string} />
                    ) : (
                      entry.value
                    )}
                  </Item>
                ))}
              </dl>
            ) : (
              <p className="mt-3 text-sm text-[#8a9099]">
                A ficha completa desta companhia aparece depois da próxima
                sincronização.
              </p>
            )}
          </section>
        );
      })}

      <p className="text-center text-xs text-[#a0a5ac]">
        No CRM desde {formatDateTime(client.created_at)} · atualizado a{" "}
        {formatDateTime(client.updated_at)}
      </p>
    </div>
  );
}
