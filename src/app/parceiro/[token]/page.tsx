import type { Metadata } from "next";
import { Link2Off } from "lucide-react";

import {
  getCachedActiveProfiles,
  getCachedCompanies,
  getCachedInsuranceLines,
} from "@/lib/cache/reference-data";
import { getPartnerByToken } from "@/lib/partner-submissions/partner-token";

import { PartnerForm } from "./partner-form";

/*
 * Formulário público de um parceiro (sem login): /parceiro/<token>.
 * O proxy deixa passar /parceiro/* sem sessão.
 */

export const metadata: Metadata = {
  title: "Enviar apólice · Interseguros",
  robots: { index: false, follow: false },
};

export default async function PartnerSubmissionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const partner = await getPartnerByToken(token);

  if (!partner) {
    return (
      <PageShell>
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Link2Off className="h-9 w-9 text-[#c9cdd2]" />
          <h1 className="text-lg font-semibold text-[#20242a]">
            Link inválido
          </h1>
          <p className="max-w-sm text-sm text-[#737a84]">
            Este link já não está ativo. Pede um novo à Interseguros.
          </p>
        </div>
      </PageShell>
    );
  }

  const [profiles, companies, lines] = await Promise.all([
    getCachedActiveProfiles(),
    getCachedCompanies(),
    getCachedInsuranceLines(),
  ]);

  return (
    <PageShell>
      <PartnerForm
        token={token}
        partnerName={partner.name}
        // Só id e nome: é uma página pública.
        users={profiles.map((p) => ({ id: p.id, name: p.full_name }))}
        companies={companies.map((c) => c.name)}
        lines={[
          ...new Set(lines.filter((l) => l.active).map((l) => l.name)),
        ]}
      />
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#f6f4f2] px-4 py-6 sm:py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-5 flex justify-center">
          <img
            src="/interseguroslogo.png"
            alt="Inter Seguros"
            className="h-14 w-auto object-contain"
          />
        </div>

        <div className="overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
          {children}
        </div>
      </div>
    </div>
  );
}
