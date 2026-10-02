import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";

import { getPartnersData } from "./actions";
import { PartnersBoard } from "./partners-board";

export default async function ParceirosPage() {
  if (!(await getCurrentProfile())) {
    redirect("/login");
  }

  const { partners, isAdmin } = await getPartnersData();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/configuracoes"
          className="inline-flex items-center gap-1 text-sm text-[#7d848e] transition hover:text-[#20242a]"
        >
          <ChevronLeft className="h-4 w-4" />
          Configurações
        </Link>

        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#17191d]">
          Parceiros
        </h1>

        <p className="mt-1 text-sm text-[#737a84]">
          Parceiros externos, empresas e pessoas que podem ser a origem de
          uma apólice. Funcionários não precisam de estar aqui — escolhem-se
          diretamente na apólice.
        </p>
      </div>

      <PartnersBoard partners={partners} isAdmin={isAdmin} />
    </div>
  );
}
