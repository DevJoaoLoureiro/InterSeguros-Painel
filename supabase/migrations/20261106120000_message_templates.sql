-- ============================================================
-- Modelos da "Mensagem ao cliente" dos processos
-- ============================================================
--
-- Um modelo por tipo de ramo (lib/tasks/client-message.ts):
-- texto para apólice nova, texto para renegociação e os planos
-- standard que aparecem pré-preenchidos na janela do processo.
-- Sem linha para um ramo, o CRM usa o modelo por defeito do código.
--
-- plans: [{ "name": "Base", "description": "com quebra de vidros" }, ...]

create table if not exists public.message_templates (
  line_kind text primary key
    check (line_kind in ('AUTO', 'HABITACAO', 'SAUDE', 'VIDA', 'OTHER')),
  new_body text not null,
  renewal_body text not null,
  plans jsonb not null default '[]'::jsonb,
  updated_by_user_id uuid
    references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Só o servidor (service role) lê e escreve.
alter table public.message_templates enable row level security;
