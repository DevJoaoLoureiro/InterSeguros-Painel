-- ============================================================
-- Tipos de parceiro aceites
-- ============================================================
--
-- A restrição partners_partner_type_check (criada fora das
-- migrações) não aceitava os tipos que o CRM usa — criar um parceiro
-- falhava sempre. Passa a aceitar os mesmos de PARTNER_TYPES
-- (configuracoes/parceiros/actions.ts) e PARTNER_TYPE_LABELS.

alter table public.partners
  drop constraint if exists partners_partner_type_check;

alter table public.partners
  add constraint partners_partner_type_check
    check (partner_type is null or partner_type in ('PARTNER', 'COMPANY', 'PERSON'));
