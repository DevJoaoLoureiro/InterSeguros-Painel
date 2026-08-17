import { MetricCards } from "@/components/dashboard/metric-cards";

export default function DashboardPage() {
  return (
    <div className="space-y-5">
      <MetricCards />

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[1.6fr_1fr]">
        <article className="min-h-[360px] rounded-2xl border border-[#e7e9ec] bg-white p-6 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
          <div>
            <h2 className="text-base font-semibold text-[#20242a]">
              Evolução de Leads
            </h2>
            <p className="mt-1 text-sm text-[#808792]">
              Gráfico será implementado no próximo passo.
            </p>
          </div>

          <div className="mt-8 flex h-[250px] items-center justify-center rounded-xl border border-dashed border-[#d9dde2] bg-[#fafbfc] text-sm text-[#89909a]">
            Área do gráfico
          </div>
        </article>

        <article className="min-h-[360px] rounded-2xl border border-[#e7e9ec] bg-white p-6 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
          <h2 className="text-base font-semibold text-[#20242a]">
            Leads por Tipo de Seguro
          </h2>
          <p className="mt-1 text-sm text-[#808792]">
            Distribuição das novas oportunidades.
          </p>

          <div className="mt-8 flex h-[250px] items-center justify-center rounded-xl border border-dashed border-[#d9dde2] bg-[#fafbfc] text-sm text-[#89909a]">
            Área do gráfico circular
          </div>
        </article>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <article className="min-h-[300px] rounded-2xl border border-[#e7e9ec] bg-white p-6 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
          <h2 className="text-base font-semibold text-[#20242a]">
            Leads Recentes (Chat)
          </h2>

          <div className="mt-5 flex h-[210px] items-center justify-center rounded-xl border border-dashed border-[#d9dde2] bg-[#fafbfc] text-sm text-[#89909a]">
            Tabela de leads
          </div>
        </article>

        <article className="min-h-[300px] rounded-2xl border border-[#e7e9ec] bg-white p-6 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
          <h2 className="text-base font-semibold text-[#20242a]">
            Clientes com Vencimento Próximo
          </h2>

          <div className="mt-5 flex h-[210px] items-center justify-center rounded-xl border border-dashed border-[#d9dde2] bg-[#fafbfc] text-sm text-[#89909a]">
            Tabela de vencimentos
          </div>
        </article>
      </section>
    </div>
  );
}
