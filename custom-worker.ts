/*
 * Ponto de entrada do Worker na Cloudflare.
 *
 * - fetch: a app Next.js, tal como o OpenNext a gera.
 * - scheduled: os crons (Cron Triggers, ver "triggers" no wrangler.jsonc).
 *   Substituem o cron-job.org: na Cloudflare o trabalho feito depois da
 *   resposta (after()) é cortado ao fim de ~30 s, e um Cron Trigger de
 *   hora a hora ou mais espaçado pode correr até 15 minutos.
 *
 * Cada cron chama a rota /api/cron/* correspondente POR DENTRO do Worker
 * (sem sair para a internet), com o CRON_SECRET, por isso a lógica e a
 * proteção das rotas ficam exatamente iguais.
 *
 * Horas em UTC (Lisboa = UTC no inverno, UTC+1 no verão).
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — gerado pelo `opennextjs-cloudflare build`
import { default as nextHandler } from "./.open-next/worker.js";

type CronJob = { path: string; method: "GET" | "POST" };

/* A chave é a expressão cron, igual à do wrangler.jsonc. */
const CRON_JOBS: Record<string, CronJob> = {
  // Zurich: apólices + recibos (+ renovação do token, se ativa).
  // ?wait=1 corre o sync dentro do pedido em vez de em after().
  "0 6,18 * * *": { path: "/api/cron/zurich-sync?wait=1", method: "GET" },
  // Prévoir: apólices + recibos.
  "30 6 * * *": { path: "/api/cron/prevoir-sync", method: "POST" },
  // Observações retroativas para as métricas do simulador (depois do sync).
  "0 7 * * *": { path: "/api/cron/zurich-retroactive-backfill", method: "GET" },
};

type Env = { CRON_SECRET?: string } & Record<string, unknown>;
type Ctx = { waitUntil(promise: Promise<unknown>): void };

const worker = {
  fetch: (request: Request, env: Env, ctx: Ctx): Promise<Response> =>
    nextHandler.fetch(request, env, ctx),

  async scheduled(controller: { cron: string }, env: Env, ctx: Ctx) {
    const job = CRON_JOBS[controller.cron];

    if (!job) {
      throw new Error(`[cron] Sem tarefa para "${controller.cron}"`);
    }

    if (!env.CRON_SECRET) {
      throw new Error("[cron] CRON_SECRET em falta no Worker");
    }

    const startedAt = Date.now();
    const request = new Request(
      new URL(job.path, "https://app.interseguros.pt"),
      {
        method: job.method,
        headers: { authorization: `Bearer ${env.CRON_SECRET}` },
      },
    );

    const response = await nextHandler.fetch(request, env, ctx);
    // Só o início da resposta: contagens e erros, sem dados de clientes.
    const summary = (await response.text()).slice(0, 300);

    console.log("[cron]", job.path, {
      status: response.status,
      durationMs: Date.now() - startedAt,
      summary,
    });

    // Falha visível no separador "Cron Triggers" do dashboard.
    if (!response.ok) {
      throw new Error(`[cron] ${job.path} respondeu ${response.status}`);
    }
  },
};

export default worker;
