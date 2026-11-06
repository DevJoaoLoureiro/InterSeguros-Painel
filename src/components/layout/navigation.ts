import type { ElementType } from "react";
import {
  BarChart3,
  Briefcase,
  Building2,
  CalendarDays,
  Calculator,
  CircleUserRound,
  Coins,
  FileText,
  Gauge,
  Inbox,
  MessageCircle,
  MessagesSquare,
  Settings,
  Sun,
  Target,
  Users,
} from "lucide-react";

/*
 * Menu da aplicação: uma só lista para o menu lateral e para a
 * pesquisa rápida (Ctrl+K). Quem pode ver cada página continua a ser
 * decidido por lib/auth/permissions.
 */

export type MenuItem = {
  label: string;
  href: string;
  icon: ElementType;
  // Palavras extra para a pesquisa rápida encontrar a página.
  keywords?: string;
  // Outras rotas em que o item também fica ativo no menu.
  alsoActiveOn?: string[];
};

export function isMenuItemActive(item: MenuItem, pathname: string) {
  return [item.href, ...(item.alsoActiveOn ?? [])].some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export type MenuGroup = {
  title?: string;
  items: MenuItem[];
};

export const menuGroups: MenuGroup[] = [
  {
    items: [
      {
        label: "O meu dia",
        href: "/hoje",
        icon: Sun,
        keywords: "hoje pendentes por fazer lista trabalho seguimento atrasado",
      },
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: Gauge,
        keywords: "início painel resumo produção",
      },
    ],
  },
  {
    title: "Leads",
    items: [
      {
        label: "Leads (Chat)",
        href: "/leads",
        icon: MessageCircle,
        keywords: "contactos pedidos site",
      },
    ],
  },
  {
    title: "Carteira",
    items: [
      {
        label: "Clientes",
        href: "/clientes",
        icon: Users,
        keywords: "apólices nif ficha",
      },
      {
        label: "Vencimentos e Recibos",
        href: "/vencimentos",
        icon: CalendarDays,
        keywords:
          "recibos cobrança pagamentos prémios renovações anuladas a vencer histórico",
        alsoActiveOn: ["/recibos"],
      },
      {
        label: "Carteira por Companhia",
        href: "/carteira",
        icon: Building2,
        keywords: "companhias zurich prévoir",
      },
      {
        label: "Faturação",
        href: "/faturacao",
        icon: Coins,
        keywords: "faturação comissões comissão ganhos contabilidade",
      },
    ],
  },
  {
    title: "Atividades",
    items: [
      {
        label: "Tarefas",
        href: "/tarefas",
        icon: FileText,
        keywords: "lembretes follow-up por fazer",
      },
      {
        label: "Processos",
        href: "/processos",
        icon: Briefcase,
        keywords: "simulações renegociações emissão não emitida",
      },
      {
        label: "Oportunidades",
        href: "/oportunidades",
        icon: Target,
        keywords: "negócios venda cruzada",
      },
      {
        label: "Simulador",
        href: "/simulador",
        icon: Calculator,
        keywords: "cotação preço estimativa auto",
      },
      {
        label: "Conversas",
        href: "/conversas",
        icon: MessagesSquare,
        keywords: "whatsapp mensagens",
      },
      {
        label: "Apólices de Parceiros",
        href: "/apolices-parceiros",
        icon: Inbox,
        keywords: "parceiros envios formulário anexos",
      },
    ],
  },
  {
    title: "Análises",
    items: [
      {
        label: "Estatísticas",
        href: "/estatisticas",
        icon: BarChart3,
        keywords: "gráficos relatórios desempenho",
      },
    ],
  },
  {
    title: "Gestão",
    items: [
      {
        label: "Lojas",
        href: "/lojas",
        icon: Building2,
        keywords: "balcões agências",
      },
      {
        label: "Utilizadores",
        href: "/utilizadores",
        icon: CircleUserRound,
        keywords: "equipa contas permissões",
      },
      {
        label: "Configurações",
        href: "/configuracoes",
        icon: Settings,
        keywords: "parceiros produtos definições",
      },
    ],
  },
];

/* Abre a pesquisa rápida a partir de qualquer componente. */
export const OPEN_COMMAND_PALETTE = "interseguros:open-command-palette";

export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE));
}
