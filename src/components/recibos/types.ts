export const RECEIPTS_PAGE_SIZE = 25;

export type ReceiptStatus =
  | "PAID"
  | "PENDING"
  | "RETURNED"
  | "CANCELLED"
  | "UNKNOWN"
  | string;

export type PremiumMode =
  | "commercial"
  | "total";

export type ReceiptCompany = {
  id: string;
  code: string;
  name: string;
};

export type ReceiptStore = {
  id: string;
  name: string;
};

export type ReceiptClient = {
  id: string;
  name: string;
  nif: string | null;
};

export type ReceiptInsuranceLine = {
  id: string;
  code: string;
  name: string;
};

export type ReceiptPolicy = {
  id: string;
  policy_number: string;
  product_code: string | null;
  product_name: string | null;
  issuing_store_id: string | null;

  client: ReceiptClient | null;
  insurance_line: ReceiptInsuranceLine | null;
  issuing_store: ReceiptStore | null;
};

export type ReceiptRow = {
  id: string;
  policy_id: string;
  company_id: string;

  external_id: string | null;
  receipt_number: string | null;
  receipt_type: string | null;

  period_start: string | null;
  period_end: string | null;

  issue_date: string | null;
  due_date: string | null;

  commercial_premium: number | null;
  total_premium: number | null;

  status: ReceiptStatus;

  payment_date: string | null;
  payment_method: string | null;

  situation_date: string | null;

  cancellation_date: string | null;
  cancellation_reason: string | null;

  external_nature: string | null;
  external_payment_method: string | null;

  company: ReceiptCompany | null;
  policy: ReceiptPolicy | null;
};

export type ReceiptStats = {
  paid: {
    count: number;
    commercial: number;
    total: number;
  };

  pending: {
    count: number;
    commercial: number;
    total: number;
  };

  returned: {
    count: number;
    commercial: number;
    total: number;
  };

  reversals: {
    count: number;
    commercial: number;
    total: number;
  };
};

export type ReceiptFilters = {
  search: string;
  from: string;
  to: string;
  company: string;
  status: string;
  page: number;
};

export type ReceiptsPageData = {
  stats: ReceiptStats;

  items: ReceiptRow[];

  page: number;
  totalPages: number;
  totalCount: number;

  companies: ReceiptCompany[];
};