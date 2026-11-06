# InterSeguros Painel

CRM interno da mediação de seguros do grupo Fisacar: carteira, recibos,
vencimentos, faturação, integrações com Prévoir/Zurich/Generali, WhatsApp e
assistente de IA.

```bash
npm install
npm run dev        # http://localhost:3000
npm run lint
npx tsc --noEmit
```

> ⚠️ O `.env.local` aponta para **produção** (Supabase e Zurich reais).

Documentação completa: [DOCUMENTACAO.md](./DOCUMENTACAO.md).
Regras para agentes de código (Next.js 16): [AGENTS.md](./AGENTS.md).
