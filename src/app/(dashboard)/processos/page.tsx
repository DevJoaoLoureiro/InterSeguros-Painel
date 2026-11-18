import { Suspense } from "react";
import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { getSelectedStoreId } from "@/lib/auth/store-selection";

import { getTasksData } from "@/app/(dashboard)/tarefas/action";
import { getCachedCompanies } from "@/lib/cache/reference-data";
import { loadMessageTemplates } from "@/lib/tasks/message-templates";

import { ProcessesBoard } from "./processes-board";

export default async function ProcessosPage({
  searchParams,
}: {
  searchParams: Promise<{ abrir?: string }>;
}) {
  const profile = await getCurrentProfile();
  // ?abrir=<id> (vindo de "O meu dia"): abre o detalhe desse processo.
  const { abrir } = await searchParams;

  if (!profile) {
    redirect("/login");
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-[#ff4b0a]">Atividades</p>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
          Processos
        </h1>

        <p className="mt-1 text-sm text-[#737a84]">
          Cada cartão mostra o próximo passo: simular, esperar pelo
          cliente, esperar pelo pagamento — até o negócio fechar.
        </p>
      </div>

      {/* O título aparece logo; o quadro entra quando os dados chegam
          (sem isto a 1.ª visita ficava em branco ~1,5 s). */}
      <Suspense fallback={<BoardSkeleton />}>
        <ProcessesData initialOpenId={typeof abrir === "string" ? abrir : null} />
      </Suspense>
    </div>
  );
}

async function ProcessesData({
  initialOpenId,
}: {
  initialOpenId: string | null;
}) {
  // Loja = filtro do seletor do topo, igual para todos.
  const selectedStoreId = await getSelectedStoreId();

  const [
    { tasks, profiles, insuranceLines, privileged, currentProfileId },
    messageTemplates,
    companies,
  ] = await Promise.all([
    getTasksData({ selectedStoreId, kind: "PROCESS" }),
    loadMessageTemplates(),
    getCachedCompanies(),
  ]);

  return (
    <ProcessesBoard
      initialProcesses={tasks}
      profiles={profiles}
      insuranceLines={insuranceLines}
      privileged={privileged}
      currentProfileId={currentProfileId}
      messageTemplates={messageTemplates}
      companyNames={companies.map((company) => company.name)}
      initialOpenId={initialOpenId}
    />
  );
}

function BoardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="A carregar">
      <div className="skeleton h-10 w-full max-w-xl rounded-xl" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((column) => (
          <div
            key={column}
            className="space-y-3 rounded-2xl border border-[#e5e8ec] bg-white p-4"
          >
            <div className="skeleton h-5 w-32 rounded-md" />
            <div className="skeleton h-24 w-full rounded-xl" />
            <div className="skeleton h-24 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
