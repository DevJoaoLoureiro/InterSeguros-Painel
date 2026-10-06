import { createAdminClient } from "@/lib/supabase/admin";
import { runRecoveryLeads } from "@/lib/recovery/recovery-leads";

/**
 * DEV (só OWNER/ADMIN — protegido no proxy).
 * Leads de recuperação de clientes perdidos.
 *
 *   /api/dev/recovery-leads                 → PRÉ-VISUALIZAR (não cria nada)
 *   /api/dev/recovery-leads?today=2026-11-01 → simular outro dia
 *   /api/dev/recovery-leads?run=1           → criar as leads (o cron já
 *                                            faz isto todos os dias)
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const run = searchParams.get("run") === "1";
  const today = searchParams.get("today");

  if (today && !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return Response.json(
      { success: false, error: "today deve ser AAAA-MM-DD." },
      { status: 400 },
    );
  }

  try {
    const result = await runRecoveryLeads(createAdminClient(), {
      dryRun: !run,
      today: today ?? undefined,
    });

    return Response.json(
      { success: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
