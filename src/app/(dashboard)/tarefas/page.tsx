import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";

import { getTasksData } from "./action";
import { TasksBoard } from "./tasks-board";

export default async function TarefasPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  const cookieStore = await cookies();

  const cookieStoreId =
    cookieStore.get("selected_store_id")?.value ?? "all";

  const canAccessAllStores =
    profile.role === "OWNER" || profile.role === "ADMIN";

  const selectedStoreId = canAccessAllStores
    ? cookieStoreId
    : profile.store?.id ?? null;

  const { tasks, profiles, privileged, currentProfileId } =
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
          Acompanhamento de tarefas e follow-ups da equipa.
        </p>
      </div>

      <TasksBoard
        initialTasks={tasks}
        profiles={profiles}
        privileged={privileged}
        currentProfileId={currentProfileId}
      />
    </div>
  );
}