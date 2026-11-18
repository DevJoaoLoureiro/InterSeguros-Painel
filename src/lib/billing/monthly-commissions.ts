import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Comissões por mês de uma companhia, somadas na BD (função
 * get_monthly_commissions). Formato do Mapa de comissões
 * (faturacao/mapa). SEM verificação de acesso: quem chama já fez
 * requireAdmin().
 */

export type MonthlyCommissions = {
  month: string;
  // Vida inclui os Financeiros (ramo Vida).
  vida: { amount: number; receipts: number };
  naoVida: { amount: number; receipts: number };
  stampDuty: { amount: number; official: boolean };
};

type Row = {
  month: string;
  plan_type: string | null;
  amount: number | string;
  receipts: number | string;
  stamp: number | string;
  stamp_missing: number | string;
  amount_without_stamp: number | string;
};

const round = (value: number) => Math.round(value * 100) / 100;

export async function getMonthlyCommissionsFromDb({
  companyCode,
  year,
  paidStatusOnly,
  estimateRate,
}: {
  companyCode: string;
  year: number;
  /** true: só recibos com status PAID; false: qualquer um com data de pagamento. */
  paidStatusOnly: boolean;
  /** Selo estimado sobre o Não Vida dos recibos sem selo oficial. */
  estimateRate: number;
}): Promise<MonthlyCommissions[]> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("get_monthly_commissions", {
    p_company_code: companyCode,
    p_from: `${year}-01-01`,
    p_to: `${year + 1}-01-01`,
    p_paid_status_only: paidStatusOnly,
  });

  if (error) {
    throw new Error(`Erro ao somar comissões ${companyCode}: ${error.message}`);
  }

  type Totals = {
    vida: { amount: number; receipts: number };
    naoVida: { amount: number; receipts: number };
    stamp: number;
    missing: number;
  };
  const byMonth = new Map<string, Totals>();

  for (const row of (data ?? []) as Row[]) {
    const current = byMonth.get(row.month) ?? {
      vida: { amount: 0, receipts: 0 },
      naoVida: { amount: 0, receipts: 0 },
      stamp: 0,
      missing: 0,
    };

    const nonLife = row.plan_type === "NAO_VIDA";
    const bucket = nonLife ? current.naoVida : current.vida;
    bucket.amount += Number(row.amount);
    bucket.receipts += Number(row.receipts);

    current.stamp += Number(row.stamp);
    current.missing += Number(row.stamp_missing);
    if (nonLife) current.stamp += Number(row.amount_without_stamp) * estimateRate;

    byMonth.set(row.month, current);
  }

  return Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, "0")}`;
    const current = byMonth.get(month);

    return {
      month,
      vida: {
        amount: round(current?.vida.amount ?? 0),
        receipts: current?.vida.receipts ?? 0,
      },
      naoVida: {
        amount: round(current?.naoVida.amount ?? 0),
        receipts: current?.naoVida.receipts ?? 0,
      },
      stampDuty: {
        amount: round(current?.stamp ?? 0),
        // Oficial só quando todos os recibos do mês trazem o selo.
        official: current ? current.missing === 0 : false,
      },
    };
  });
}
