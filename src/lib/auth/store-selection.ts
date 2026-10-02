import { cache } from "react";
import { cookies } from "next/headers";

import { getCachedStores } from "@/lib/cache/reference-data";

/*
 * Loja escolhida no seletor do topo — um FILTRO, igual para todos.
 *
 * Não há restrição por loja: qualquer utilizador pode ver qualquer
 * loja (se um colega está de férias, outro trata dos clientes dele).
 * O que cada um pode ver é decidido pela FUNÇÃO (lib/auth/permissions).
 *
 * Devolve "all" ou o id de uma loja que existe.
 */
export const getSelectedStoreId = cache(async (): Promise<string> => {
  const cookieStore = await cookies();
  const value = cookieStore.get("selected_store_id")?.value ?? "all";

  if (value === "all") return "all";

  const stores = await getCachedStores();
  return stores.some((store) => store.id === value) ? value : "all";
});

/* Igual, mas com null em vez de "all" (para filtros de consultas). */
export async function getSelectedStoreFilter(): Promise<string | null> {
  const selected = await getSelectedStoreId();
  return selected === "all" ? null : selected;
}
