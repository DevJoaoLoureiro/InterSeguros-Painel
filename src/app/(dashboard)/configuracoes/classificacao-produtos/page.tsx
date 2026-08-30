import Link from "next/link";
import { Tags } from "lucide-react";

import {
  getCompanies,
  getInsuranceLineOptions,
  getUnclassifiedProducts,
} from "./action";

import { ProductClassificationRow } from "./product-classification-row";

export default async function ClassificacaoProdutosPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const { company: companyParam } = await searchParams;

  const companies = await getCompanies();

  const selectedCompany =
    companies.find((c) => c.code === companyParam) ??
    companies[0] ??
    null;

  const [products, lineOptions] = selectedCompany
    ? await Promise.all([
        getUnclassifiedProducts(selectedCompany.code),
        getInsuranceLineOptions(),
      ])
    : [[], await getInsuranceLineOptions()];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-[#ff4b0a]">
          Configurações
        </p>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
          Classificação de produtos
        </h1>

        <p className="mt-1 max-w-2xl text-sm text-[#737a84]">
          Produtos que ainda não têm ramo atribuído (Vida, Não Vida
          ou Financeiros). Enquanto não forem classificados, não
          contam para nenhuma categoria no dashboard.
        </p>
      </div>

      {/* SELETOR DE COMPANHIA */}

      {companies.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {companies.map((company) => {
            const isActive =
              company.id === selectedCompany?.id;

            return (
              <Link
                key={company.id}
                href={`/configuracoes/classificacao-produtos?company=${company.code}`}
                className={[
                  "rounded-xl border px-4 py-2 text-sm font-medium transition",
                  isActive
                    ? "border-[#ff4b0a] bg-[#ff4b0a] text-white"
                    : "border-[#e5e8ec] bg-white text-[#606771] hover:border-[#ff4b0a]/40",
                ].join(" ")}
              >
                {company.name}
              </Link>
            );
          })}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        <div className="flex items-center justify-between border-b border-[#edf0f2] px-5 py-4">
          <div>
            <h2 className="font-semibold text-[#20242a]">
              Produtos por classificar
              {selectedCompany ? ` — ${selectedCompany.name}` : ""}
            </h2>

            <p className="mt-1 text-sm text-[#7d848e]">
              {products.length} produto(s) sem ramo atribuído.
            </p>
          </div>

          <Tags className="h-5 w-5 text-[#a0a5ac]" />
        </div>

        {!selectedCompany ? (
          <div className="px-5 py-16 text-center text-sm text-[#7d848e]">
            Ainda não existem companhias configuradas.
          </div>
        ) : products.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-green-50">
              <Tags className="h-6 w-6 text-green-600" />
            </div>

            <h3 className="mt-4 font-semibold text-[#20242a]">
              Tudo classificado
            </h3>

            <p className="mt-1 text-sm text-[#7d848e]">
              Todos os produtos de {selectedCompany.name} já têm
              ramo atribuído.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-left">
              <thead className="bg-[#fafbfc]">
                <tr className="text-xs font-medium uppercase tracking-wide text-[#8a9099]">
                  <th className="px-5 py-3">Código</th>
                  <th className="px-5 py-3">Produto</th>
                  <th className="px-5 py-3">Apólices</th>
                  <th className="px-5 py-3">Ramo</th>
                  <th className="px-5 py-3 text-right">Ação</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[#edf0f2]">
                {products.map((product) => (
                  <ProductClassificationRow
                    key={product.productCode}
                    companyCode={selectedCompany.code}
                    product={product}
                    lineOptions={lineOptions}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}