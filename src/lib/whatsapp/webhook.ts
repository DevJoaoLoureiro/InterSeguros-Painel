export function normalizeWhatsAppPhone(
  phone?: string | null
): string | null {
  if (!phone) return null;

  const normalized = phone.replace(/[^\d]/g, "");

  return normalized || null;
}

export function whatsappTimestampToIso(
  timestamp?: string | number | null
): string {
  if (!timestamp) {
    return new Date().toISOString();
  }

  const value = Number(timestamp);

  if (!Number.isFinite(value)) {
    return new Date().toISOString();
  }

  return new Date(value * 1000).toISOString();
}

export function extractWhatsAppMessageContent(message: any) {
  let body: string | null = null;
  let mediaId: string | null = null;

  switch (message?.type) {
    case "text":
      body = message?.text?.body ?? null;
      break;

    case "image":
      body = message?.image?.caption ?? null;
      mediaId = message?.image?.id ?? null;
      break;

    case "document":
      body =
        message?.document?.caption ??
        message?.document?.filename ??
        null;

      mediaId = message?.document?.id ?? null;
      break;

    case "audio":
      mediaId = message?.audio?.id ?? null;
      break;

    case "video":
      body = message?.video?.caption ?? null;
      mediaId = message?.video?.id ?? null;
      break;

    case "sticker":
      mediaId = message?.sticker?.id ?? null;
      break;

    case "location":
      body = JSON.stringify(message?.location ?? {});
      break;

    default:
      break;
  }

  return {
    body,
    mediaId,
    messageType: String(
      message?.type ?? "unknown"
    ).toUpperCase(),
  };
}