import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { getSelectedStoreId } from "@/lib/auth/store-selection";

import { getTasksData } from "./action";
import { TasksBoard } from "./tasks-board";

export default async function TarefasPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  // Loja = filtro do seletor do topo, igual para todos.
  const selectedStoreId = await getSelectedStoreId();

  const { tasks, profiles, insuranceLines, privileged, currentProfileId } =
    await getTasksData({ selectedStoreId });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-[#ff4b0a]">
          Atividades
        </p>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
          Tarefas
        </h1>

        <p className="mt-1 text-sm text-[#737a84]">
          Tarefas, follow-ups e processos de simulação da equipa.
        </p>
      </div>

      <TasksBoard
        initialTasks={tasks}
        profiles={profiles}
        insuranceLines={insuranceLines}
        privileged={privileged}
        currentProfileId={currentProfileId}
      />
    </div>
  );
}