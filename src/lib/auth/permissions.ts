/*
 * Permissões por FUNÇÃO (não por loja).
 *
 * - OWNER e ADMIN veem tudo.
 * - Funcionários (GESTOR_LOJA, COMERCIAL, ...) só têm acesso a
 *   Tarefas, Oportunidades, Simulador e Conversas — de TODAS as lojas
 *   (se um colega está de férias, outro trata dos clientes dele).
 *
 * Usado no proxy (bloqueio de páginas pelo URL) e na sidebar (o que
 * aparece no menu). Sem imports de servidor: corre em qualquer lado.
 */

export const FULL_ACCESS_ROLES = ["OWNER", "ADMIN"] as const;

export const EMPLOYEE_PAGES = [
  "/tarefas",
  "/oportunidades",
  "/simulador",
  "/conversas",
] as const;

/* Página inicial de quem não é OWNER/ADMIN (não vê o dashboard). */
export const EMPLOYEE_HOME = "/tarefas";

export function hasFullAccess(role: string | null | undefined) {
  return role === "OWNER" || role === "ADMIN";
}

export function canAccessPage(
  role: string | null | undefined,
  pathname: string,
) {
  if (hasFullAccess(role)) return true;

  return EMPLOYEE_PAGES.some(
    (page) => pathname === page || pathname.startsWith(`${page}/`),
  );
}
