/*
 * Nome provisório de um cliente cuja ficha a companhia não enviou
 * ("Cliente NIF 123456789"). Partilhado pelos mappers (Zurich,
 * Prévoir), pelo sync e pela lista de clientes.
 */
export const PLACEHOLDER_CLIENT_PREFIX = "Cliente NIF ";

export function isPlaceholderClientName(name: string | null | undefined) {
  return (name ?? "").startsWith(PLACEHOLDER_CLIENT_PREFIX);
}
