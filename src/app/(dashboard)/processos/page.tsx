import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { getSelectedStoreId } from "@/lib/auth/store-selection";

import { getTasksData } from "@/app/(dashboard)/tarefas/action";

import { ProcessesBoard } from "./processes-board";

export default async function ProcessosPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  // Loja = filtro do seletor do topo, igual para todos.
  const selectedStoreId = await getSelectedStoreId();

  const { tasks, profiles, insuranceLines, privileged, currentProfileId } =
    await getTasksData({ selectedStoreId, kind: "PROCESS" });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-[#ff4b0a]">Atividades</p>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
          Processos
        </h1>

        <p className="mt-1 text-sm text-[#737a84]">
          Simulações e renegociações, da proposta ao recibo pago — ou ao
          motivo por que não foram emitidas.
        </p>
      </div>

      <ProcessesBoard
        initialProcesses={tasks}
        profiles={profiles}
        insuranceLines={insuranceLines}
        privileged={privileged}
        currentProfileId={currentProfileId}
      />
    </div>
  );
}
