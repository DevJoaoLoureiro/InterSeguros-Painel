/*
 * Separadores de Vencimentos no URL (?tab=...), para o sino, o
 * dashboard e os cartões de resumo abrirem diretamente o certo.
 */

export type VencimentosTab = "renewals" | "receipts" | "switches";

export const VENCIMENTOS_TAB_PARAM: Record<VencimentosTab, string> = {
  renewals: "renovacoes",
  receipts: "recibos",
  switches: "anuladas",
};

export function vencimentosHref(tab: VencimentosTab) {
  return `/vencimentos?tab=${VENCIMENTOS_TAB_PARAM[tab]}`;
}

export function tabFromParam(value: string | null | undefined): VencimentosTab {
  const match = (Object.keys(VENCIMENTOS_TAB_PARAM) as VencimentosTab[]).find(
    (key) => VENCIMENTOS_TAB_PARAM[key] === value,
  );
  return match ?? "renewals";
}
