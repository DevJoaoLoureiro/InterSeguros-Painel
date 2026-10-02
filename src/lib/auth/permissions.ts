/*
 * Permissões por FUNÇÃO (não por loja).
 *
 * - OWNER e ADMIN veem tudo.
 * - Funcionários (GESTOR_LOJA, COMERCIAL, ...) veem, de TODAS as lojas
 *   (se um colega está de férias, outro trata dos clientes dele):
 *     Dashboard, Clientes, Recibos, Vencimentos e as Atividades
 *     (Tarefas, Oportunidades, Simulador, Conversas).
 *   NÃO veem: Comissões, Carteira por loja, Estatísticas, Leads e a
 *   secção Gestão (Lojas, Utilizadores, Configurações).
 *
 * Usado no proxy (bloqueio de páginas pelo URL) e na sidebar (o que
 * aparece no menu). Sem imports de servidor: corre em qualquer lado.
 */

export const FULL_ACCESS_ROLES = ["OWNER", "ADMIN"] as const;

export const EMPLOYEE_PAGES = [
  "/dashboard",
  "/clientes",
  "/recibos",
  "/vencimentos",
  "/tarefas",
  "/oportunidades",
  "/simulador",
  "/conversas",
] as const;

/* Para onde vai um funcionário que abre uma página que não pode ver. */
export const EMPLOYEE_HOME = "/dashboard";

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
