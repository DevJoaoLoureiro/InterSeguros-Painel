# Documentação do Projeto — InterSeguros Painel

Documento gerado a partir do ZIP base `InterSeguros-Painel.zip` enviado no início da conversa.

> Nota: este documento descreve o projeto base que estava no ZIP. A parte experimental da simulação Allianz/quoting que fomos criando depois não estava integrada neste ZIP base. Aqui fica também uma secção com o que falta para evoluir para a nova aba **Simular** com agente assistido.

---

## 1. Objetivo do projeto

O projeto é um painel interno para gestão operacional de uma mediação/corretora de seguros. A aplicação centraliza:

- autenticação e permissões por utilizador/loja;
- dashboard de produção, leads, tarefas e vencimentos;
- carteira de apólices por companhia;
- clientes e detalhe de apólices/recibos;
- oportunidades comerciais;
- comissões por companhia;
- integração/sincronização com seguradoras como Prévoir, Zurich e Generali;
- conversas WhatsApp;
- assistente interno com OpenAI para consultar dados do CRM.

Stack principal:

- **Next.js 16.3** com App Router;
- **React 19**;
- **TypeScript**;
- **Supabase** para Auth, Postgres e storage;
- **OpenAI API** para o assistente;
- **Tailwind/shadcn/base-ui** para UI;
- integrações HTTP/ficheiros com seguradoras.

---

## 2. Visão geral da arquitetura

```text
Browser / CRM
  ↓
Next.js App Router
  ↓
Server Actions / API Routes
  ↓
Supabase Auth + Supabase Admin Client
  ↓
Base de dados: clientes, apólices, recibos, leads, tarefas, lojas, perfis
  ↓
Integrações externas: Prévoir, Zurich, Generali, WhatsApp, OpenAI
```

O projeto está separado em quatro grandes zonas:

```text
src/app/             Rotas, páginas e API routes do Next.js
src/components/      Componentes React reutilizáveis
src/lib/             Lógica de negócio, integrações, Supabase, AI
src/types/           Tipos globais simples
```

---

## 3. Pastas principais

| Pasta | Objetivo |
|---|---|
| `src/app/(dashboard)` | Área protegida do painel depois do login. |
| `src/app/api` | Endpoints HTTP para AI, crons, integrações e webhooks. |
| `src/components` | UI do painel: tabelas, drawers, formulários, Kanban, chatbot. |
| `src/lib/ai` | Assistente OpenAI e ferramentas para consultar CRM. |
| `src/lib/insurance` | Integrações com seguradoras e normalização de dados. |
| `src/lib/supabase` | Clientes Supabase para browser, server e admin. |
| `src/lib/auth` | Utilizador/perfil autenticado. |
| `src/lib/whatsapp` | Cliente, tipos e parsing do webhook WhatsApp. |
| `public` | Assets estáticos, incluindo logótipo. |

---

## 4. Ficheiros de configuração

| Ficheiro | O que faz | Estado / nota |
|---|---|---|
| `.env.local` | Variáveis de ambiente locais: Supabase, OpenAI, tokens, segredos. | Não deve ser commitado. Confirmar `.gitignore`. |
| `.gitignore` | Ignora ficheiros locais/build/dependências. | Deve incluir `.env*`, `.next`, `node_modules`, `.sessions`. |
| `package.json` | Define scripts e dependências. | Tem Next 16.3, React 19, Supabase, OpenAI. |
| `package-lock.json` | Lockfile npm. | Manter commitado. |
| `tsconfig.json` | Configuração TypeScript. | Base do projeto Next. |
| `next.config.ts` | Configuração Next.js. | Ver se precisa de regras para imagens/domínios. |
| `eslint.config.mjs` | Configuração ESLint. | Usado por `npm run lint`. |
| `postcss.config.mjs` | Configuração PostCSS/Tailwind. | Necessário para CSS. |
| `components.json` | Configuração shadcn/components. | Controla aliases e estilo dos componentes UI. |
| `next-env.d.ts` | Tipos gerados pelo Next. | Não editar manualmente. |
| `vercel.json` | Configuração de deploy Vercel/crons. | Verificar rotas cron e timeouts. |
| `AGENTS.md` | Regras para agentes de código sobre Next.js 16. | Útil para não usar APIs antigas. |
| `CLAUDE.md` | Aponta para `AGENTS.md`. | Documento auxiliar. |
| `README.md` | README original do create-next-app. | Falta substituir por README real do projeto. |

