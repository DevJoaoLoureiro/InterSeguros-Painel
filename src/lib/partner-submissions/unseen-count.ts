import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Envios de parceiros para este utilizador que ele ainda não abriu
 * (badge do menu). Os rascunhos não contam.
 */
export async function getUnseenPartnerSubmissionsCount(userId: string) {
  const { count, error } = await createAdminClient()
    .from("partner_submission_recipients")
    .select("submission_id, partner_submissions!inner ( status )", {
      count: "exact",
      head: true,
    })
    .eq("user_id", userId)
    .is("seen_at", null)
    .neq("partner_submissions.status", "DRAFT");

  if (error) {
    console.error("[Parceiros] Erro ao contar envios por abrir:", error);
    return 0;
  }

  return count ?? 0;
}
