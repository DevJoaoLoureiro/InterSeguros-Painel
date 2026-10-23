import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppTemplate } from "@/lib/whatsapp/client";

/*
 * Aviso por WhatsApp aos utilizadores escolhidos pelo parceiro.
 *
 * Usa um MODELO aprovado pela Meta (obrigatório para escrever a quem
 * não falou com o número nas últimas 24h). O modelo tem 2 variáveis:
 *   {{1}} nome do parceiro
 *   {{2}} nome do cliente
 *
 * Configuração (variáveis de ambiente):
 *   PARTNER_NOTIFY_PHONE_NUMBER_ID  número que envia (phone_number_id)
 *   PARTNER_NOTIFY_TEMPLATE         nome do modelo (nova_apolice_parceiro)
 *   PARTNER_NOTIFY_TEMPLATE_LANG    idioma do modelo (pt_PT)
 *
 * Se o aviso falhar, o envio fica na mesma no CRM; o erro fica
 * registado por destinatário para se ver na página.
 */

type Recipient = {
  userId: string;
  phone: string | null;
};

export async function notifyRecipients(params: {
  submissionId: string;
  partnerName: string;
  clientName: string;
  recipients: Recipient[];
}) {
  const { submissionId, partnerName, clientName, recipients } = params;

  const phoneNumberId = process.env.PARTNER_NOTIFY_PHONE_NUMBER_ID;
  const templateName =
    process.env.PARTNER_NOTIFY_TEMPLATE || "nova_apolice_parceiro";
  const languageCode = process.env.PARTNER_NOTIFY_TEMPLATE_LANG || "pt_PT";

  const admin = createAdminClient();

  await Promise.all(
    recipients.map(async ({ userId, phone }) => {
      let update: Record<string, string | null>;

      if (!phone) {
        update = {
          whatsapp_status: "NO_PHONE",
          whatsapp_error: "Utilizador sem telemóvel WhatsApp registado.",
        };
      } else if (!phoneNumberId) {
        update = {
          whatsapp_status: "FAILED",
          whatsapp_error: "PARTNER_NOTIFY_PHONE_NUMBER_ID não configurado.",
        };
      } else {
        try {
          const { messageId } = await sendWhatsAppTemplate({
            phoneNumberId,
            to: phone,
            templateName,
            languageCode,
            bodyParams: [partnerName, clientName],
          });

          update = {
            whatsapp_status: "SENT",
            whatsapp_message_id: messageId,
            whatsapp_error: null,
          };
        } catch (error) {
          update = {
            whatsapp_status: "FAILED",
            whatsapp_error:
              error instanceof Error ? error.message : "Erro desconhecido.",
          };
        }
      }

      const { error } = await admin
        .from("partner_submission_recipients")
        .update(update)
        .eq("submission_id", submissionId)
        .eq("user_id", userId);

      if (error) {
        console.error("[Parceiros] Erro ao guardar estado do aviso:", error);
      }
    }),
  );
}