---

## 5. Rotas e páginas do dashboard

### Dashboard geral

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/app/(dashboard)/layout.tsx` | Layout protegido do dashboard. Carrega perfil, loja, sidebar/header. | Estrutura comum da aplicação autenticada. |
| `src/app/(dashboard)/dashboard/page.tsx` | Página principal com métricas de produção, leads, tarefas, recibos e gráficos. | Visão geral diária/mensal da operação. |
| `src/app/page.tsx` | Página raiz. | Normalmente redireciona/serve entrada. |
| `src/app/layout.tsx` | Layout raiz da app. | Define HTML global, fonts e providers. |
| `src/app/globals.css` | CSS global. | Tema, Tailwind e estilos base. |
| `src/app/login/page.tsx` | Página de login. | Entrada via Supabase Auth. |

### Carteira

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/app/(dashboard)/carteira/page.tsx` | Página resumo da carteira por companhia. | Mostrar companhias, produção/carteira e navegação. |
| `src/app/(dashboard)/carteira/[company]/page.tsx` | Página de uma companhia específica. | Ver carteira filtrada por companhia. |
| `src/app/(dashboard)/carteira/action.ts` | Server actions/queries da carteira. | Consultar apólices, lojas acessíveis, produção anual e filtros. |

### Clientes

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/app/(dashboard)/clientes/page.tsx` | Página de clientes. | Renderiza lista/tabela de clientes. |
| `src/app/(dashboard)/clientes/action.ts` | Lógica de dados dos clientes e apólices. | Buscar portefólio por cliente, mapear apólices e atribuições. |
| `src/app/(dashboard)/clientes/receipts-action.ts` | Busca recibos de uma apólice. | Alimenta detalhe/drawer do cliente. |

### Leads

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/app/(dashboard)/leads/page.tsx` | Página de leads. | Lista leads conforme permissões. |
| `src/app/(dashboard)/leads/actions.ts` | Ações de leads: atribuir, reatribuir, status, conversão, documentos. | Gestão completa do ciclo da lead. |
| `src/app/api/public/leads/route.ts` | Endpoint público para receber leads. | Entrada externa de leads sem sessão. |

### Oportunidades

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/app/(dashboard)/oportunidades/page.tsx` | Página de oportunidades comerciais. | Kanban/lista de oportunidades. |
| `src/app/(dashboard)/oportunidades/action.ts` | CRUD e queries de oportunidades. | Criar, atualizar, fechar/reabrir e apagar oportunidades. |

### Tarefas

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/app/(dashboard)/tarefas/page.tsx` | Página de tarefas. | Renderiza board de tarefas. |
| `src/app/(dashboard)/tarefas/action.ts` | CRUD de tarefas. | Criar, atualizar estado, apagar e permissões. |
| `src/app/(dashboard)/tarefas/tasks-board.tsx` | UI interativa das tarefas. | Cartões, filtros e modal de criação/edição. |

### Recibos e vencimentos

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/app/(dashboard)/recibos/page.tsx` | Página de recibos. | Lista recibos e filtros. |
| `src/app/(dashboard)/recibos/action.ts` | Queries de recibos. | Buscar recibos com relações para cliente/apólice/companhia. |
| `src/app/(dashboard)/vencimentos/page.tsx` | Página de vencimentos. | Mostra renovações e recibos próximos. |
| `src/app/(dashboard)/vencimentos/action.ts` | Queries de vencimentos. | Calcula janelas de datas, vencidos e próximos. |

### Estatísticas

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/app/(dashboard)/estatisticas/page.tsx` | Página de estatísticas. | Visualização de produção, comparações e rankings. |
| `src/app/(dashboard)/estatisticas/action.ts` | Cálculos estatísticos. | Produção mensal, comparação entre meses, rankings por pessoa/loja. |

