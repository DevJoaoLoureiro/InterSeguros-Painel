-- ============================================================
-- Vencimentos rápidos
--
-- 1) policy_renewals: a próxima renovação de cada apólice ativa,
--    calculada UMA vez (no fim de cada sync) em vez de em cada pedido.
--    Antes, get_upcoming_renewals calculava o aniversário das ~11 000
--    apólices ativas (com o provider_metadata inteiro) a cada chamada,
--    e uma vez por cada página de 1000 linhas.
-- 2) get_upcoming_renewals passa a ler esta tabela (com índice).
-- 3) *_all: devolvem tudo num só JSON (sem páginas de 1000 linhas,
--    que obrigavam o Postgres a refazer a função em cada página).
-- ============================================================

create table if not exists public.policy_renewals (
  policy_id uuid primary key references public.policies (id) on delete cascade,
  next_renewal date not null,
  computed_at timestamptz not null default now()
);

create index if not exists idx_policy_renewals_next
  on public.policy_renewals (next_renewal);

-- Só o servidor (service role) lê/escreve.
alter table public.policy_renewals enable row level security;

-- ------------------------------------------------------------
-- Recalcular (chamado no fim de cada sync). Mesma regra que
-- 20261118140000_renewals_by_anniversary: aniversário do contrato;
-- Generali pelo início da anuidade (sem o 1.º ano); sem prémio único.
-- A janela começa 7 dias para trás, como a página.
-- ------------------------------------------------------------
create or replace function public.refresh_policy_renewals()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from date := current_date - 7;
  v_changed integer;
begin
  with base as (
    select
      p.id,
      p.start_date,
      co.code as company_code,
      public.policy_iso_date(p.provider_metadata ->> 'inicioPeriodo') as inicio_periodo,
      public.policy_iso_date(p.provider_metadata ->> 'fimPeriodo') as fim_periodo
    from public.policies p
    left join public.companies co on co.id = p.company_id
    where p.status = 'ACTIVE'
      and coalesce(p.payment_frequency, '') <> 'SINGLE'
  ),
  computed as (
    select
      b.id as policy_id,
      case
        when b.company_code = 'GENERALI' and b.inicio_periodo is not null then
          case
            when b.inicio_periodo >= v_from
              and (b.start_date is null or b.inicio_periodo > b.start_date)
              then b.inicio_periodo
            else coalesce(b.fim_periodo, public.next_anniversary(b.start_date, v_from))
          end
        else public.next_anniversary(b.start_date, v_from)
      end as next_renewal
    from base b
  ),
  removed as (
    delete from public.policy_renewals pr
    where not exists (
      select 1
      from computed c
      where c.policy_id = pr.policy_id
        and c.next_renewal is not null
    )
    returning 1
  ),
  upserted as (
    insert into public.policy_renewals (policy_id, next_renewal, computed_at)
    select c.policy_id, c.next_renewal, now()
    from computed c
    where c.next_renewal is not null
    on conflict (policy_id) do update
      set next_renewal = excluded.next_renewal,
          computed_at = excluded.computed_at
      where public.policy_renewals.next_renewal is distinct from excluded.next_renewal
    returning 1
  )
  select (select count(*) from removed) + (select count(*) from upserted)
  into v_changed;

  return v_changed;
end;
$$;

revoke all on function public.refresh_policy_renewals() from public, anon, authenticated;

-- ------------------------------------------------------------
-- Renovações: agora só lê a tabela acima (mesmas colunas de antes).
-- ------------------------------------------------------------
create or replace function public.get_upcoming_renewals(
  p_store_id uuid,
  p_from date,
  p_to date
)
returns table (
  policy_id uuid,
  policy_number text,
  client_id uuid,
  client_name text,
  company_name text,
  line_name text,
  renewal_date date,
  annualized_premium numeric,
  store_id uuid,
  store_name text
)
language sql
stable
set search_path = public
as $$
  select
    p.id,
    p.policy_number,
    p.client_id,
    c.name,
    co.name,
    il.name,
    pr.next_renewal,
    p.annualized_premium,
    p.issuing_store_id,
    st.name
  from public.policy_renewals pr
  join public.policies p on p.id = pr.policy_id
  left join public.clients c on c.id = p.client_id
  left join public.companies co on co.id = p.company_id
  left join public.insurance_lines il on il.id = p.insurance_line_id
  left join public.stores st on st.id = p.issuing_store_id
  where pr.next_renewal between p_from and p_to
    and p.status = 'ACTIVE'
    and (
      p_store_id is null
      or p.issuing_store_id = p_store_id
      or p.issuing_store_id is null
    )
  order by pr.next_renewal, p.id;
$$;

-- ------------------------------------------------------------
-- Tudo num só pedido (JSON), sem o limite de 1000 linhas.
-- ------------------------------------------------------------
create or replace function public.get_upcoming_renewals_all(
  p_store_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(to_jsonb(t) order by t.renewal_date, t.policy_id),
    '[]'::jsonb
  )
  from public.get_upcoming_renewals(p_store_id, p_from, p_to) t;
$$;

create or replace function public.get_upcoming_receipts_all(
  p_store_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(to_jsonb(t) order by t.due_date, t.receipt_id),
    '[]'::jsonb
  )
  from public.get_upcoming_receipts(p_store_id, p_from, p_to) t;
$$;

-- Preencher já a tabela.
select public.refresh_policy_renewals();
