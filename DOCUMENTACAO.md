# InterSeguros Painel — Documentação

Painel interno (CRM) da mediação de seguros do grupo Fisacar. Atualizado a
2026-11-06, a partir do código.

---

## 1. O que faz

- **Carteira:** clientes, apólices, recibos, vencimentos e carteira por companhia.
- **Integrações com seguradoras:** Prévoir (API), Zurich (webservices + ficheiros diários), Generali (ficheiros `.dat`, só pré-visualização).
- **Faturação:** comissões Prévoir (com fecho oficial em PDF) e Zurich, mapa mensal para a contabilidade.
- **Atividades:** tarefas, processos (simulação → emissão → recibo pago), oportunidades, simulador Zurich Auto, conversas WhatsApp, apólices enviadas por parceiros.
- **Leads:** leads do site/chatbot e prospeção (Google Places).
- **Assistente de IA** (OpenAI) com ferramentas que consultam o CRM.

## 2. Stack

| | |
|---|---|
| Framework | Next.js **16.3** (App Router) — ver `AGENTS.md`: há APIs diferentes das versões antigas (`proxy.ts` em vez de `middleware.ts`, `after()`, `next/image` com `preload` em vez de `priority`). Os docs da versão instalada estão em `node_modules/next/dist/docs/`. |
| UI | React 19, Tailwind 4, `@base-ui/react`, `lucide-react` |
| Dados | Supabase (Auth + Postgres + funções SQL) |
| IA | OpenAI (`gpt-5-mini`) |
| Deploy | Vercel (região `fra1`, `vercel.json`) |
| Crons | cron-job.org a chamar `/api/cron/*` |

## 3. Correr localmente

```bash
npm install
npm run dev        # http://localhost:3000
npm run lint
npx tsc --noEmit   # verificação de tipos
```

> ⚠️ **O `.env.local` aponta para PRODUÇÃO** (Supabase real e Zurich PROD). Tudo o que se grava localmente vai para a base de dados real. Não correr syncs, backfills com `apply=1` ou migrações sem querer.

## 4. Variáveis de ambiente

Nunca commitar valores (`.env*` está no `.gitignore`).

| Grupo | Variáveis |
|---|---|
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| App | `NEXT_PUBLIC_APP_URL` (links do formulário de parceiros) |
| Crons | `CRON_SECRET` (cabeçalho `Authorization: Bearer …`) |
| Prévoir | `PREVOIR_API_URL`, `PREVOIR_USERNAME`, `PREVOIR_PASSWORD`, `PREVOIR_MEDIATOR_NUMBER` |
| Zurich | `ZURICH_ENV` (`uat`/`prod`), `ZURICH_USERNAME`, `ZURICH_PASSWORD`, `ZURICH_AGENTE_NR`, `ZURICH_ACCOUNTS` (várias contas/lojas), `ZURICH_TOKEN` (só para arrancar), `ZURICH_ALLOW_TOKEN_ISSUE` (`1` **só na Vercel**), `ZURICH_ENRICHMENT` |
| Zurich OTP (email) | `ZURICH_OTP_EMAIL`, `ZURICH_OTP_EMAIL_PASSWORD`, `ZURICH_OTP_IMAP_HOST`, `ZURICH_OTP_IMAP_PORT`, `ZURICH_OTP_INTERNAL_SECRET` |
| WhatsApp / Meta | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_API_VERSION`, `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET`, `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_ES_CONFIG_ID` |
| Parceiros (aviso WhatsApp) | `PARTNER_NOTIFY_TEMPLATE`, `PARTNER_NOTIFY_TEMPLATE_LANG`, `PARTNER_NOTIFY_PHONE_NUMBER_ID` |
| Leads públicas | `CHATBOT_CRM_SECRET` |
| IA / prospeção | `OPENAI_API_KEY`, `GOOGLE_PLACES_API_KEY` |

## 5. Estrutura

```text
src/
  app/
    (dashboard)/     páginas autenticadas (cada pasta: page.tsx + action(s).ts)
    api/             rotas HTTP (crons, webhooks, IA, ferramentas de admin)
    login/           página de login
    parceiro/[token] formulário público dos parceiros
  components/        UI por área (clientes, recibos, vencimentos, tarefas, simulador, …)
  lib/
    auth/            perfil, permissões, loja selecionada
    insurance/       integrações (providers/prevoir|zurich|generali) e gravação comum (sync/)
    quoting/         motor de estimativas do simulador (Zurich Auto) e observações
    ai/              agente OpenAI e ferramentas
    alerts/          alertas de vencimento e saúde dos syncs
    vencimentos/     consultas de renovações/recibos a vencer
    recovery/        apólices anuladas/não renovadas (recuperação de clientes)
    tasks/           regras de processos e mensagens ao cliente
    supabase/        clientes browser / server / admin
  proxy.ts           autenticação e permissões de todas as rotas
