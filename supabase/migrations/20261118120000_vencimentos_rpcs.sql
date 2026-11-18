-- ============================================================
-- Vencimentos num só pedido (renovações, recibos a vencer, vencidos)
-- ============================================================
--
-- Antes (src/lib/vencimentos/queries.ts), a cada página do CRM (corre
-- no layout):
--   - todas as apólices ativas, de 1000 em 1000 (~10 pedidos);
--   - get_latest_renewal_dates com milhares de ids;
--   - clientes e lojas em blocos de 150 ids;
--   - todos os recibos vencidos, linha a linha, só para os contar.
-- No Worker da Cloudflare isto passava o limite de subpedidos
-- ("Too many subrequests") e de CPU. Estas funções fazem o filtro e os
-- joins na BD e devolvem só as linhas da janela.
--
-- p_store_id null = todas as lojas. Com loja, incluem-se também as
-- apólices SEM loja (por associar), como antes.
--
-- Só o service_role (createAdminClient) as pode chamar: devolvem nomes
-- de clientes, por isso nada de anon/authenticated.

-- Estorno: mesmo critério do código antigo de recibos (external_nature
-- '9' ou receipt_type com ESTORNO/REVERSAL).

-- Havia na BD uma get_upcoming_renewals de uma tentativa anterior
-- (commit ea367cc, desfeita depois) com outras colunas; já nada a usa.
-- O create or replace não muda o tipo de retorno: apaga-se primeiro.
drop function if exists public.get_upcoming_renewals(uuid, date, date);
drop function if exists public.get_upcoming_receipts(uuid, date, date);
drop function if exists public.count_overdue_receipts(uuid, date);

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
  with scoped as (
    select p.*
    from public.policies p
    where p.status = 'ACTIVE'
      and (
        p_store_id is null
        or p.issuing_store_id = p_store_id
        or p.issuing_store_id is null
      )
  ),
  latest as (
    -- Igual a get_latest_renewal_dates: period_end do último recibo
    -- não-estorno de cada apólice.
    select distinct on (r.policy_id)
      r.policy_id,
      r.period_end
    from public.receipts r
    join scoped s on s.id = r.policy_id
    where r.period_end is not null
      and r.external_nature is distinct from '9'
      and coalesce(upper(r.receipt_type), '') not in ('ESTORNO', 'REVERSAL')
    order by r.policy_id, r.period_end desc
  )
  select
    s.id,
    s.policy_number,
    s.client_id,
    c.name,
    co.name,
    il.name,
    l.period_end,
    s.annualized_premium,
    s.issuing_store_id,
    st.name
  from latest l
  join scoped s on s.id = l.policy_id
  left join public.clients c on c.id = s.client_id
  left join public.companies co on co.id = s.company_id
  left join public.insurance_lines il on il.id = s.insurance_line_id
  left join public.stores st on st.id = s.issuing_store_id
  where l.period_end between p_from and p_to
  order by l.period_end, s.id;
$$;

create or replace function public.get_upcoming_receipts(
  p_store_id uuid,
  p_from date,
  p_to date
)
returns table (
  receipt_id uuid,
  receipt_number text,
  policy_number text,
  client_id uuid,
  client_name text,
  company_name text,
  due_date date,
  commercial_premium numeric,
  total_premium numeric,
  store_id uuid,
  store_name text
)
language sql
stable
set search_path = public
as $$
  select
    r.id,
    r.receipt_number,
    p.policy_number,
    p.client_id,
    c.name,
    co.name,
    r.due_date,
    r.commercial_premium,
    r.total_premium,
    p.issuing_store_id,
    st.name
  from public.receipts r
  left join public.policies p on p.id = r.policy_id
  left join public.clients c on c.id = p.client_id
  left join public.companies co on co.id = r.company_id
  left join public.stores st on st.id = p.issuing_store_id
  where r.status = 'PENDING'
    and r.due_date between p_from and p_to
    and r.external_nature is distinct from '9'
    and position('ESTORNO' in upper(coalesce(r.receipt_type, ''))) = 0
    and position('REVERSAL' in upper(coalesce(r.receipt_type, ''))) = 0
    and (
      p_store_id is null
      or p.issuing_store_id = p_store_id
      or p.issuing_store_id is null
    )
  order by r.due_date, r.id;
$$;

create or replace function public.count_overdue_receipts(
  p_store_id uuid,
  p_today date
)
returns bigint
language sql
stable
set search_path = public
as $$
  select count(*)
  from public.receipts r
  join public.policies p on p.id = r.policy_id
  where r.status = 'PENDING'
    and r.due_date < p_today
    and r.external_nature is distinct from '9'
    and position('ESTORNO' in upper(coalesce(r.receipt_type, ''))) = 0
    and position('REVERSAL' in upper(coalesce(r.receipt_type, ''))) = 0
    and (
      p_store_id is null
      or p.issuing_store_id = p_store_id
      or p.issuing_store_id is null
    );
$$;

revoke all on function public.get_upcoming_renewals(uuid, date, date) from public, anon, authenticated;
revoke all on function public.get_upcoming_receipts(uuid, date, date) from public, anon, authenticated;
revoke all on function public.count_overdue_receipts(uuid, date) from public, anon, authenticated;

grant execute on function public.get_upcoming_renewals(uuid, date, date) to service_role;
grant execute on function public.get_upcoming_receipts(uuid, date, date) to service_role;
grant execute on function public.count_overdue_receipts(uuid, date) to service_role;

-- Índices para os filtros acima (não falham se já existirem).
create index if not exists idx_receipts_policy_period_end
  on public.receipts (policy_id, period_end desc);
create index if not exists idx_receipts_status_due_date
  on public.receipts (status, due_date);
