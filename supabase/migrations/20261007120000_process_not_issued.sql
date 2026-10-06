-- ============================================================
-- Processos: desfecho "Não emitida" com motivo
-- ============================================================
--
-- Um processo (tasks.kind = 'PROCESS') que não chega a apólice fica
-- com status = 'CANCELLED' e o motivo aqui, para se saber PORQUE se
-- perdem negócios (preço, ficou na companhia atual, ...).
--
-- not_issued_reason: código do motivo (lib/tasks/not-issued.ts)
-- not_issued_note:   texto livre (obrigatório em "Outro motivo")
-- not_issued_at:     quando foi marcado

alter table public.tasks
  add column if not exists not_issued_reason text,
  add column if not exists not_issued_note text,
  add column if not exists not_issued_at timestamptz;