### Comissões

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/app/(dashboard)/comissoes/page.tsx` | Entrada para módulos de comissões. | Escolha por companhia. |
| `src/app/(dashboard)/comissoes/prevoir/page.tsx` | Página de comissões Prévoir. | Visão da comissão da Prévoir. |
| `src/app/(dashboard)/comissoes/prevoir/actions.ts` | Cálculo e detalhe de comissões Prévoir. | Resumos por loja, fechos oficiais, movimentos, importação. |
| `src/app/(dashboard)/comissoes/prevoir/comissoes-board.tsx` | UI das comissões Prévoir. | Métricas, detalhe, formulários e movimentos. |
| `src/app/(dashboard)/comissoes/zurich/page.tsx` | Página de comissões Zurich. | Visão da comissão Zurich. |
| `src/app/(dashboard)/comissoes/zurich/actions.ts` | Cálculo de comissões Zurich. | Resumos e detalhe com base nos recibos. |
| `src/app/(dashboard)/comissoes/zurich/comissoes-board.tsx` | UI das comissões Zurich. | Tabelas e métricas. |

### Configurações

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/app/(dashboard)/configuracoes/page.tsx` | Página principal de configurações. | Links para configurações internas. |
| `src/app/(dashboard)/configuracoes/classificacao-produtos/page.tsx` | Página de classificação de produtos. | Classificar produtos por ramo/linha de seguro. |
| `src/app/(dashboard)/configuracoes/classificacao-produtos/action.ts` | Queries e atualização de classificações. | Buscar produtos sem classificação e gravar ramo. |
| `src/app/(dashboard)/configuracoes/classificacao-produtos/product-classification-row.tsx` | Linha editável de classificação. | UI para guardar classificação por produto. |

### Lojas e utilizadores

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/app/(dashboard)/lojas/page.tsx` | Página de lojas. | Gerir lojas/agências. |
| `src/app/(dashboard)/lojas/actions.ts` | Ações de lojas. | Criar, editar e ativar/desativar lojas. |
| `src/app/(dashboard)/utilizadores/page.tsx` | Página de utilizadores. | Gerir equipa/perfis. |
| `src/app/(dashboard)/utilizadores/actions.ts` | Ações de utilizadores. | Criar colaborador e ativar/desativar. |

### Conversas WhatsApp

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/app/(dashboard)/conversas/page.tsx` | Página de conversas. | Carrega contas e conversas WhatsApp. |
| `src/app/(dashboard)/conversas/conversas-board.tsx` | UI do inbox WhatsApp. | Lista conversas, mensagens e envio. |

---

## 6. API routes

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/app/api/ai/route.ts` | Endpoint POST do assistente OpenAI. | Recebe mensagem do chat e chama `runAiAgent`. |
| `src/app/api/cron/prevoir-sync/route.ts` | Cron de sincronização Prévoir. | Sincroniza apólices e recibos. Protegido por `CRON_SECRET` no proxy. |
| `src/app/api/cron/zurich-sync/route.ts` | Cron de sincronização Zurich. | Sincroniza Zurich. Protegido por `CRON_SECRET`. |
| `src/app/api/generali/import/route.ts` | Importação de ficheiros Generali. | Recebe ficheiros `.dat`, faz dry-run/import. |
| `src/app/api/prevoir/sync-policies/route.ts` | Sincronização manual/API de apólices Prévoir. | Executa sync de apólices. |
| `src/app/api/prevoir/sync-receipts/route.ts` | Sincronização manual/API de recibos Prévoir. | Executa sync de recibos. |
| `src/app/api/prevoir/products/route.ts` | Produtos Prévoir. | Lista/analisa produtos do provider. |
| `src/app/api/prevoir/check-ppr-count/route.ts` | Verificação PPR. | Endpoint auxiliar de análise. |
| `src/app/api/prevoir/receipt-analysis/route.ts` | Análise de recibos Prévoir. | Endpoint auxiliar para diagnóstico. |
| `src/app/api/prevoir/receipt-policy-audit/route.ts` | Auditoria recibos/apólices. | Verifica relação entre recibos e apólices. |
| `src/app/api/prevoir/test-receipts/route.ts` | Teste de recibos Prévoir. | Endpoint de desenvolvimento/teste. |
| `src/app/api/dev/check-receipt-fields/route.ts` | Diagnóstico de campos de recibos. | Dev tool. Não deveria estar público em produção. |
| `src/app/api/dev/check-renewal-fields/route.ts` | Diagnóstico de campos de renovação. | Dev tool. Não deveria estar público em produção. |
| `src/app/api/dev/prevoir-incremental-test/route.ts` | Teste incremental Prévoir. | Dev tool. |
| `src/app/api/dev/zurichtest/route.ts` | Teste Zurich. | Dev tool. |
| `src/app/api/whatsapp/webhook/route.ts` | Webhook WhatsApp/Meta. | Recebe mensagens, valida assinatura e grava conversa. |
| `src/app/api/whatsapp/send/route.ts` | Envio de WhatsApp. | Envia mensagem e grava no CRM. |
| `src/app/api/whatsapp/conversation/[conversationId]/route.ts` | Mensagens de uma conversa. | Consulta mensagens e marca conversa como lida/atualizada. |
| `src/app/api/zurich/zurich-async/route.ts` | Endpoint auxiliar Zurich. | Execução assíncrona/diagnóstico Zurich. |

---

## 7. Componentes React

### AI / chatbot

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/components/ai/assistant-provider.tsx` | Provider de estado do assistente. | Guarda mensagens, abertura do painel e `previousResponseId`. |
| `src/components/ai/assistant-panel.tsx` | Painel flutuante do chat. | UI para conversar com o assistente interno. |

