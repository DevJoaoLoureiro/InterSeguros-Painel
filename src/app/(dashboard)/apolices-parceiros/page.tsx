import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";

import { getPartnerSubmissions } from "./actions";
import { PartnerSubmissionsBoard } from "./submissions-board";

export default async function ApolicesParceirosPage() {
  if (!(await getCurrentProfile())) {
    redirect("/login");
  }

  const { rows, isAdmin, currentUserId } = await getPartnerSubmissions();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[#17191d]">
          Apólices de Parceiros
        </h1>
        <p className="mt-1 text-sm text-[#737a84]">
          Apólices enviadas pelos parceiros através do link de cada um
          (Configurações → Parceiros).
          {isAdmin ? "" : " Aqui aparecem as que foram enviadas para ti."}
        </p>
      </div>

      <PartnerSubmissionsBoard
        rows={rows}
        isAdmin={isAdmin}
        currentUserId={currentUserId}
      />
    </div>
  );
}
