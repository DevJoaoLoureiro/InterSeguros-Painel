export type ClientRow = {
  id: string;
  name: string;
  nif: string | null;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  created_at: string;
  updated_at: string;
};

export type CompanySummary = {
  id: string;
  code: string;
  name: string;
};

export type InsuranceLineSummary = {
  id: string;
  code: string;
  name: string;
  plan_type:
    | "VIDA"
    | "NAO_VIDA"
    | "FINANCEIROS";
};

export type UserSummary = {
  id: string;
  full_name: string;
};

export type StoreSummary = {
  id: string;
  name: string;
};

export type PolicyRow = {
  id: string;
  client_id: string;

  external_id: string | null;
  policy_number: string;

  product_code: string | null;
  product_name: string | null;

  status:
    | "ACTIVE"
    | "PENDING"
    | "CANCELLED"
    | "EXPIRED"
    | "SUSPENDED"
    | "REDUCED"
    | "UNKNOWN";

  issue_date: string | null;
  start_date: string | null;
  end_date: string | null;
  renewal_date: string | null;
  cancellation_date: string | null;

  commercial_premium: number | null;
  total_premium: number | null;
  annualized_premium: number | null;

    latest_receipt: {
    id: string;
    receipt_number: string | null;
    due_date: string | null;
    commercial_premium: number | null;
    total_premium: number | null;
  } | null;

  payment_frequency:
    | "ANNUAL"
    | "SEMIANNUAL"
    | "QUARTERLY"
    | "MONTHLY"
    | "SINGLE"
    | "OTHER"
    | "UNKNOWN"
    | null;

  origin: string | null;

  commercial_user_id: string | null;
  issued_by_user_id: string | null;
  issuing_store_id: string | null;

  company: CompanySummary | null;
  insurance_line: InsuranceLineSummary | null;
  commercial_user: UserSummary | null;
  issuing_store: StoreSummary | null;

  last_synced_at: string | null;
  created_at: string;
};

export type ProfileRow = {
  id: string;
  full_name: string;
  store_id: string | null;
  role: string;
};

export type PortfolioClient = {
  client: ClientRow;
  policies: PolicyRow[];
  opportunity: ClientOpportunitySummary;
};

export type PortfolioSearchRow = {
  client_id: string;
  latest_issue_date: string | null;
};

export const CLIENTS_PAGE_SIZE = 10;

export type PortfolioFilters = {
  search: string;
  from: string;
  to: string;
  company: string;
  responsible: string;

  sort:
    | "newest"
    | "oldest";

  page: number;
};

export type ClientOpportunitySummary = {
  hasOpportunity: boolean;
  count: number;
  score: number | null;

  level:
    | "low"
    | "medium"
    | "high"
    | null;

  targetLine: string | null;
  reason: string | null;
};

export type PortfolioStats = {
  client_count: number;
  policy_count: number;
  active_policy_count: number;
  annualized_premium: number;
};

export type ClientsPortfolioData = {
  stats: PortfolioStats;

  items: PortfolioClient[];

  page: number;
  totalPages: number;
  totalCount: number;

  companies: CompanySummary[];
  profiles: ProfileRow[];
};