export type LeadStatus =
  | "nova"
  | "em_contacto"
  | "proposta"
  | "ganha"
  | "perdida";

export type LeadPriority =
  | "baixa"
  | "media"
  | "alta";

export type LeadAnswers = {
  registration?: string;
  [key: string]: string | undefined;
};

export type Lead = {
  id: string;

  name: string;
  phone: string;

  insurance_type: string;

  status: LeadStatus;
  priority: LeadPriority;

  source: string | null;
  source_reference: string | null;

  answers: LeadAnswers | null;

  store_id: string | null;
  assigned_to: string | null;

  created_at: string;
  updated_at: string | null;
};