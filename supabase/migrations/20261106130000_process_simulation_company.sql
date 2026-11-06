-- ============================================================
-- Processos: companhia que fez a simulação
-- ============================================================
--
-- Pedida ao passar um processo para "Simulação apresentada".
-- Guarda-se o nome (escolhido da lista de companhias ou escrito à
-- mão, ex.: uma companhia sem integração). Fica vazio nos
-- processos antigos.

alter table public.tasks
  add column if not exists simulation_company text;
