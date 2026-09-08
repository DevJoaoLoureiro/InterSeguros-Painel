import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { getAccessibleStores } from "@/app/(dashboard)/comissoes/zurich/actions";
import { ComissoesBoardZurich } from "@/app/(dashboard)/comissoes/zurich/comissoes-board";

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

  const { stores, canAccessAll } = await getAccessibleStores();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-[#ff4b0a]">
          Carteira · Comissões
        </p>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
          Zurich
        </h1>

        <p className="mt-1 text-sm text-[#737a84]">
          Comissões de cobrança e angariação por loja.
        </p>
      </div>

      <ComissoesBoardZurich
        stores={stores}
        canAccessAll={canAccessAll}
        initialMonth={getCurrentMonth()}
      />
    </div>
  );
}