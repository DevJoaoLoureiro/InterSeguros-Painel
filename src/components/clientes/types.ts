export type ClientRow = {
  id: string;
  source: string;
  external_id: string;
  name: string;
  nif: string | null;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  city: string | null;
  street: string | null;
  last_synced_at: string;
  created_at: string;
};

export type PolicyRow = {
  id: string;
  source: string;
  external_id: string;
  client_id: string;
  responsible_name: string | null;
  assigned_user_id: string | null;
  store_id: string | null;
  policy_number: string;
  company_external_id: string | null;
  company_name: string | null;
  product_external_id: string | null;
  product_name: string | null;
  line_external_id: string | null;
  line_name: string | null;
  issue_date: string | null;
  start_date: string | null;
  end_date: string | null;
  renew_date: string | null;
  premium: number | null;
  fraction_type: number | null;
  status: number | null;
  last_synced_at: string;
  created_at: string;
};

export type ProfileRow = {
  id: string;
  full_name: string;
  store_id: string | null;
};

export type PortfolioClient = {
  client: ClientRow;
  policies: PolicyRow[];

  opportunity:
    ClientOpportunitySummary;
};

export type PortfolioSearchRow = {
  client_id: string;
  latest_issue_date: string | null;
  total_count: number;
};

export const CLIENTS_PAGE_SIZE = 20;

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