### Autenticação

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/components/auth/login-form.tsx` | Formulário de login. | Login com Supabase. |
| `src/components/auth/logout-button.tsx` | Botão de logout. | Terminar sessão. |

### Layout

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/components/layout/app-sidebar.tsx` | Sidebar desktop. | Navegação principal. |
| `src/components/layout/mobile-sidebar.tsx` | Sidebar mobile. | Navegação em ecrãs pequenos. |
| `src/components/layout/dashboard-header.tsx` | Header do dashboard. | Topbar com contexto/utilizador/notificações. |

### Dashboard

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/components/dashboard/dashboard-charts.tsx` | Gráficos do dashboard. | Visualização de produção e métricas. |
| `src/components/dashboard/metric-cards.tsx` | Cartões de métricas. | Reutilização de KPIs. |

### Carteira / clientes / recibos

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/components/carteira/carteira-board.tsx` | Board/tabela de carteira. | Mostrar apólices por filtros. |
| `src/components/clientes/client-list.tsx` | Lista de clientes. | Container da listagem. |
| `src/components/clientes/clients-table.tsx` | Tabela de clientes. | UI tabular, filtros e seleção. |
| `src/components/clientes/policy-details-drawer.tsx` | Drawer de detalhes da apólice. | Ver dados da apólice e recibos relacionados. |
| `src/components/clientes/types.ts` | Tipos usados pelos componentes de clientes. | Contrato de dados da UI. |
| `src/components/recibos/receipts-page.tsx` | UI da página de recibos. | Lista, filtros e estados. |
| `src/components/recibos/types.ts` | Tipos da UI de recibos. | Tipagem local. |

### Leads

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/components/leads/leads-page.tsx` | Página composta de leads. | Junta header, resumo, filtros e tabela. |
| `src/components/leads/leads-header.tsx` | Cabeçalho de leads. | Título e ações. |
| `src/components/leads/leads-summary.tsx` | Resumo/KPIs de leads. | Métricas por estado/prioridade. |
| `src/components/leads/leads-filters.tsx` | Filtros de leads. | Filtrar por status, prioridade, responsável, etc. |
| `src/components/leads/leads-table.tsx` | Tabela de leads. | Listagem principal. |
| `src/components/leads/lead-details-drawer.tsx` | Drawer de detalhe da lead. | Ver/alterar lead e documentos. |
| `src/components/leads/lead-status-badge.tsx` | Badge de estado. | Visual consistente do status. |
| `src/components/leads/lead-priority-badge.tsx` | Badge de prioridade. | Visual consistente da prioridade. |

### Oportunidades

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/components/opportunities/opportunities-kanban.tsx` | Kanban de oportunidades. | Mover/visualizar oportunidades por estado. |
| `src/components/opportunities/create-opportunity-dialog.tsx` | Modal de criação. | Criar oportunidade. |
| `src/components/opportunities/edit-opportunity-dialog.tsx` | Modal de edição. | Editar oportunidade. |
| `src/components/opportunities/opportunity-status-select.tsx` | Select de status. | Alterar estado da oportunidade. |

