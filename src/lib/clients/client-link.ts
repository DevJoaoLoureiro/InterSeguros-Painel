/*
 * Link para a página de Clientes com o painel lateral de um cliente
 * já aberto. A página lê ?cliente=<id> (ver clientes/page.tsx).
 */
export function clientHref(clientId: string) {
  return `/clientes?cliente=${encodeURIComponent(clientId)}`;
}
