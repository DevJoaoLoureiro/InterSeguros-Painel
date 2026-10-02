-- ============================================================
-- Cache da análise da IA na lâmpada do cliente
-- ============================================================
--
-- A IA só corre quando alguém pede ("Pedir à IA"). O resultado fica
-- guardado por cliente e é reutilizado no mesmo dia enquanto os
-- factos do cliente não mudarem (facts_hash) — evita pagar a mesma
-- análise várias vezes.

create table if not exists public.client_ai_advice (
  client_id uuid primary key references public.clients (id) on delete cascade,
  facts_hash text not null,
  payload jsonb not null,
  model text,
  generated_by_user_id uuid references public.profiles (id) on delete set null,
  generated_at timestamptz not null default now()
);
