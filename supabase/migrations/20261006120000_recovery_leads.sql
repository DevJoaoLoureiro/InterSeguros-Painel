-- ============================================================
-- Leads de recuperação de clientes perdidos
-- ============================================================
--
-- Todos os dias (no fim do sync) o CRM cria uma lead com
-- source = 'recuperacao' para clientes que saíram e cujo
-- aniversário da saída está a ≤45 dias (é quando o seguro que
-- fizeram noutra companhia vai renovar).
--
-- source_reference = 'recuperacao:<policy_id>:<data do aniversário>'
-- Este índice garante que a mesma recuperação nunca gera duas leads,
-- mesmo que o cron corra várias vezes no mesmo dia.

create unique index if not exists leads_recovery_reference_key
  on public.leads (source_reference)
  where source = 'recuperacao';
