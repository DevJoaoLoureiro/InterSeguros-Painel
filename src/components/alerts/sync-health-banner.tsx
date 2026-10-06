import { CloudOff } from "lucide-react";

import { describeSyncAge, getSyncProblems } from "@/lib/alerts/sync-health";

/*
 * Faixa do dashboard (só OWNER/ADMIN): a sincronização com uma
 * companhia está parada. Server Component: lê da cache partilhada
 * com o sino.
 */
export async function SyncHealthBanner() {
  const problems = await getSyncProblems();

  if (problems.length === 0) return null;

  return (
    <section className="rounded-2xl border border-red-200 bg-red-50/60 p-4 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
      <div className="flex items-center gap-2">
        <CloudOff className="h-4 w-4 text-red-600" />
        <h2 className="text-sm font-semibold text-[#20242a]">
          Sincronização parada
        </h2>
      </div>

      <ul className="mt-2 space-y-2">
        {problems.map((problem) => (
          <li key={problem.companyCode} className="text-sm text-[#40464f]">
            <span className="font-semibold text-[#20242a]">
              {problem.companyName}
            </span>{" "}
            — {problem.resources.join(" e ")} {describeSyncAge(problem)}.
            {problem.lastError && (
              <p className="mt-0.5 break-words text-xs text-[#737a84]">
                Último erro: {problem.lastError}
              </p>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-2 text-xs text-[#737a84]">
        Os dados desta companhia (apólices, recibos, vencimentos) podem
        estar desatualizados até a sincronização voltar a funcionar.
      </p>
    </section>
  );
}
