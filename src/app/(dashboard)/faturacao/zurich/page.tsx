import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import {
  getAccessibleStores,
  getZurichCommissionsDetail,
  getZurichCommissionsSummaryByStore,
} from "@/app/(dashboard)/faturacao/zurich/actions";
import { CommissionsBoard } from "@/components/faturacao/commissions-board";

function getCurrentMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export default async function ComissoesZurichPage() {
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
          Zurich
        </h1>

        <p className="mt-1 text-sm text-[#737a84]">
          Comissões de cobrança e angariação por loja.
        </p>
      </div>

      <CommissionsBoard
        stores={stores}
        initialMonth={getCurrentMonth()}
        loadSummary={getZurichCommissionsSummaryByStore}
        loadDetail={getZurichCommissionsDetail}
        footnote={
          <>
            A Zurich não envia um fecho oficial em PDF como a Prévoir — estes
            valores vêm diretamente dos campos de comissão de cada recibo
            (Comissão de Cobrança + Comissão de Angariação).
          </>
        }
      />
    </div>
  );
}