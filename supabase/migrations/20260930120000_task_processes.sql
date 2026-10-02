-- ============================================================
-- Processos de seguro dentro de Tarefas
-- ============================================================
--
-- Uma tarefa pode agora ser do tipo PROCESS: o acompanhamento
-- de uma simulação / renegociação desde a criação até ao recibo
-- cobrado. O processo só fecha (COMPLETED) quando o recibo está
-- pago — manualmente ou confirmado pelo webservice da companhia
-- (o webservice tem sempre prioridade sobre a marcação manual).
--
-- Colunas novas são todas opcionais / com default, por isso as
-- tarefas existentes ficam como kind = 'TASK' sem alterações.

alter table public.tasks
  add column if not exists kind text not null default 'TASK',
  add column if not exists client_name text,
  add column if not exists client_nif text,
  add column if not exists insurance_line_id uuid
    references public.insurance_lines (id) on delete set null,
  add column if not exists policy_start_date date,
  add column if not exists is_new_policy boolean,
  add column if not exists simulation_presented boolean not null default false,
  add column if not exists issued boolean not null default false,
  add column if not exists receipt_paid boolean not null default false,
  add column if not exists receipt_source text,
  add column if not exists receipt_id uuid
    references public.receipts (id) on delete set null,
  add column if not exists receipt_paid_at timestamptz;

alter table public.tasks
  drop constraint if exists tasks_kind_check,
  add constraint tasks_kind_check
    check (kind in ('TASK', 'PROCESS'));

alter table public.tasks
  drop constraint if exists tasks_receipt_source_check,
  add constraint tasks_receipt_source_check
    check (receipt_source is null or receipt_source in ('MANUAL', 'WEBSERVICE'));

create index if not exists tasks_process_start_idx
  on public.tasks (kind, policy_start_date)
  where kind = 'PROCESS';

create index if not exists tasks_client_nif_idx
  on public.tasks (client_nif)
  where client_nif is not null;
