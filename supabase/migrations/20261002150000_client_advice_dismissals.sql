-- ============================================================
-- Conselhos do cliente (lâmpada) dispensados
-- ============================================================
--
-- Quando alguém carrega em "Dispensar" num conselho, ele deixa de
-- aparecer para toda a equipa até dismissed_until (90 dias).
-- advice_key identifica o conselho, ex.: "cross_sell:AUTO",
-- "renegotiate:<policy_id>".

create table if not exists public.client_advice_dismissals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  advice_key text not null,
  dismissed_by_user_id uuid references public.profiles (id) on delete set null,
  dismissed_until date not null,
  created_at timestamptz not null default now(),
  unique (client_id, advice_key)
);

create index if not exists client_advice_dismissals_client_idx
  on public.client_advice_dismissals (client_id);
