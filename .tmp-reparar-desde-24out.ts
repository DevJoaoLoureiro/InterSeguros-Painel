// Temporário: repõe as apólices Zurich que a importação da Carteira Total
// (dados de 23/10) reescreveu com dados mais antigos. Relê os ficheiros
// diários da Zurich desde 24/10 (ObterFicheiroDia, com o token em vigor;
// NÃO emite tokens) e volta a aplicar o que mudou depois de 23/10.
//
// Offline para clientes/objetos: não faz consultas individuais; um
// cliente sem ficha no ficheiro do dia fica como está no CRM.
//
// Uso: npx tsx --env-file=.env.local .tmp-reparar-desde-24out.ts
import { syncZurichPolicies } from "@/lib/insurance/providers/zurich/sync";

(async () => {
  console.log("A reler ficheiros diários desde 2026-10-24…", new Date().toISOString());

  const result = (await syncZurichPolicies({
    replayFrom: "2026-10-24",
    offline: true,
  })) as unknown as Record<string, unknown>;

  console.log("REPARACAO", JSON.stringify({
    status: result.status,
    received: result.received,
    created: result.created,
    updated: result.updated,
    failed: result.failed,
    errors: Array.isArray(result.errors) ? result.errors.slice(0, 5) : undefined,
  }), new Date().toISOString());
})().catch((error) => {
  console.error("ERRO", error instanceof Error ? error.message : error);
  process.exit(1);
});
