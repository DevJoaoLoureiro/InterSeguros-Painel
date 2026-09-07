export type WhatsAppDirection = "INBOUND" | "OUTBOUND";

export type WhatsAppMessageStatus =
  | "PENDING"
  | "SENT"
  | "DELIVERED"
  | "READ"
  | "FAILED";

export type WhatsAppMessageType =
  | "TEXT"
  | "IMAGE"
  | "DOCUMENT"
  | "AUDIO"
  | "VIDEO"
  | "STICKER"
  | "LOCATION"
  | "UNKNOWN";

export type WhatsAppAccount = {
  id: string;
  store_id: string;
  phone_number: string | null;
  phone_number_id: string | null;
  waba_id: string | null;
  display_name: string | null;
  is_active: boolean;
};

export type WhatsAppConversation = {
  id: string;
  whatsapp_account_id: string;
  store_id: string;
  client_id: string | null;
  customer_phone: string;
  customer_name: string | null;
  status: "OPEN" | "CLOSED";
  unread_count: number;
  last_message_at: string | null;
};

export type WhatsAppMessage = {
  id: string;
  conversation_id: string;
  whatsapp_account_id: string;
  external_message_id: string | null;
  direction: WhatsAppDirection;
  message_type: WhatsAppMessageType;
  body: string | null;
  media_id: string | null;
  media_url: string | null;
  status: WhatsAppMessageStatus | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
};