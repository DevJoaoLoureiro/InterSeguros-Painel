-- ============================================================
-- Renovações = aniversário do contrato (não o fim do último recibo)
-- ============================================================
--
-- Renovação é a data em que o contrato faz anos e renova por mais um
-- ano, seja qual for a forma de pagamento. A versão anterior usava o
-- period_end do último recibo: nas apólices mensais/trimestrais dava
-- uma "renovação" por prestação, e quando a companhia já tinha emitido
-- o recibo da anuidade seguinte (a Generali fá-lo ~45 dias antes) a
-- renovação saltava para o ano seguinte antes de acontecer.
--
-- As companhias não enviam a data de forma fiável (2026-11-18):
--   Zurich   DataRevalidacao vazia em 99% das apólices ativas;
--   Prévoir  não envia;
--   Generali DtVencimentoApolice já aponta para a anuidade seguinte.
--
-- Regra:
--   Generali: provider_metadata.inicioPeriodo (início da anuidade em
--     curso/seguinte, data exata da companhia) se ainda não passou de
--     p_from e não é o início do contrato (1.º ano); senão fimPeriodo
--     (a próxima).
--   Restantes: próximo aniversário de start_date >= p_from (confirmado
--     contra os recibos anuais: 100% Prévoir, 93% Zurich — o resto são
--     alterações a meio do ano).
--   Prémio único (payment_frequency SINGLE) não renova: fica de fora.

create or replace function public.policy_iso_date(p_value text)
returns date
language sql
immutable
as $$
  select case
    when p_value ~ '^\d{4}-\d{2}-\d{2}$' then p_value::date
  end;
$$;

-- Próximo aniversário de p_start em ou depois de p_from (nunca a própria
-- data de início: o 1.º ano não é uma renovação). 29/02 → 28/02.
create or replace function public.next_anniversary(p_start date, p_from date)
returns date
language sql
immutable
as $$
  select case when p_start is null then null else (
    select case
      when candidate >= p_from then candidate
      else (candidate + interval '1 year')::date
    end
    from (
      select (
        p_start + make_interval(
          years => greatest(1, extract(year from p_from)::int - extract(year from p_start)::int)
        )
      )::date as candidate
    ) c
  ) end;
$$;

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
    select
      p.*,
      co.code as company_code,
      co.name as company_name,
      public.policy_iso_date(p.provider_metadata ->> 'inicioPeriodo') as inicio_periodo,
      public.policy_iso_date(p.provider_metadata ->> 'fimPeriodo') as fim_periodo
    from public.policies p
    left join public.companies co on co.id = p.company_id
    where p.status = 'ACTIVE'
      and coalesce(p.payment_frequency, '') <> 'SINGLE'
      and (
        p_store_id is null
        or p.issuing_store_id = p_store_id
        or p.issuing_store_id is null
      )
  ),
  dated as (
    select
      s.*,
      case
        when s.company_code = 'GENERALI' and s.inicio_periodo is not null then
          case
            -- No 1.º ano o período começa no início do contrato: isso é
            -- o arranque, não uma renovação.
            when s.inicio_periodo >= p_from
              and (s.start_date is null or s.inicio_periodo > s.start_date)
              then s.inicio_periodo
            else coalesce(s.fim_periodo, public.next_anniversary(s.start_date, p_from))
          end
        else public.next_anniversary(s.start_date, p_from)
      end as next_renewal
    from scoped s
  )
  select
    d.id,
    d.policy_number,
    d.client_id,
    c.name,
    d.company_name,
    il.name,
    d.next_renewal,
    d.annualized_premium,
    d.issuing_store_id,
    st.name
  from dated d
  left join public.clients c on c.id = d.client_id
  left join public.insurance_lines il on il.id = d.insurance_line_id
  left join public.stores st on st.id = d.issuing_store_id
  where d.next_renewal between p_from and p_to
  order by d.next_renewal, d.id;
$$;

revoke all on function public.get_upcoming_renewals(uuid, date, date) from public, anon, authenticated;
grant execute on function public.get_upcoming_renewals(uuid, date, date) to service_role;
