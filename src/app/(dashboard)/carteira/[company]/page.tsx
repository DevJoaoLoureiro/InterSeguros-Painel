import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  getAccessibleStores,
  getStorePortfolio,
} from "@/app/(dashboard)/carteira/action";

import { CarteiraBoard } from "@/components/carteira/carteira-board";

export default async function CarteiraCompanyPage({
  params,
}: {
  params: Promise<{ company: string }>;
}) {
  const { company: companyCode } = await params;

  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  const admin = createAdminClient();

  const { data: company, error } = await admin
    .from("companies")
    .select("id, code, name")
    .eq("code", companyCode.toUpperCase())
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao carregar companhia: ${error.message}`);
  }

  if (!company) {
    notFound();
  }

  const { stores, canAccessAll } = await getAccessibleStores();

  const initialPortfolio =
    stores.length > 0
      ? await getStorePortfolio(stores[0].id, company.id)
      : null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/carteira"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#7d848e] transition hover:text-[#59616d]"
        >
          ← Todas as companhias
        </Link>

        <p className="mt-3 text-sm font-medium text-[#ff4b0a]">Carteira</p>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
          {company.name}
        </h1>

        <p className="mt-1 text-sm text-[#737a84]">
          Detalhe da carteira ativa, por plano e por produto, em cada loja.
        </p>
      </div>

      <CarteiraBoard
        stores={stores}
        canAccessAll={canAccessAll}
        initialPortfolio={initialPortfolio}
        companyId={company.id}
      />
    </div>
  );
}