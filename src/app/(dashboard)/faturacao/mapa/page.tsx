import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPrevoirMonthlyCommissions } from "@/app/(dashboard)/faturacao/prevoir/actions";
import { getZurichMonthlyCommissions } from "@/app/(dashboard)/faturacao/zurich/actions";
import {
  MapaComissoesBoard,
  type CommissionFilter,
  type CompanyRow,
  type MonthCell,
} from "./mapa-board";

/* Sem sync há mais do que isto, os meses seguintes não são fiáveis. */
const STALE_SYNC_HOURS = 36;

function lisbonMonthKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
  }).format(date);
}

/* Último sync de recibos Zurich bem-sucedido e se já está "parado". */
async function getZurichSyncState(): Promise<{
  lastSync: string | null;
  stale: boolean;
}> {
  const lastSync = await getLastZurichSync();

  return {
    lastSync,
    stale:
      !lastSync ||
      Date.now() - Date.parse(lastSync) > STALE_SYNC_HOURS * 3_600_000,
  };
}

async function getLastZurichSync(): Promise<string | null> {
  const admin = createAdminClient();

  const { data: company } = await admin
    .from("companies")
    .select("id")
    .eq("code", "ZURICH")
    .maybeSingle();

  if (!company) return null;

  const { data } = await admin
    .from("integration_sync_runs")
    .select("finished_at")
    .eq("company_id", company.id)
    .eq("resource_type", "RECEIPTS")
    .eq("status", "SUCCESS")
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.finished_at ?? null;
}

export default async function MapaComissoesPage({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string }>;
}) {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  const currentMonth = lisbonMonthKey();
  const currentYear = Number(currentMonth.slice(0, 4));
  const requested = Number((await searchParams).ano);
  const year =
    Number.isInteger(requested) && requested >= 2024 && requested <= currentYear
      ? requested
      : currentYear;

  const [prevoir, zurich, zurichSync] = await Promise.all([
    getPrevoirMonthlyCommissions(year),
    getZurichMonthlyCommissions(year),
    getZurichSyncState(),
  ]);

  const { lastSync: lastZurichSync, stale: zurichStale } = zurichSync;
  const lastZurichMonth = lastZurichSync
    ? lisbonMonthKey(new Date(lastZurichSync))
    : null;

  type Split = { amount: number; receipts: number };
  type MonthSplits = {
    vida: Split;
    naoVida: Split;
    stampDuty: { amount: number; official: boolean };
  };

  /*
   * O estado da célula (oficial, estimativa, sem dados, ...) é do mês
   * inteiro; o filtro só escolhe que valor mostrar. O imposto de selo
   * só existe no Não Vida, por isso no filtro Vida fica vazio.
   */
  function cellsFor(
    kinds: MonthCell["kind"][],
    splits: MonthSplits[],
  ): Record<CommissionFilter, MonthCell[]> {
    const build = (
      pick: (split: MonthSplits) => Split,
      withStampDuty: boolean,
    ) =>
      kinds.map((kind, index): MonthCell => {
        const split = splits[index];
        const value = pick(split);

        if (kind === "future" || kind === "nodata") {
          return {
            amount: null,
            kind,
            receipts: 0,
            stampDuty: null,
            stampDutyOfficial: false,
          };
        }

        return {
          amount: value.amount,
          kind,
          receipts: value.receipts,
          stampDuty: withStampDuty ? split.stampDuty.amount : null,
          stampDutyOfficial: withStampDuty && split.stampDuty.official,
        };
      });

    return {
      todos: build(
        (split) => ({
          amount:
            Math.round((split.vida.amount + split.naoVida.amount) * 100) / 100,
          receipts: split.vida.receipts + split.naoVida.receipts,
        }),
        true,
      ),
      vida: build((split) => split.vida, false),
      naoVida: build((split) => split.naoVida, true),
    };
  }

  const prevoirKinds = prevoir.map<MonthCell["kind"]>((item) => {
    if (item.month > currentMonth) return "future";
    if (item.source === "official") return "official";
    if (item.vida.receipts + item.naoVida.receipts === 0) return "nodata";
    return "estimate";
  });

  const zurichKinds = zurich.map<MonthCell["kind"]>((item) => {
    if (item.month > currentMonth) return "future";
    // Sync parado: depois do mês do último sync não há dados.
    if (zurichStale && lastZurichMonth && item.month > lastZurichMonth) {
      return "nodata";
    }
    if (
      item.month === currentMonth ||
      (zurichStale && item.month === lastZurichMonth)
    ) {
      return "partial";
    }
    return "actual";
  });

  const rows: CompanyRow[] = [
    {
      company: "Zurich",
      color: "#ff4b0a",
      months: cellsFor(zurichKinds, zurich),
    },
    {
      company: "Prévoir",
      color: "#4a6fd1",
      months: cellsFor(prevoirKinds, prevoir),
    },
  ];

  return (
    <MapaComissoesBoard
      year={year}
      currentYear={currentYear}
      currentMonthIndex={
        year === currentYear ? Number(currentMonth.slice(5, 7)) - 1 : 11
      }
      rows={rows}
      zurichStaleSince={zurichStale ? lastZurichSync : null}
    />
  );
}
