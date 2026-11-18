import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { getAccessibleStores } from "@/app/(dashboard)/faturacao/zurich/actions";
import {
  getGeneraliCommissionsDetail,
  getGeneraliCommissionsSummaryByStore,
} from "@/app/(dashboard)/faturacao/generali/actions";
import { CommissionsBoard } from "@/components/faturacao/commissions-board";

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default async function ComissoesGeneraliPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  const { stores } = await getAccessibleStores();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-[#ff4b0a]">
          Carteira · Faturação
        </p>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
          Generali
        </h1>

        <p className="mt-1 text-sm text-[#737a84]">
          Comissões de cobrança e mediação por loja.
        </p>
      </div>

      <CommissionsBoard
        stores={stores}
        initialMonth={getCurrentMonth()}
        loadSummary={getGeneraliCommissionsSummaryByStore}
        loadDetail={getGeneraliCommissionsDetail}
        footnote={
          <>
            Valores da API da Generali: comissão de mediação (na coluna
            Angariação) + comissão de cobrança de cada recibo pago, pelo mês
            de pagamento. Os estornos pagos entram a descontar.
          </>
        }
      />
    </div>
  );
}
