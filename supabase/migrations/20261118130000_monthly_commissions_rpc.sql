-- ============================================================
-- Comissões por mês já somadas na BD (Mapa de comissões)
-- ============================================================
--
-- O Mapa (faturacao/mapa) trazia recibo a recibo — a Zurich todos os
-- recibos de sempre, a Generali o ano inteiro — só para os somar no
-- Worker. Passava o limite de CPU e dava "statement timeout" na BD.
-- Esta função devolve uma linha por mês e tipo de plano.
--
-- Regras (iguais às das funções TS que substitui):
--   - comissão = soma de COLLECTION + ACQUISITION do recibo; recibos
--     com soma 0 não contam;
--   - mês = mês da data de pagamento, dentro de [p_from, p_to);
--   - p_paid_status_only: a Generali conta só status PAID; a Zurich
--     conta qualquer recibo com data de pagamento (como antes);
--   - selo oficial = provider_metadata seloMediador + seloCobrador
--     (Generali). stamp_missing = recibos sem esse dado.
--
-- Só o service_role a pode chamar.

drop function if exists public.get_monthly_commissions(text, date, date, boolean);

create function public.get_monthly_commissions(
  p_company_code text,
  p_from date,
  p_to date,
  p_paid_status_only boolean
)
returns table (
  month text,
  plan_type text,
  amount numeric,
  receipts bigint,
  stamp numeric,
  stamp_missing bigint,
  amount_without_stamp numeric
)
language sql
stable
set search_path = public
as $$
  with per_receipt as (
    select
      r.payment_date,
      il.plan_type,
      c.amount,
      r.provider_metadata ->> 'seloMediador' as selo_mediador,
      r.provider_metadata ->> 'seloCobrador' as selo_cobrador
    from public.receipts r
    join public.companies co on co.id = r.company_id
    join public.policies p on p.id = r.policy_id
    left join public.insurance_lines il on il.id = p.insurance_line_id
    join lateral (
      select sum(rc.amount) as amount
      from public.receipt_commissions rc
      where rc.receipt_id = r.id
        and rc.commission_type in ('COLLECTION', 'ACQUISITION')
    ) c on true
    where co.code = p_company_code
      and r.payment_date >= p_from
      and r.payment_date < p_to
      and (not p_paid_status_only or r.status = 'PAID')
  )
  select
    to_char(payment_date, 'YYYY-MM'),
    plan_type,
    sum(amount),
    count(*),
    sum(coalesce(selo_mediador::numeric, 0) + coalesce(selo_cobrador::numeric, 0)),
    count(*) filter (where selo_mediador is null and selo_cobrador is null),
    coalesce(sum(amount) filter (where selo_mediador is null and selo_cobrador is null), 0)
  from per_receipt
  where amount is not null and amount <> 0
  group by 1, 2
  order by 1, 2;
$$;

revoke all on function public.get_monthly_commissions(text, date, date, boolean) from public, anon, authenticated;
grant execute on function public.get_monthly_commissions(text, date, date, boolean) to service_role;

-- Recibos de uma companhia por data de pagamento (Mapa e páginas de
-- faturação filtram assim).
create index if not exists idx_receipts_company_payment_date
  on public.receipts (company_id, payment_date);
create index if not exists idx_receipt_commissions_receipt
  on public.receipt_commissions (receipt_id);
