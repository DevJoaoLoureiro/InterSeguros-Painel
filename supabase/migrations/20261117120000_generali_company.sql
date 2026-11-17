-- ============================================================
-- Generali (ex-Tranquilidade): companhia para a integração
-- ============================================================
--
-- O sync (src/lib/insurance/providers/generali/sync.ts) procura a
-- companhia com code = 'GENERALI'. Sem esta linha falha logo no
-- início com "Companhia GENERALI não encontrada".
--
-- O estado do sync (SyncToken) fica em integration_sync_state.cursor,
-- uma linha por recurso (POLICIES, RECEIPTS, CLIENTS): não é preciso
-- nenhuma coluna nova.
--
-- Lojas: depois de conhecer os códigos de mediação da Generali
-- (campo CodigoMediacao das apólices), associar cada um à loja:
--
--   insert into public.store_external_refs (company_id, external_code, store_id)
--   select c.id, '<código>', '<id da loja>'
--   from public.companies c where c.code = 'GENERALI';

insert into public.companies (code, name, company_type, active)
select 'GENERALI', 'Generali', 'INSURER', true
where not exists (
  select 1 from public.companies where code = 'GENERALI'
);
