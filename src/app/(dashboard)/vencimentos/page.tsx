import { redirect } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  RefreshCw,
  UserX,
} from "lucide-react";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { getSelectedStoreId } from "@/lib/auth/store-selection";

import {
  getLikelySwitches,
  getUpcomingReceipts,
  getUpcomingRenewals,
} from "./action";

import { VencimentosBoard } from "@/components/vencimentos/vencimentos-board";

export default async function VencimentosPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  // Loja = filtro do seletor do topo, igual para todos.
  const selectedStoreId = await getSelectedStoreId();

  const [renewals, upcomingReceipts, likelySwitches] = await Promise.all([
    getUpcomingRenewals({ storeId: selectedStoreId }),
    getUpcomingReceipts({ storeId: selectedStoreId }),
    getLikelySwitches({ storeId: selectedStoreId }),
  ]);

  const overdueRenewals = renewals.filter((r) => r.overdue).length;
  const overdueReceipts = upcomingReceipts.filter((r) => r.overdue).length;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-[#ff4b0a]">Carteira</p>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
          Vencimentos
        </h1>

        <p className="mt-1 text-sm text-[#737a84]">
          Apólices a renovar e recibos a vencer nos próximos 30
          dias, incluindo o que já passou o prazo — e as apólices
          anuladas ou não renovadas, para tentar recuperar o cliente.
        </p>
      </div>

      {/* CARDS RESUMO */}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard
          label="Renovações"
          value={renewals.length}
          icon={<RefreshCw className="h-5 w-5" />}
        />

        <SummaryCard
          label="Renovações em atraso"
          value={overdueRenewals}
          icon={<AlertTriangle className="h-5 w-5" />}
          alert={overdueRenewals > 0}
        />

        <SummaryCard
          label="Recibos a vencer"
          value={upcomingReceipts.length}
          icon={<CalendarClock className="h-5 w-5" />}
        />

        <SummaryCard
          label="Recibos em atraso"
          value={overdueReceipts}
          icon={<AlertTriangle className="h-5 w-5" />}
          alert={overdueReceipts > 0}
        />

        <SummaryCard
          label="Anuladas"
          value={likelySwitches.length}
          icon={<UserX className="h-5 w-5" />}
          alert={likelySwitches.length > 0}
        />
      </section>

      <VencimentosBoard
        renewals={renewals}
        upcomingReceipts={upcomingReceipts}
        likelySwitches={likelySwitches}
      />
    </div>
  );
}

// ============================================================
// SUMMARY CARD
// ============================================================

function SummaryCard({
  label,
  value,
  icon,
  alert = false,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  alert?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-[#737a84]">{label}</p>

        <div
          className={[
            "flex h-10 w-10 items-center justify-center rounded-xl",
            alert && value > 0
              ? "bg-red-50 text-red-600"
              : "bg-orange-50 text-[#ff4b0a]",
          ].join(" ")}
        >
          {icon}
        </div>
      </div>

      <p
        className={[
          "mt-4 text-3xl font-semibold tracking-tight",
          alert && value > 0 ? "text-red-600" : "text-[#17191d]",
        ].join(" ")}
      >
        {value}
      </p>
    </div>
  );
}