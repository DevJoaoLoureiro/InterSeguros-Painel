/*
 * Envolve cada página do painel. Ao contrário do layout, o template é
 * recriado em cada navegação, por isso a página nova entra sempre com
 * uma transição suave.
 *
 * Só opacidade, de propósito: uma animação de transform neste
 * invólucro prendia os painéis laterais (position: fixed) à área da
 * página — o painel do cliente aparecia cortado.
 */
export default function DashboardTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="animate-fade-in">{children}</div>;
}
