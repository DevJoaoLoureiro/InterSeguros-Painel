-- ============================================================
-- Apólices enviadas por parceiros
-- ============================================================
--
-- Cada parceiro tem um link próprio (partners.submission_token) para
-- um formulário público: dados do cliente, da apólice, anexos e
-- observações. Escolhe um ou mais utilizadores do CRM, que recebem
-- um aviso por WhatsApp (profiles.whatsapp_phone) e veem o envio em
-- "Apólices de Parceiros".
--
-- Tudo é lido/escrito pelo servidor com a service role (as server
-- actions verificam o token ou a sessão). RLS ligado e sem políticas:
-- a chave pública não chega a estas tabelas nem aos ficheiros.

-- ------------------------------------------------------------
-- Link do parceiro e telemóvel do utilizador
-- ------------------------------------------------------------

alter table public.partners
  add column if not exists submission_token text,
  add column if not exists submission_token_created_at timestamptz;

create unique index if not exists partners_submission_token_key
  on public.partners (submission_token)
  where submission_token is not null;

alter table public.profiles
  add column if not exists whatsapp_phone text;

-- ------------------------------------------------------------
-- Envios
-- ------------------------------------------------------------
--
-- status: DRAFT (criado, anexos a carregar) → NEW → IN_PROGRESS → DONE
-- Um DRAFT que nunca chega a NEW é um envio abandonado a meio.

create table if not exists public.partner_submissions (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'NEW', 'IN_PROGRESS', 'DONE')),

  client_name text not null,
  client_nif text,
  client_phone text,
  client_email text,

  company_name text,
  insurance_line text,
  policy_number text,
  premium numeric(12, 2),
  start_date date,

  notes text,

  submitted_at timestamptz,
  handled_by_user_id uuid references public.profiles (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists partner_submissions_status_idx
  on public.partner_submissions (status, submitted_at desc);

create index if not exists partner_submissions_partner_idx
  on public.partner_submissions (partner_id, created_at desc);

-- Para quem foi enviado + estado do aviso por WhatsApp.
-- whatsapp_status: SENT / FAILED / NO_PHONE
create table if not exists public.partner_submission_recipients (
  submission_id uuid not null
    references public.partner_submissions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  seen_at timestamptz,
  whatsapp_status text,
  whatsapp_message_id text,
  whatsapp_error text,
  created_at timestamptz not null default now(),
  primary key (submission_id, user_id)
);

create index if not exists partner_submission_recipients_user_idx
  on public.partner_submission_recipients (user_id, seen_at);

create table if not exists public.partner_submission_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null
    references public.partner_submissions (id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create index if not exists partner_submission_files_submission_idx
  on public.partner_submission_files (submission_id);

alter table public.partner_submissions enable row level security;
alter table public.partner_submission_recipients enable row level security;
alter table public.partner_submission_files enable row level security;

-- ------------------------------------------------------------
-- Anexos (privados; o CRM gera links temporários para descarregar)
-- ------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'partner-submissions',
  'partner-submissions',
  false,
  15728640, -- 15 MB por ficheiro
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do nothing;