supabase/migrations/ migrações recentes (o esquema anterior a 2026-09-30 não está no repo)
```

### Convenções importantes

- **Server actions usam o cliente admin** (`createAdminClient`, ignora RLS). Por isso **cada action tem de verificar o acesso** com `requireProfile()` / `requireAdmin()` de `lib/auth/access.ts`.
- **Relações do Supabase** podem vir como objeto ou lista: usa-se um helper `first()`/`one()`/`firstRelation()`.
- **Limite de 1000 linhas por pedido** no Supabase: listas grandes leem-se por páginas com `.range()` (ver `lib/recovery/recovery-data.ts`, `lib/vencimentos/queries.ts`).
- **Cache:** dados de referência e cálculos pesados usam `unstable_cache` com tags. A tag `vencimentos` é invalidada pelos crons no fim de cada sync.
- **Estado derivado de props:** ajustar durante o render (padrão `synced…`), não com `setState` dentro de `useEffect` (o lint bloqueia).
- O texto da UI e os comentários estão em português de Portugal.

## 6. Autenticação e permissões

- `src/proxy.ts` corre em todos os pedidos:
  - **Públicas:** `/login`, `/parceiro/*` (token validado na página), `/api/public/leads` (segredo próprio), `/api/whatsapp/webhook` (assinatura da Meta), `/api/zurich/login-code` (segredo interno).
  - **`/api/cron/*`:** só com `CRON_SECRET`.
  - **`/api/dev/*`, `/api/zurich/*`, `/api/prevoir/*`, `/api/generali/*`:** só OWNER/ADMIN.
  - Restantes APIs: qualquer utilizador **ativo**.
- Permissões por **função**, não por loja (`lib/auth/permissions.ts`):
  - **OWNER / ADMIN:** tudo.
  - **Funcionários:** O meu dia, Dashboard, Leads, Clientes, Vencimentos e Recibos, Tarefas, Processos, Oportunidades, Simulador, Conversas, Apólices de Parceiros. Não veem Carteira por companhia, Faturação, Estatísticas nem Gestão.
- A **loja** é só um filtro escolhido no topo (cookie); todos podem ver todas as lojas.

## 7. Páginas

| Menu | Rota | Notas |
|---|---|---|
| O meu dia | `/hoje` | **Página de entrada** (`HOME_PAGE` em `lib/auth/permissions.ts`). "Os meus processos" com o próximo passo à mão (mesmas ações e ecrãs dos Processos, via `components/tarefas/process-workspace.tsx`; "precisam de atenção" = `processAttention()` em `components/tarefas/utils.ts`) + lembretes por urgência (Atrasado / Hoje / Seguimento): tarefas, leads e oportunidades minhas; recibos, renovações e conversas da loja escolhida (ou da minha). Regras dos lembretes em `lib/today/get-today.ts` |
| Dashboard | `/dashboard` | Produção do dia/mês, tarefas, recibos a vencer, alertas |
| Leads (Chat) | `/leads` | Leads do site/chatbot, conversão, prospeção |
| Clientes | `/clientes` | Ficha do cliente, apólices, recibos, papéis, transferências, conselho de IA |
| Vencimentos e Recibos | `/vencimentos` (A tratar) e `/recibos` (Histórico) | Uma só entrada no menu com dois separadores. "A tratar" tem `?tab=renovacoes|recibos|anuladas` |
| Carteira por Companhia | `/carteira`, `/carteira/[company]` | Sempre prémio comercial (ver §11) |
| Faturação | `/faturacao`, `/faturacao/mapa`, `/faturacao/prevoir`, `/faturacao/zurich` | `/comissoes/*` redireciona para aqui (`next.config.ts`) |
| Tarefas | `/tarefas` | |
| Processos | `/processos` | Quadro por fase; "Mensagem ao cliente" (§11). `?abrir=<id>` abre o detalhe de um processo |
| Oportunidades | `/oportunidades` | Kanban |
| Simulador | `/simulador`, `/simulador/metricas` | Estimativa Zurich Auto + registo de cotações reais |
| Conversas | `/conversas` | Inbox WhatsApp |
| Apólices de Parceiros | `/apolices-parceiros` | Envios do formulário `/parceiro/[token]` |
| Estatísticas | `/estatisticas` | |
| Lojas / Utilizadores | `/lojas`, `/utilizadores` | |
| Configurações | `/configuracoes` | WhatsApp, Classificação de Produtos, **Mensagens ao cliente**, Parceiros |

## 8. Rotas de API

### Usadas pelo site ou por serviços externos (não apagar)

| Rota | Quem chama |
|---|---|
| `POST /api/ai` | Painel do assistente |
| `POST /api/whatsapp/send`, `GET /api/whatsapp/conversation/[id]` | Página Conversas |
| `GET/POST /api/whatsapp/webhook` | Meta (verifica `META_APP_SECRET`) |
| `POST /api/public/leads` | Site / chatbot (`CHATBOT_CRM_SECRET`) |
| `GET/POST /api/zurich/login-code` | Leitura do código OTP da Zurich no email (IMAP) |
| `GET /api/cron/zurich-sync` | cron-job.org — apólices + recibos Zurich, renova o token 1×/dia. Responde 202 e corre em `after()`; `?wait=1` espera pelo fim |
| `GET /api/cron/prevoir-sync` | cron-job.org (job "Libax Import") — apólices + recibos Prévoir; `?missing=N` importa apólices em falta |
| `GET /api/cron/zurich-retroactive-backfill` | cron-job.org — observações retroativas para as métricas do simulador |

### Ferramentas manuais (só OWNER/ADMIN)

| Rota | Para quê |
|---|---|
| `/api/dev/zurich-token` | Estado do token Zurich; **emergência:** `POST {"token": "..."}` grava um token gerado no MyZurich |
| `/api/dev/zurichtest` | Testar a ligação à Zurich (só leitura) |
| `/api/dev/zurich-cliente?nif=…` | Ver um cliente na Zurich e no CRM (só leitura, dados pessoais) |
| `/api/dev/zurich-refresh-policy?apolice=…[&apply=1]` | Atualizar objetos/coberturas de uma apólice |
| `/api/dev/zurich-backfill-enrichment`, `/api/dev/zurich-backfill-matriculas`, `/api/dev/zurich-backfill-retroactive-observations` | Backfills por lotes; sem `apply=1` só pré-visualizam |
| `/api/zurich/zurich-async` | Sync Zurich manual com opções de enriquecimento |
| `/api/dev/prevoir-policy-raw?modalidade=…&apolice=…` | Ver uma apólice Prévoir em bruto (dados pessoais mascarados) |
| `POST /api/generali/import` | Pré-visualização (dry-run) de ficheiros `.dat` da Generali |

## 9. Integrações

### Zurich
- Código em `lib/insurance/providers/zurich/`. O sync lê o ficheiro diário de apólices/recibos, consulta cada apólice e grava pelo `sync/` comum.
- **Token partilhado (cuidado):** vive na tabela `integration_tokens`. Cada token novo **invalida o anterior**, e o mesmo utilizador Zurich é usado por outro sistema. Só o cron de produção renova (`ZURICH_ALLOW_TOKEN_ISSUE=1` só na Vercel). **Nunca emitir tokens localmente nem em scripts.** Se o sync falhar com "Código 5" ou HTTP 500 repetidos, perguntar primeiro se alguém pediu credenciais no portal MyZurich. Solução definitiva: um utilizador Zurich próprio para este CRM.
- O ficheiro diário **não traz Vida**: as apólices Vida em falta importam-se com `ObterApolicePorNr` (scripts `.tmp-importar-*.ts` na raiz).

### Prévoir
- API oficial (`lib/insurance/providers/prevoir/`). Sync incremental por data, estado em `integration_sync_state`.
- Faturação: comissões dos recibos + fecho oficial lido de PDF (`pdf-parse`).

### Generali
- Só parser e pré-visualização (`lib/insurance/providers/generali/`); ainda não grava.

### WhatsApp (Meta Cloud API)
- Webhook guarda mensagens/estados; envio pela página Conversas; ligação dos números em Configurações → WhatsApp.

### OpenAI
- `lib/ai/agent.ts` com ferramentas em `lib/ai/tools/` (clientes, apólices, produção, carteira, tarefas, prospeção). As ferramentas filtram pela loja/perfil do utilizador.

## 10. Base de dados (Supabase)

Tabelas principais usadas pelo código:

| Área | Tabelas |
|---|---|
| Utilizadores e lojas | `profiles`, `stores` |
| Companhias e produtos | `companies`, `insurance_lines`, `provider_products` |
| Carteira | `clients`, `client_external_refs`, `policies`, `policy_external_refs`, `receipts`, `receipt_commissions` |
| Integrações | `integration_sync_state`, `integration_sync_runs`, `integration_tokens` |
| Faturação Prévoir | `prevoir_commission_movements`, `prevoir_commission_closings` |
| Atividades | `tasks` (tarefas e processos, `kind`), `opportunities`, `message_templates` |
| Leads | `leads`, `lead_history`, `lead_conversion_requests` |
| Clientes / recuperação | `client_ai_advice`, `client_advice_dismissals`, `policy_recovery_outcomes` |
| Parceiros | `partners`, `partner_submissions`, `partner_submission_recipients`, `partner_submission_files` |
| WhatsApp | `whatsapp_accounts`, `whatsapp_conversations`, `whatsapp_messages` |
| Simulador | `zurich_quote_observations` |

Funções SQL (RPC): `get_receipts_page`, `get_latest_renewal_dates`, `search_clients_portfolio`, `get_clients_portfolio_stats`, `get_opportunity_stats`.

**Migrações:** ficheiros em `supabase/migrations/`, aplicados **à mão** no SQL Editor do Supabase (não há pipeline automático). Antes de aplicar, lembrar que é produção.

## 11. Regras de negócio

- **Carteira = sempre prémio comercial** (do recibo), nunca o total.
- **Classificação:** PPR, Unit Linked, capitalização e poupança contam como **Financeiros**, não como Vida. Vida Risco e Crédito Habitação são **Vida**.
- **Produção do ano (Zurich)** = prémio comercial dos recibos desde 1 de janeiro; não é a mesma coisa que a carteira anual.
- **Comissões** (`lib/insurance/commissions.ts`): se há linha `TOTAL` (Prévoir) usa-se essa; senão somam-se as partes (Zurich: angariação + cobrança).
- **Processos** (`lib/tasks/process-status.ts`): recibo pago → concluído; simulação ou emissão feita → em curso; nada feito → pendente. "Não avançou" (cancelado, `not_issued_*`) é manual, com motivo. Colunas do quadro: Fazer simulação → À espera do cliente → À espera do pagamento → Fechados.
- **Companhia da simulação** (`tasks.simulation_company`, texto): pedida ao passar à fase 2 ("Que companhia simulou?", `components/tarefas/simulation-company.tsx`), escolhida da lista de companhias ativas ou escrita à mão; editável no detalhe do processo. Sem a migração `20261106130000_process_simulation_company.sql` a página funciona, mas a companhia não é gravada (aparece um aviso).
- **Mensagem ao cliente** (`lib/tasks/client-message.ts`): gerada a partir do ramo do processo, com planos standard editáveis. Os modelos editam-se em Configurações → Mensagens (tabela `message_templates`); sem modelo gravado usa-se o do código.
- **Vencimentos:** janela de 30 dias para trás e 30 para a frente; estornos excluídos; uma loja escolhida inclui também apólices ainda sem loja.
- **Anuladas:** apólices que saíram nos últimos 180 dias e não voltaram (`lib/recovery/`).

## 12. Testes e ferramentas

- Testes em `__tests__/` (`node:test`): prospeção, estimador Zurich Auto, calibração e observações. Correm-se depois de compilar para JS (instruções no topo de cada ficheiro).
- `lib/quoting/models/zurich/validation/`: backtest e calibração do estimador (scripts manuais).
- Raiz: `.tmp-importar-apolices.ts`, `.tmp-importar-recibos.ts`, `.tmp-verificar-ativas.ts`. São scripts de importação da carteira Zurich, ainda precisos para as apólices Vida em falta; apagar quando a importação estiver concluída.

## 13. Pendentes conhecidos


- Importar as apólices Zurich Vida que faltam (ficheiro da carteira completa).
- `/api/cron/prevoir-sync` ainda corre de forma síncrona (`maxDuration` 60) e pode dar timeout no cron-job.org; aplicar o mesmo padrão do cron da Zurich (202 + `after()`).
- Confirmar que `ZURICH_ALLOW_TOKEN_ISSUE` não está a `1` no `.env.local`.
- O esquema anterior a 2026-09-30 não está em `supabase/migrations/`: exportá-lo para o repositório.