### Lojas/utilizadores

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/components/stores/create-store-form.tsx` | Formulário de criação de loja. | Criar agência/loja. |
| `src/components/stores/edit-store-modal.tsx` | Modal de edição de loja. | Editar dados da loja. |
| `src/components/stores/stores-table.tsx` | Tabela de lojas. | Listar e ativar/desativar lojas. |
| `src/components/users/create-user-form.tsx` | Formulário de utilizador. | Criar colaborador. |
| `src/components/users/users-table.tsx` | Tabela de utilizadores. | Listar, mostrar role e ativar/desativar. |

### Outros componentes

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/components/vencimentos/vencimentos-board.tsx` | Board de vencimentos. | Alterna entre renovações e recibos próximos. |
| `src/components/ui/button.tsx` | Botão base. | Componente UI reutilizável. |
| `src/components/ui/sheet.tsx` | Sheet/drawer base. | Componente UI reutilizável. |
| `components/ui/button.tsx` | Cópia/variante de botão fora de `src`. | Verificar se é duplicado desnecessário. |
| `components/ui/sheet.tsx` | Cópia/variante de sheet fora de `src`. | Verificar se é duplicado desnecessário. |

---

## 8. Biblioteca `src/lib`

### Supabase e autenticação

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/lib/supabase/client.ts` | Cria Supabase client para browser. | Usado em componentes client-side. |
| `src/lib/supabase/server.ts` | Cria Supabase client server-side com cookies. | Usado em Server Components/Actions. |
| `src/lib/supabase/admin.ts` | Cria Supabase admin client com service role. | Operações privilegiadas no servidor. |
| `src/lib/auth/get-current-profile.ts` | Obtém perfil autenticado. | Centraliza user + role + loja/permissões. |
| `src/proxy.ts` | Middleware/proxy de autenticação. | Protege rotas, libera leads públicas, WhatsApp webhook e crons com segredo. |
| `src/lib/utils.ts` | Helper `cn`. | Junta classes Tailwind com `clsx` e `tailwind-merge`. |

### Assistente AI

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/lib/ai/openai.ts` | Inicializa cliente OpenAI. | Usado pelo agente. |
| `src/lib/ai/agent.ts` | Define tools e executa o agente. | Cérebro do chatbot interno. Consulta CRM com function calling. |
| `src/lib/ai/context.ts` | Carrega contexto do utilizador para o agente. | Garante permissões no assistente. |
| `src/lib/ai/tools/clients.ts` | Ferramentas de clientes. | Procurar cliente, detalhes e apólices. |
| `src/lib/ai/tools/client-360.ts` | Visão 360 de cliente. | Resumo completo de cliente/apólices. |
| `src/lib/ai/tools/client-opportunities.ts` | Oportunidades por cliente. | Usa motor de oportunidades comerciais. |
| `src/lib/ai/tools/portfolio.ts` | Ferramentas de carteira diária/data. | Apólices emitidas hoje ou em data específica. |
| `src/lib/ai/tools/policies.ts` | Ferramentas de apólices. | Por período, vencimentos, não atribuídas. |
| `src/lib/ai/tools/production.ts` | Ferramentas de produção. | Resumo e comparação entre períodos. |
| `src/lib/ai/tools/management.ts` | Ferramentas de gestão. | Overview para perfis de gestão. |
| `src/lib/ai/tools/renewals.ts` | Ficheiro vazio ou placeholder. | Completar ou remover. |

