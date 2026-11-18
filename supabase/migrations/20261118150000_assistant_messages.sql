-- ============================================================
-- Mensagens do assistente (alertas dentro do CRM)
-- ============================================================
--
-- Alertas criados pelo CRM (crons de sync) para as pessoas certas:
-- p.ex. "a renovação do Auto do cliente X sobe 23%". Aparecem no topo
-- do CRM com som (components/assistant/assistant-inbox.tsx).
--
-- Destino:
--   target_user_id  → só essa pessoa (ex.: o comercial da apólice);
--   senão store_id  → todos os utilizadores dessa loja;
--   senão           → só OWNER/ADMIN.
--   OWNER/ADMIN veem todas.
--
-- dedupe_key: o mesmo alerta não se cria duas vezes (os crons correm
-- de 12 em 12 horas).
--
-- Só o servidor (service_role) lê e escreve: RLS ligado sem políticas.

create table if not exists public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null,
  severity text not null default 'info'
    check (severity in ('info', 'warning', 'high')),
  store_id uuid references public.stores (id) on delete set null,
  target_user_id uuid references public.profiles (id) on delete set null,
  policy_id uuid references public.policies (id) on delete cascade,
  client_id uuid references public.clients (id) on delete set null,
  title text not null,
  body text not null,
  href text,
  data jsonb not null default '{}'::jsonb,
  dedupe_key text unique
);

create index if not exists idx_assistant_messages_created
  on public.assistant_messages (created_at desc);
create index if not exists idx_assistant_messages_store
  on public.assistant_messages (store_id, created_at desc);
create index if not exists idx_assistant_messages_target
  on public.assistant_messages (target_user_id, created_at desc);

create table if not exists public.assistant_message_reads (
  message_id uuid not null references public.assistant_messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.assistant_messages enable row level security;
alter table public.assistant_message_reads enable row level security;
