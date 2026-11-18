-- ============================================================
-- Documentos das apólices (PDF da apólice, carta verde, ...)
-- ============================================================
--
-- Os ficheiros ficam no bucket PRIVADO "policy-documents"; abrem-se só
-- com links assinados de poucos minutos (lib/policy-documents).
-- O browser envia o ficheiro diretamente para o Storage com um link de
-- upload assinado pelo servidor (não passa pelo Worker).
--
-- status: PENDING enquanto o ficheiro está a subir; READY depois de o
-- servidor confirmar que chegou ao Storage. Os PENDING antigos são
-- lixo de uploads interrompidos.
--
-- Anexar: qualquer utilizador com sessão. Apagar: só OWNER/ADMIN.
-- Só o servidor (service_role) acede: RLS ligado sem políticas.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'policy-documents',
  'policy-documents',
  false,
  15728640,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do nothing;

create table if not exists public.policy_documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  policy_id uuid not null references public.policies (id) on delete cascade,
  client_id uuid references public.clients (id) on delete set null,
  doc_type text not null check (doc_type in (
    'APOLICE',
    'CONDICOES_GERAIS',
    'CARTA_VERDE',
    'RECIBO',
    'PROPOSTA',
    'DOCUMENTO_CLIENTE',
    'OUTRO'
  )),
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  uploaded_by uuid references public.profiles (id) on delete set null,
  status text not null default 'PENDING' check (status in ('PENDING', 'READY'))
);

create index if not exists idx_policy_documents_policy
  on public.policy_documents (policy_id, created_at desc);
create index if not exists idx_policy_documents_client
  on public.policy_documents (client_id, created_at desc);

alter table public.policy_documents enable row level security;
