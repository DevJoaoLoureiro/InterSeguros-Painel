import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  RefreshCw,
  UserX,
} from "lucide-react";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { getSelectedStoreFilter } from "@/lib/auth/store-selection";
import { getVencimentosSnapshot } from "@/lib/alerts/expiry-alerts";
import { vencimentosHref } from "@/lib/vencimentos/tabs";

import { getLikelySwitches } from "./action";

import { VencimentosBoard } from "@/components/vencimentos/vencimentos-board";
import { VencimentosRecibosHeader } from "@/components/vencimentos/section-tabs";

export default async function VencimentosPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  // Loja = filtro do seletor do topo, igual para todos.
  const storeId = await getSelectedStoreFilter();

  // Renovações e recibos: a mesma cache que o layout já usa nos alertas
  // (no mesmo pedido não se calcula duas vezes; os crons invalidam-na).
  // As anuladas percorrem todas as apólices e recibos: não se espera
  // por elas. Renovações e recibos aparecem logo; as anuladas entram
  // quando estiverem prontas (Suspense abaixo).
  const switchesPromise = getLikelySwitches({ storeId });
  const { renewals, receipts: upcomingReceipts } =
    await getVencimentosSnapshot(storeId);

  const overdueRenewals = renewals.filter((r) => r.overdue).length;
  const overdueReceipts = upcomingReceipts.filter((r) => r.overdue).length;

  return (
    <div className="space-y-6">
      <VencimentosRecibosHeader
        current="todo"
        description="Apólices a renovar e recibos a vencer nos próximos 30 dias (incluindo os atrasados), e apólices anuladas ou não renovadas para tentar recuperar o cliente."
      />

      {/* CARDS RESUMO */}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard
          label="Renovações"
          value={renewals.length}
          icon={<RefreshCw className="h-5 w-5" />}
          href={vencimentosHref("renewals")}
        />

        <SummaryCard
          label="Renovações em atraso"
          value={overdueRenewals}
          icon={<AlertTriangle className="h-5 w-5" />}
          alert={overdueRenewals > 0}
          href={vencimentosHref("renewals")}
        />

        <SummaryCard
          label="Recibos a vencer"
          value={upcomingReceipts.length}
          icon={<CalendarClock className="h-5 w-5" />}
          href={vencimentosHref("receipts")}
        />

        <SummaryCard
          label="Recibos em atraso"
          value={overdueReceipts}
          icon={<AlertTriangle className="h-5 w-5" />}
          alert={overdueReceipts > 0}
          href={vencimentosHref("receipts")}
        />

        <Suspense
          fallback={
            <SummaryCard
              label="Anuladas"
              value={null}
              icon={<UserX className="h-5 w-5" />}
              href={vencimentosHref("switches")}
            />
          }
        >
          <SwitchesCard switches={switchesPromise} />
        </Suspense>
      </section>

      <Suspense
        fallback={
          <VencimentosBoard
            renewals={renewals}
            upcomingReceipts={upcomingReceipts}
            likelySwitches={null}
          />
        }
      >
        <BoardWithSwitches
          renewals={renewals}
          upcomingReceipts={upcomingReceipts}
          switches={switchesPromise}
        />
      </Suspense>
    </div>
  );
}

type Switches = Awaited<ReturnType<typeof getLikelySwitches>>;

async function SwitchesCard({ switches }: { switches: Promise<Switches> }) {
  const rows = await switches;

  return (
    <SummaryCard
      label="Anuladas"
      value={rows.length}
      icon={<UserX className="h-5 w-5" />}
      alert={rows.length > 0}
      href={vencimentosHref("switches")}
    />
  );
}

async function BoardWithSwitches({
  renewals,
  upcomingReceipts,
  switches,
}: {
  renewals: React.ComponentProps<typeof VencimentosBoard>["renewals"];
  upcomingReceipts: React.ComponentProps<
    typeof VencimentosBoard
  >["upcomingReceipts"];
  switches: Promise<Switches>;
}) {
  return (
    <VencimentosBoard
      renewals={renewals}
      upcomingReceipts={upcomingReceipts}
      likelySwitches={await switches}
    />
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
  href,
}: {
  label: string;
  // null = ainda a carregar.
  value: number | null;
  icon: React.ReactNode;
  alert?: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)] transition hover:border-[#ff4b0a]/40 hover:shadow-[0_6px_18px_rgba(20,25,35,0.08)]"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-[#737a84]">{label}</p>

        <div
          className={[
            "flex h-10 w-10 items-center justify-center rounded-xl",
            alert && value !== null && value > 0
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
          alert && value !== null && value > 0
            ? "text-red-600"
            : "text-[#17191d]",
        ].join(" ")}
      >
        {value ?? "…"}
      </p>
    </Link>
  );
}