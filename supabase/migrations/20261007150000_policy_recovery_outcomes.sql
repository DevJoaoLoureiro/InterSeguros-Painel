-- ============================================================
-- Anuladas: resultado do contacto com o cliente
-- ============================================================
--
-- No separador "Anuladas" (Vencimentos) regista-se o que aconteceu
-- quando se contactou o cliente para tentar recuperar a apólice:
-- recuperado, não quer, foi para outra companhia, ... — para se saber
-- PORQUE se perdem clientes.
--
-- Uma linha por apólice (o último resultado substitui o anterior).
-- outcome: código de lib/recovery/outcomes.ts

create table if not exists public.policy_recovery_outcomes (
  policy_id uuid primary key
    references public.policies (id) on delete cascade,
  outcome text not null,
  note text,
  recorded_by_user_id uuid
    references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now()
);

-- Só o servidor (service role) lê e escreve.
alter table public.policy_recovery_outcomes enable row level security;