### Integrações de seguros — tipos e sync comum

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/lib/insurance/types.ts` | Tipo normalizado de apólice. | Contrato comum entre providers e base de dados. |
| `src/lib/insurance/sync/upsert-client.ts` | Upsert de clientes. | Cria/atualiza cliente e referência externa. |
| `src/lib/insurance/sync/upsert-policy.ts` | Upsert de apólices. | Cria/atualiza apólice normalizada. |
| `src/lib/insurance/sync/upsert-receipt.ts` | Upsert individual de recibo. | Grava recibo e histórico/alterações. |
| `src/lib/insurance/sync/batch-upsert-receipts.ts` | Upsert em lote de recibos. | Melhor performance e detecção de alterações. |
| `src/lib/insurance/sync/resolve-provider-store.ts` | Resolve loja do provider. | Liga dados externos à loja certa. |
| `src/lib/insurance/sync/upsert-policy.ts.bak` | Backup antigo. | Remover após confirmar versão atual. |

### Provider Prévoir

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/lib/insurance/providers/prevoir/client.ts` | Cliente HTTP/API Prévoir. | Login e consulta de apólices. |
| `src/lib/insurance/providers/prevoir/mapper.ts` | Mapeia apólices Prévoir. | Converte dados externos para modelo normalizado. |
| `src/lib/insurance/providers/prevoir/sync.ts` | Sincroniza apólices Prévoir. | Busca, mapeia e grava apólices/clientes. |
| `src/lib/insurance/providers/prevoir/receipts.ts` | Cliente/consulta de recibos Prévoir. | Obtém recibos do provider. |
| `src/lib/insurance/providers/prevoir/receipt-mapper.ts` | Mapeia recibos Prévoir. | Normaliza recibos. |
| `src/lib/insurance/providers/prevoir/receipt-sync.ts` | Sincroniza recibos Prévoir. | Busca, mapeia, relaciona e grava recibos. |
| `src/lib/insurance/providers/prevoir/sync.ts.bak` | Backup antigo. | Remover quando já não for preciso. |

### Provider Zurich

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/lib/insurance/providers/zurich/client.ts` | Cliente API/ficheiros Zurich. | Autenticação/token, chamadas e obtenção de apólices/recibos/clientes. |
| `src/lib/insurance/providers/zurich/file-parser.ts` | Parser de ficheiros Zurich. | Lê ficheiros de apólices, recibos e clientes. |
| `src/lib/insurance/providers/zurich/mapper.ts` | Mapeia apólices Zurich. | Normaliza dados Zurich. |
| `src/lib/insurance/providers/zurich/receipt-mapper.ts` | Mapeia recibos Zurich. | Normaliza recibos Zurich. |
| `src/lib/insurance/providers/zurich/sync.ts` | Sincroniza apólices e recibos Zurich. | Orquestra chamadas, parsing, upsert e estado incremental. |
| `src/lib/insurance/providers/zurich/import-clients.ts` | Importa clientes Zurich do dia. | Atualização de clientes a partir de ficheiros. |

### Provider Generali

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/lib/insurance/providers/generali/types.ts` | Tipos dos ficheiros Generali. | Contrato para parser/dry-run. |
| `src/lib/insurance/providers/generali/dat-parser.ts` | Parser `.dat`. | Lê ficheiros exportados. |
| `src/lib/insurance/providers/generali/policy-mapper.ts` | Mapeia apólices Generali. | Normaliza apólices. |
| `src/lib/insurance/providers/generali/receipt-mapper.ts` | Mapeia recibos Generali. | Normaliza recibos. |
| `src/lib/insurance/providers/generali/dry-run.ts` | Dry-run de importação. | Analisa impacto antes de gravar. |

### Leads, notificações e oportunidades

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/lib/leads/get-leads.ts` | Query simples de leads. | Obter leads para UI. |
| `src/lib/notifications/get-notifications.ts` | Gera notificações. | Tarefas, vencimentos e alertas. |
| `src/lib/opportunities/client-opportunities.ts` | Motor de oportunidades por cliente. | Detecta oportunidades comerciais por ramos em falta/nível. |

### WhatsApp

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/lib/whatsapp/client.ts` | Cliente de envio WhatsApp. | Envia mensagens texto pela API da Meta. |
| `src/lib/whatsapp/types.ts` | Tipos WhatsApp. | Conversas, mensagens, status e direção. |
| `src/lib/whatsapp/webhook.ts` | Helpers do webhook. | Normaliza telefone, timestamp e conteúdo de mensagem. |

