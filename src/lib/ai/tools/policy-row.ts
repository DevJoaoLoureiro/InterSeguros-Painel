/*
 * Linha de `policies` como as ferramentas da IA a pedem ao Supabase.
 * Cada ferramenta escolhe só algumas colunas, por isso usa um Pick.
 */

// O Supabase devolve as relações como objeto ou como lista.
export type Relation<T> = T | T[] | null;

export type AiPolicyRow = {
  id: string;
  client_id: string | null;
  policy_number: string;
  product_name: string | null;
  issue_date: string | null;
  start_date: string | null;
  end_date: string | null;
  renewal_date: string | null;
  annualized_premium: number | string | null;
  payment_frequency: string | null;
  status: string;
  commercial_user_id: string | null;
  issuing_store_id: string | null;
  company: Relation<{ name: string }>;
  insurance_line: Relation<{ name: string }>;
  commercial_user: Relation<{ full_name: string }>;
};
