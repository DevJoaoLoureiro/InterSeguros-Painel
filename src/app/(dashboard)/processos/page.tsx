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

      <ProcessesBoard
        initialProcesses={tasks}
        profiles={profiles}
        insuranceLines={insuranceLines}
        privileged={privileged}
        currentProfileId={currentProfileId}
        messageTemplates={messageTemplates}
        companyNames={companies.map((company) => company.name)}
        initialOpenId={typeof abrir === "string" ? abrir : null}
      />
    </div>
  );
}
