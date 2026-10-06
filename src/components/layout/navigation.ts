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
  MessageCircle,
  MessagesSquare,
  ReceiptText,
  Settings,
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
};

export type MenuGroup = {
  title?: string;
  items: MenuItem[];
};

export const menuGroups: MenuGroup[] = [
  {
    items: [
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
        label: "Recibos",
        href: "/recibos",
        icon: ReceiptText,
        keywords: "cobrança pagamentos prémios",
      },
      {
        label: "Vencimentos",
        href: "/vencimentos",
        icon: CalendarDays,
        keywords: "renovações anuladas recibos a vencer",
      },
      {
        label: "Carteira por Companhia",
        href: "/carteira",
        icon: Building2,
        keywords: "companhias zurich prévoir",
      },
      {
        label: "Comissões",
        href: "/comissoes",
        icon: Coins,
        keywords: "comissão ganhos",
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
