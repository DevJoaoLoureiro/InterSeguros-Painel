/*
 * Mostrado de imediato ao mudar de página, enquanto os dados da
 * página nova carregam: o menu responde logo ao clique em vez de a
 * página antiga ficar parada.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="A carregar">
      <div className="space-y-2">
        <div className="skeleton h-4 w-24 rounded-md" />
        <div className="skeleton h-8 w-56 rounded-lg" />
        <div className="skeleton h-4 w-80 max-w-full rounded-md" />
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div
            key={item}
            className="rounded-2xl border border-[#e5e8ec] bg-white p-5"
          >
            <div className="skeleton h-4 w-24 rounded-md" />
            <div className="skeleton mt-4 h-8 w-20 rounded-lg" />
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-[#e5e8ec] bg-white p-5">
        <div className="skeleton h-5 w-40 rounded-md" />

        <div className="mt-5 space-y-3">
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <div key={item} className="skeleton h-11 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
