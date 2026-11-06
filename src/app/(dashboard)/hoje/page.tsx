import { redirect } from "next/navigation";

import { getTasksData } from "@/app/(dashboard)/tarefas/action";
import { TodayBoard } from "@/components/hoje/today-board";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { getCachedCompanies } from "@/lib/cache/reference-data";
import { loadMessageTemplates } from "@/lib/tasks/message-templates";
import { getTodayData } from "@/lib/today/get-today";

/*
 * O meu dia — página de entrada. Em cima os meus processos (com o
 * próximo passo à mão), ao lado os lembretes (recibos, renovações,
 * tarefas, leads, conversas). Regras: lib/today/get-today.ts e
 * processAttention() em components/tarefas/utils.ts.
 */

function lisbonHour() {
  const parts = new Intl.DateTimeFormat("pt-PT", {
    timeZone: "Europe/Lisbon",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date());

  return Number(parts.find((part) => part.type === "hour")?.value ?? 12);
}

function greeting() {
  const hour = lisbonHour();
  if (hour < 13) return "Bom dia";
  if (hour < 20) return "Boa tarde";
  return "Boa noite";
}

function todayLabel() {
  const label = new Intl.DateTimeFormat("pt-PT", {
    timeZone: "Europe/Lisbon",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default async function TodayPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  const [today, processesData, messageTemplates, companies] =
    await Promise.all([
      getTodayData(profile),
      // Os meus processos são de qualquer loja: sem filtro de loja.
      getTasksData({ selectedStoreId: "all", kind: "PROCESS" }),
      loadMessageTemplates(),
      getCachedCompanies(),
    ]);

  return (
    <TodayBoard
      greeting={greeting()}
      dateLabel={todayLabel()}
      firstName={profile.full_name.trim().split(/\s+/)[0] ?? ""}
      storeName={today.storeName}
      items={today.items}
      hidden={today.hidden}
      todayKey={today.todayKey}
      week={today.week}
      initialProcesses={processesData.tasks}
      profiles={processesData.profiles}
      insuranceLines={processesData.insuranceLines}
      privileged={processesData.privileged}
      currentProfileId={processesData.currentProfileId}
      messageTemplates={messageTemplates}
      companyNames={companies.map((company) => company.name)}
    />
  );
}
