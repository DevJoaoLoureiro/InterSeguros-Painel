export type LeadStatus =
  | "nova"
  | "em_contacto"
  | "a_aguardar"
  | "simulacao_enviada"
  | "proposta"
  | "ganha"
  | "convertida"
  | "perdida";

export type LeadPriority =
  | "baixa"
  | "media"
  | "alta"
  | "urgente";

export type Lead = {
  id: string;

  name: string;
  phone: string;

  insurance_type: string;

  status: LeadStatus;
  priority: LeadPriority;

  source: string | null;
  source_reference: string | null;

  answers: Record<string, string> | null;

  store_id: string | null;
assigned_user_id: string | null;

  created_at: string;
  updated_at: string | null;
};