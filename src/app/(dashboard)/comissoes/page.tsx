import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";

export default async function ComissoesPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-[#ff4b0a]">Carteira</p>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
          Comissões
        </h1>

        <p className="mt-1 text-sm text-[#737a84]">
          Escolha a companhia para consultar as comissões e os respetivos
          fechos.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Link
          href="/comissoes/prevoir"
          className="group rounded-2xl border border-[#e6e8eb] bg-white p-5 transition hover:border-[#ff4b0a] hover:shadow-sm"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-lg font-semibold text-[#17191d]">
                Prévoir
              </p>

              <p className="mt-1 text-sm text-[#737a84]">
                Comissões, movimentos e fechos oficiais.
              </p>
            </div>

            <span className="rounded-full bg-[#fff1eb] px-3 py-1 text-xs font-medium text-[#ff4b0a]">
              Disponível
            </span>
          </div>

          <p className="mt-6 text-sm font-medium text-[#ff4b0a]">
            Abrir comissões →
          </p>
        </Link>

        <div className="rounded-2xl border border-[#e6e8eb] bg-white p-5 opacity-70">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-lg font-semibold text-[#17191d]">
                Generali
              </p>

              <p className="mt-1 text-sm text-[#737a84]">
                Comissões e reconciliação da Generali.
              </p>
            </div>

            <span className="rounded-full bg-[#f3f4f6] px-3 py-1 text-xs font-medium text-[#737a84]">
              Em breve
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}