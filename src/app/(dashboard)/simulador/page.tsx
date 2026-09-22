import { redirect } from "next/navigation";

import { SimulatorWorkspace } from "@/components/simulador/simulator-workspace";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";

// O título ("Simulador") vem do cabeçalho do dashboard (PAGE_HEADERS).
export default async function SimuladorPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  return (
    <SimulatorWorkspace allowDemo={process.env.NODE_ENV !== "production"} />
  );
}
