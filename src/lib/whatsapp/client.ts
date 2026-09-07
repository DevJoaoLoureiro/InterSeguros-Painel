type SendTextParams = {
  phoneNumberId: string;
  to: string;
  text: string;
};

export async function sendWhatsAppText({
  phoneNumberId,
  to,
  text,
}: SendTextParams) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const apiVersion = process.env.WHATSAPP_API_VERSION || "v23.0";

  if (!accessToken) {
    throw new Error(
      "WhatsApp ainda não está configurado: WHATSAPP_ACCESS_TOKEN em falta."
    );
  }

  const response = await fetch(
    `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
   body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to.replace(/[^\d]/g, ""),
        type: "text",
        text: {
            preview_url: false,
            body: text,
        },
        }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("[WhatsApp] Meta API error:", data);

    throw new Error(
      data?.error?.message ||
        "Erro ao enviar mensagem pelo WhatsApp."
    );
  }

  return data;
}