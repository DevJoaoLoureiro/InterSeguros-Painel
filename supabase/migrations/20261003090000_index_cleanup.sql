-- ============================================================
-- Limpeza de índices duplicados/redundantes (OPCIONAL)
-- ============================================================
--
-- Cada índice a mais ocupa espaço e torna cada escrita mais lenta
-- (o sync atualiza todos os índices em cada insert/update).
-- Aqui só saem índices de PESQUISA que têm um equivalente:
--   - duplicados exatos (mesma definição, outro nome);
--   - redundantes: um índice composto já começa pelas mesmas
--     colunas e serve as mesmas consultas.
-- NÃO toca em chaves primárias nem em restrições UNIQUE.
--
-- As tabelas são pequenas: cada DROP é instantâneo.

-- ---------- policies: duplicados exatos ----------
drop index if exists public.idx_policies_client_id;          -- = idx_policies_client
drop index if exists public.idx_policies_company_id;         -- = idx_policies_company
drop index if exists public.idx_policies_commercial_user_id; -- = idx_policies_commercial
drop index if exists public.idx_policies_issuing_store_id;   -- = idx_policies_store
drop index if exists public.policies_partner_idx;            -- = idx_policies_partner (criado na migração dos intervenientes)

-- ---------- policies: cobertos por um composto ----------
drop index if exists public.idx_policies_client;             -- coberto por idx_policies_client_issue (client_id, issue_date, id)
drop index if exists public.idx_policies_client_issue_date;  -- = idx_policies_client_issue sem o id
drop index if exists public.idx_policies_company;            -- coberto pelo UNIQUE (company_id, external_id)
drop index if exists public.idx_policies_commercial;         -- coberto por idx_policies_responsible_issue
drop index if exists public.idx_policies_store;              -- coberto por idx_policies_store_issue
drop index if exists public.idx_policies_store_issue_date;   -- coberto por idx_policies_store_issue
drop index if exists public.idx_policies_company_issue_date; -- coberto por idx_policies_company_issue
drop index if exists public.idx_policies_commercial_issue_date; -- coberto por idx_policies_responsible_issue

-- ---------- receipts ----------
drop index if exists public.idx_receipts_policy_latest;       -- = idx_receipts_policy_latest_valid
drop index if exists public.idx_receipts_policy_latest_valid; -- idx_receipts_latest_valid_by_policy é a versão completa (INCLUDE)
drop index if exists public.idx_receipts_policy;              -- coberto por idx_receipts_policy_id_due_date
drop index if exists public.idx_receipts_company;             -- coberto pelo UNIQUE (company_id, external_id)
drop index if exists public.idx_receipts_status;              -- coberto por idx_receipts_status_due

-- ---------- receipt_commissions / client_external_refs ----------
drop index if exists public.idx_receipt_commissions_receipt;  -- coberto pelo UNIQUE (receipt_id, commission_type)
drop index if exists public.idx_client_external_refs_company; -- coberto pelo UNIQUE (company_id, external_id)

-- ---------- em falta ----------
-- Deteção de transferências: procurar apólices pela matrícula.
create index if not exists idx_policies_vehicle_registration
  on public.policies ((provider_metadata->>'vehicleRegistration'));
