import Link from "next/link";
import { Cable, ChevronRight, Tags } from "lucide-react";

export default function ConfiguracoesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Configurações
        </h1>

        <p className="mt-1 text-sm text-gray-500">
          Gere as configurações e integrações do painel.
        </p>
      </div>

      <section className="space-y-3">
        <Link
          href="/configuracoes/classificacao-produtos"
          className="group flex items-center justify-between rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)] transition hover:border-[#ff4b0a]/30 hover:bg-gray-50"
        >
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-[#ff4b0a]">
              <Tags className="h-5 w-5" />
            </div>

            <div>
              <p className="font-medium text-[#20242a]">
                Classificação de Produtos
              </p>

              <p className="mt-0.5 text-sm text-[#7d848e]">
                Atribuir ramo (Vida / Não Vida / Financeiros) aos
                produtos por classificar.
              </p>
            </div>
          </div>

          <ChevronRight className="h-5 w-5 shrink-0 text-[#a0a5ac] transition group-hover:translate-x-0.5 group-hover:text-[#ff4b0a]" />
        </Link>

        <div className="flex items-center justify-between rounded-2xl border border-dashed border-[#e5e8ec] bg-white/60 p-5 opacity-60">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-400">
              <Cable className="h-5 w-5" />
            </div>

            <div>
              <p className="font-medium text-[#20242a]">
                Integrações
              </p>

              <p className="mt-0.5 text-sm text-[#7d848e]">
                Em breve — gestão de seguradoras ligadas ao CRM.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}