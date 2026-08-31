import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, ChevronRight } from "lucide-react";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";

import { getCompaniesOverview } from "@/app/(dashboard)/carteira/action";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

export default async function CarteiraPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  const companies = await getCompaniesOverview();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-[#ff4b0a]">Carteira</p>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
          Carteira por Companhia
        </h1>

        <p className="mt-1 text-sm text-[#737a84]">
          Escolhe uma companhia para veres o detalhe por loja e por produto.
        </p>
      </div>

      {companies.length === 0 ? (
        <div className="rounded-2xl border border-[#e5e8ec] bg-white p-8 text-center text-sm text-[#7d848e]">
          Ainda não existem companhias com carteira ativa.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {companies.map((company) => (
            <Link
              key={company.id}
              href={`/carteira/${company.code}`}
              className="group flex flex-col justify-between rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)] transition hover:border-[#ff4b0a]/30 hover:shadow-[0_4px_14px_rgba(20,25,35,0.08)]"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50">
                  <Building2 className="h-5 w-5 text-[#ff4b0a]" />
                </div>

                <ChevronRight className="h-5 w-5 text-[#a0a5ac] transition group-hover:translate-x-0.5 group-hover:text-[#ff4b0a]" />
              </div>

              <div className="mt-4">
                <h2 className="font-semibold text-[#20242a]">
                  {company.name}
                </h2>

                <p className="mt-1 text-xs text-[#8a9099]">
                  {company.totalCount} apólices ativas
                </p>
              </div>

              <div className="mt-4 rounded-xl bg-[#fafbfc] px-3 py-2.5">
                <p className="text-[11px] text-[#8a9099]">
                  Carteira anualizada
                </p>

                <p className="mt-0.5 text-lg font-semibold text-[#20242a]">
                  {formatCurrency(company.totalAnualizado)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}