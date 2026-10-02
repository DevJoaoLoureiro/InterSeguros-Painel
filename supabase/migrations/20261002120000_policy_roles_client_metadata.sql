-- ============================================================
-- Intervenientes da apólice + dados do cliente do webservice
-- ============================================================
--
-- Papéis de uma apólice (um mesmo utilizador pode ter todos):
--   angariador  → policies.acquirer_user_id   (novo, qualquer utilizador)
--   gestor      → policies.issued_by_user_id  (já existe: quem emitiu)
--   comercial   → policies.commercial_user_id (já existe)
--   origem      → policies.partner_id         (já existe: parceiro externo)
--                 ou policies.origin_user_id  (novo: funcionário interno)
--
-- A origem é OU um parceiro OU um funcionário, nunca os dois.

alter table public.policies
  add column if not exists acquirer_user_id uuid
    references public.profiles (id) on delete set null,
  add column if not exists origin_user_id uuid
    references public.profiles (id) on delete set null;

alter table public.policies
  drop constraint if exists policies_single_origin_check,
  add constraint policies_single_origin_check
    check (partner_id is null or origin_user_id is null);

create index if not exists policies_acquirer_user_idx
  on public.policies (acquirer_user_id)
  where acquirer_user_id is not null;

create index if not exists policies_origin_user_idx
  on public.policies (origin_user_id)
  where origin_user_id is not null;

-- (partner_id já tinha índice: idx_policies_partner)

-- ------------------------------------------------------------
-- Dados completos do cliente tal como cada companhia os envia
-- (sexo, profissão, estado civil, contactos, CC, NIB, ...).
-- Guardado por companhia na referência externa do cliente.
-- ------------------------------------------------------------

alter table public.client_external_refs
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb;