---

## 9. Tipos e dados

| Ficheiro | O que faz | Objetivo |
|---|---|---|
| `src/types/lead.ts` | Tipos de lead. | Status, prioridade e estrutura da lead. |
| `src/data/leads.ts` | Ficheiro de dados vazio/placeholder. | Remover se não for usado. |

---

## 10. Assets públicos

| Ficheiro | O que faz |
|---|---|
| `public/interseguroslogo.png` | Logótipo da InterSeguros. |
| `public/file.svg` | Ícone estático do template Next. |
| `public/globe.svg` | Ícone estático do template Next. |
| `public/next.svg` | Ícone estático do template Next. |
| `public/vercel.svg` | Ícone estático do template Next. |
| `public/window.svg` | Ícone estático do template Next. |

Nota: os SVGs do template Next podem ser removidos se não forem usados.

---

## 11. Modelo funcional atual

### O que já existe

- Login/autenticação Supabase.
- Proteção de rotas por proxy.
- Dashboard operacional.
- Gestão de leads.
- Gestão de clientes/carteira.
- Gestão de tarefas.
- Gestão de lojas e utilizadores.
- Gestão de oportunidades comerciais.
- Recibos e vencimentos.
- Comissões Prévoir e Zurich.
- Sincronizações Prévoir e Zurich.
- Importação Generali via ficheiros `.dat`.
- WhatsApp inbox + envio + webhook.
- Assistente AI interno ligado a ferramentas do CRM.

### O que não estava no ZIP base

- Motor de simulação multicompanhia.
- Pasta `src/lib/quoting`.
- Aba `/simular`.
- Integração Allianz com Playwright.
- Runtime de simulações.
- Chat de simulação guiado por companhia.
- Persistência de sessões de simulação.

---

## 12. O que falta / próximos passos

### Prioridade alta

1. **Limpar o repositório**
   - Remover `.next` do ZIP/repo.
   - Remover `node_modules` do ZIP/repo.
   - Confirmar que `.env.local` não está commitado.
   - Remover backups `.bak` quando já não forem necessários.
   - Remover componentes duplicados em `components/ui` fora de `src`, se não forem usados.

2. **README real do projeto**
   - Como instalar.
   - Variáveis de ambiente necessárias, sem valores reais.
   - Como correr localmente.
   - Como correr syncs.
   - Como fazer deploy.

3. **Documentar base de dados**
   - Tabelas principais.
   - Relações.
   - RLS/permissões.
   - Campos obrigatórios por módulo.

4. **Separar dev endpoints de produção**
   - Rotas `/api/dev/*` devem estar protegidas ou removidas em produção.
   - Garantir que endpoints de teste não expõem dados reais.

5. **Testes mínimos**
   - Testes dos mappers Prévoir/Zurich/Generali.
   - Testes de upsert de recibos/apólices.
   - Testes do motor de oportunidades.
   - Testes do AI tools com permissões.

### Prioridade média

6. **Observabilidade**
   - Logs estruturados por sync.
   - ID de execução por importação/sincronização.
   - Página interna para histórico de syncs.
   - Alertas quando cron falha.

7. **Permissões e auditoria**
   - Auditar ações sensíveis: criação de utilizador, alteração de loja, reatribuição de lead, importações.
   - Garantir que o AI só consulta dados permitidos ao perfil autenticado.

8. **Melhorar o assistente AI atual**
   - Adicionar tool para recibos.
   - Adicionar tool para tarefas.
   - Adicionar tool para vencimentos.
   - Adicionar tool para simulação assistida no futuro.
   - Melhorar memória/conversa por sessão no teu backend, não só `previousResponseId`.

9. **Normalização entre seguradoras**
   - Garantir que ramos, produtos, estados e frequências são consistentes.
   - Melhorar `provider_products` e classificação de produtos.

### Prioridade para a nova aba Simular

10. **Criar módulo `quoting` limpo**

Estrutura sugerida:

