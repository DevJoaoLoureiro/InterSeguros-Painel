import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";

import { getAccessibleStores } from "../actions";
import { ComissoesBoard } from "./comissoes-board";

function getCurrentMonth() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

export default async function PrevoirComissoesPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  const { stores, canAccessAll } = await getAccessibleStores();

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/comissoes"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#7d848e] transition hover:text-[#ff4b0a]"
        >
          <ArrowLeft className="h-4 w-4" />
          Comissões
        </Link>

        <div className="mt-4">
          <p className="text-sm font-medium text-[#ff4b0a]">Prévoir</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
            Comissões
          </h1>
          <p className="mt-1 text-sm text-[#737a84]">
            Estimativa mensal e fecho oficial.
          </p>
        </div>
      </div>

      <ComissoesBoard
        stores={stores}
        canAccessAll={canAccessAll}
        initialMonth={getCurrentMonth()}
      />
    </div>
  );
}
