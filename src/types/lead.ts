export type LeadStatus =
  | "nova"
  | "em_contacto"
  | "a_aguardar"
  | "simulacao_enviada"
  | "convertida"
  | "perdida";

export type LeadPriority =
  | "baixa"
  | "media"
  | "alta"
  | "urgente";

export type LeadSource =
  | "chatbot"
  | "manual"
  | "importacao";

export type LeadAnswerValue =
  | string
  | number
  | boolean
  | null;

export type LeadHistoryItem = {
  id: string;
  title: string;
  description?: string;
  createdAt: string;
};

export type LeadRecommendation = {
  id: string;
  insuranceType: string;
  reason: string;
  confidence: number;
};

export type Lead = {
  id: string;
  name: string;
  email?: string;
  phone: string;
  birthDate?: string;
  postalCode?: string;
  insuranceType: string;
  status: LeadStatus;
  priority: LeadPriority;
  store: string;
  assignedTo?: string;
  createdAt: string;
  source: LeadSource;
  answers: Record<string, LeadAnswerValue>;
  notes?: string;
  recommendations: LeadRecommendation[];
  history: LeadHistoryItem[];
};