```text
src/lib/quoting/
  domain/
    insurer.ts
    quote-request.ts
    quote-result.ts
    coverage.ts
  engine/
    quote-execution.ts
    simulation-chat.ts
  adapters/
    allianz/
      runtime.ts
      observer.ts
      actions.ts
      decider.ts
    zurich/
    fidelidade/
    ageas/
```

11. **Criar página `/simular`**

```text
src/app/(dashboard)/simular/page.tsx
src/components/quoting/simulation-chat.tsx
src/components/quoting/company-selector.tsx
```

12. **Modo agente assistido**

O fluxo recomendado:

```text
Mediador escolhe companhia/produto
→ agente pede dados mínimos
→ backend executa passos conhecidos
→ portal é observado
→ se aparecer pergunta visível, o CRM pergunta ao mediador
→ se o portal estiver partido/ambíguo, faz handoff manual
```

13. **Allianz: não full-auto**

Para Allianz, o modo correto deve ser:

```text
Automático apenas até onde for estável.
Assistido quando houver campos visíveis.
Manual handoff quando houver erro JS, iframe instável, hidden fields inconsistentes ou labels não inicializadas.
```

14. **Persistência das simulações**

Criar tabelas como:

```text
quote_sessions
quote_messages
quote_results
quote_audit_events
```

Para poderes guardar:

- quem pediu;
- companhia;
- dados mínimos;
- perguntas feitas;
- respostas do mediador;
- screenshots/logs se necessário;
- resultado final ou motivo de handoff.

---

## 13. Riscos técnicos

| Risco | Impacto | Mitigação |
|---|---|---|
| Portais de seguradoras instáveis | Simulações falham | Modo assistido + manual handoff. |
| `.env.local` exposto | Segurança crítica | Nunca commit das envs. Rodar segredos se necessário. |
| Falta de testes nos mappers | Dados errados na carteira/recibos | Testes unitários com fixtures reais anonimizadas. |
| Dev endpoints em produção | Exposição de dados/ações | Proteger/remover `/api/dev/*`. |
| Dependência de schemas Supabase não documentados | Difícil manutenção | Criar `docs/database.md`. |
| AI a responder fora das permissões | Risco de privacidade | Todas as tools devem filtrar por perfil/permissão. |
| Sincronizações longas em Vercel | Timeout | Jobs por lotes + estado incremental. |

---

## 14. Decisão recomendada para o projeto

Não apagar o projeto base. O ZIP mostra que já existe bastante coisa útil: CRM, carteira, clientes, recibos, leads, comissões, WhatsApp e AI.

O que faz sentido é:

```text
1. Preservar este projeto base.
2. Criar uma branch limpa.
3. Remover lixo gerado/backups.
4. Criar módulo novo /simular separado.
5. Implementar Allianz só em modo assistido.
6. Testar outras companhias uma a uma antes de prometer full-auto.
```

---

## 15. Checklist rápida

### Antes de continuar

- [ ] Fazer commit do estado atual.
- [ ] Criar branch limpa.
- [ ] Guardar o ZIP como baseline.
- [ ] Remover `.next`, `node_modules` e `.env.local` do versionamento.
- [ ] Atualizar `.gitignore`.
- [ ] Escrever README real.

### Para o módulo Simular

- [ ] Criar rota `/simular`.
- [ ] Criar chat de simulação.
- [ ] Criar tipos `QuoteRequest`, `QuoteResult`, `RequiredInput`.
- [ ] Criar runtime por companhia.
- [ ] Criar observer/action/decider por companhia.
- [ ] Criar manual handoff.
- [ ] Guardar logs/auditoria.
- [ ] Começar com Allianz assistida, não full-auto.

---

## 16. Resumo curto

O projeto base é um painel de gestão para mediação de seguros, já com CRM, carteira, clientes, recibos, leads, comissões, WhatsApp, syncs de seguradoras e assistente AI.

O que falta é documentação, limpeza do repo, testes, hardening de segurança/produção e um módulo separado para simulações multicompanhia.

Para a simulação, a direção certa é criar uma aba **Simular** com chat/agente assistido. A Allianz deve entrar como integração assistida, não como automação 100% autónoma.
