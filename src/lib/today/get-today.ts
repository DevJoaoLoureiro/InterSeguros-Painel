import { clientHref } from "@/lib/clients/client-link";
import { getVencimentosSnapshot } from "@/lib/alerts/expiry-alerts";
import { getSelectedStoreFilter } from "@/lib/auth/store-selection";
import { getUnseenPartnerSubmissionsCount } from "@/lib/partner-submissions/unseen-count";
import { createAdminClient } from "@/lib/supabase/admin";
import { vencimentosHref } from "@/lib/vencimentos/tabs";

/*
 * "O meu dia" — tudo o que NÃO é processo (os processos têm o seu
 * próprio bloco, com ações, em components/hoje/today-board.tsx).
 * Só lê: cada linha leva à página onde o assunto se resolve e
 * desaparece sozinha quando fica tratado.
 *
 * Âmbito:
 *   - tarefas, leads e oportunidades: as atribuídas a mim;
 *   - recibos, renovações e conversas (não têm responsável): a loja
 *     escolhida no seletor do topo, ou a minha loja se for "Todas".
 */

export type TodayKind =
  | "task"
  | "renewal"
  | "receipt"
  | "lead"
  | "opportunity"
  | "conversation"
  | "partner";

export type TodaySection = "overdue" | "today" | "follow";

export type TodayItem = {
  id: string;
  kind: TodayKind;
  section: TodaySection;
  title: string;
  detail: string;
  // Etiqueta curta de tempo ("há 4 dias", "amanhã").
  when: string;
  // Para ordenar dentro da secção: mais urgente primeiro.
  rank: number;
  href: string;
  action: string;
};

/*
 * "A minha semana": o que acontece em cada um dos próximos 7 dias
 * (hoje incluído). Os inícios de seguro dos processos juntam-se no
 * browser, a partir dos processos já carregados.
 */
export type WeekEventKind = "receipt" | "renewal" | "task" | "process";

export type WeekEvent = {
  id: string;
  date: string; // YYYY-MM-DD (Lisboa)
  kind: WeekEventKind;
  title: string;
  detail: string;
  href: string;
};

export type TodayData = {
  // Hoje (YYYY-MM-DD, Lisboa): a semana começa aqui.
  todayKey: string;
  week: WeekEvent[];
  items: TodayItem[];
  // Linhas cortadas por tipo (para "ver mais" na página certa).
  hidden: { kind: TodayKind; count: number; href: string }[];
  storeName: string | null;
};

const UPCOMING_DAYS = 5;
const WEEK_DAYS = 7;
const RENEWAL_DAYS = 7;
// Máximo de linhas por tipo e secção (o resto fica em "ver mais").
const MAX_PER_GROUP = 5;

function lisbonDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/* Dias de hoje até à data (negativo = já passou). */
function daysUntil(value: string, todayKey: string) {
  const key = value.length > 10 ? lisbonDateKey(new Date(value)) : value;
  return Math.round((Date.parse(key) - Date.parse(todayKey)) / 86400000);
}

function ago(days: number) {
  if (days <= 0) return "hoje";
  if (days === 1) return "há 1 dia";
  return `há ${days} dias`;
}

function inDays(days: number) {
  if (days < 0) return days === -1 ? "ontem" : `há ${-days} dias`;
  if (days === 0) return "hoje";
  if (days === 1) return "amanhã";
  return `em ${days} dias`;
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

const euro = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
});

export async function getTodayData(profile: {
  id: string;
  store: { id: string; name: string } | null;
}): Promise<TodayData> {
  const admin = createAdminClient();
  const todayKey = lisbonDateKey();

  const selectedStore = await getSelectedStoreFilter();
  const storeId = selectedStore ?? profile.store?.id ?? null;

  const weekEnd = new Date(`${todayKey}T00:00:00Z`);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + WEEK_DAYS - 1);
  const weekEndKey = weekEnd.toISOString().slice(0, 10);

  const [
    weekTasksResult,
    tasksResult,
    vencimentos,
    leadsResult,
    opportunitiesResult,
    conversationsResult,
    partnerCount,
    storeResult,
  ] = await Promise.all([
    // Tarefas com prazo nesta semana (para "A minha semana").
    admin
      .from("tasks")
      .select("id, title, due_at")
      .eq("kind", "TASK")
      .eq("assigned_user_id", profile.id)
      .not("status", "in", "(COMPLETED,CANCELLED)")
      .gte("due_at", todayKey)
      .lte("due_at", `${weekEndKey}T23:59:59`)
      .order("due_at", { ascending: true })
      .limit(200),

    admin
      .from("tasks")
      .select("id, title, due_at, priority")
      .eq("kind", "TASK")
      .eq("assigned_user_id", profile.id)
      .not("status", "in", "(COMPLETED,CANCELLED)")
      .not("due_at", "is", null)
      .lte("due_at", `${todayKey}T23:59:59`)
      .order("due_at", { ascending: true })
      .limit(50),

    getVencimentosSnapshot(storeId),

    admin
      .from("leads")
      .select("id, name, insurance_type, created_at")
      .eq("assigned_user_id", profile.id)
      .eq("status", "nova")
      .order("created_at", { ascending: true })
      .limit(50),

    admin
      .from("opportunities")
      .select("id, title, expected_close_date")
      .eq("assigned_user_id", profile.id)
      .not("status", "in", "(ganha,perdida)")
      .lt("expected_close_date", todayKey)
      .order("expected_close_date", { ascending: true })
      .limit(50),

    (() => {
      let query = admin
        .from("whatsapp_conversations")
        .select("id")
        .gt("unread_count", 0)
        .limit(500);

      if (storeId) query = query.eq("store_id", storeId);
      return query;
    })(),

    getUnseenPartnerSubmissionsCount(profile.id),

    storeId
      ? admin.from("stores").select("name").eq("id", storeId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // ---------------- A MINHA SEMANA
  const week: WeekEvent[] = [];
  const inWeek = (key: string) => key >= todayKey && key <= weekEndKey;

  for (const receipt of vencimentos.receipts) {
    const key = receipt.dueDate.slice(0, 10);
    if (!inWeek(key)) continue;

    week.push({
      id: `receipt-${receipt.receiptId}`,
      date: key,
      kind: "receipt",
      title: receipt.clientName,
      detail: `Recibo a vencer · ${receipt.companyName}${
        receipt.totalPremium !== null ? ` · ${euro.format(receipt.totalPremium)}` : ""
      }`,
      href: receipt.clientId
        ? clientHref(receipt.clientId)
        : vencimentosHref("receipts"),
    });
  }

  for (const renewal of vencimentos.renewals) {
    const key = renewal.renewalDate.slice(0, 10);
    if (!inWeek(key)) continue;

    week.push({
      id: `renewal-${renewal.policyId}`,
      date: key,
      kind: "renewal",
      title: renewal.clientName,
      detail: `Renovação · ${renewal.companyName}${renewal.lineName ? ` · ${renewal.lineName}` : ""}`,
      href: renewal.clientId
        ? clientHref(renewal.clientId)
        : vencimentosHref("renewals"),
    });
  }

  for (const task of weekTasksResult.data ?? []) {
    const due = task.due_at as string;
    const key = due.length > 10 ? lisbonDateKey(new Date(due)) : due;
    if (!inWeek(key)) continue;

    week.push({
      id: `task-${task.id}`,
      date: key,
      kind: "task",
      title: task.title,
      detail: "Tarefa com prazo",
      href: "/tarefas",
    });
  }

  const items: TodayItem[] = [];

  // ---------------- TAREFAS
  for (const task of tasksResult.data ?? []) {
    const days = daysUntil(task.due_at as string, todayKey);

    items.push({
      id: `task-${task.id}`,
      kind: "task",
      section: days < 0 ? "overdue" : "today",
      title: task.title,
      detail: days < 0 ? "Prazo ultrapassado." : "Para fazer hoje.",
      when: days < 0 ? `prazo ${inDays(days)}` : "hoje",
      rank: days - (task.priority === "HIGH" ? 0.5 : 0),
      href: "/tarefas",
      action: "Ver tarefa",
    });
  }

  // ---------------- RECIBOS
  for (const receipt of vencimentos.receipts) {
    const days = daysUntil(receipt.dueDate, todayKey);
    if (!receipt.overdue && days > UPCOMING_DAYS) continue;

    const amount =
      receipt.totalPremium !== null ? ` · ${euro.format(receipt.totalPremium)}` : "";

    items.push({
      id: `receipt-${receipt.receiptId}`,
      kind: "receipt",
      section: receipt.overdue ? "overdue" : "today",
      title: receipt.clientName,
      detail: `${receipt.overdue ? "Recibo por pagar" : "Recibo a vencer"} · ${receipt.companyName}${amount}`,
      when: receipt.overdue ? `venceu ${inDays(days)}` : `vence ${inDays(days)}`,
      rank: days,
      href: receipt.clientId
        ? clientHref(receipt.clientId)
        : vencimentosHref("receipts"),
      action: "Ver cliente",
    });
  }

  // ---------------- RENOVAÇÕES
  for (const renewal of vencimentos.renewals) {
    const days = daysUntil(renewal.renewalDate, todayKey);
    if (!renewal.overdue && days > RENEWAL_DAYS) continue;

    items.push({
      id: `renewal-${renewal.policyId}`,
      kind: "renewal",
      section: renewal.overdue ? "overdue" : "today",
      title: renewal.clientName,
      detail: `Renovação · ${renewal.companyName}${renewal.lineName ? ` · ${renewal.lineName}` : ""}`,
      when: renewal.overdue ? `passou ${inDays(days)}` : `renova ${inDays(days)}`,
      rank: days,
      href: renewal.clientId
        ? clientHref(renewal.clientId)
        : vencimentosHref("renewals"),
      action: "Ver cliente",
    });
  }

  // ---------------- LEADS
  for (const lead of leadsResult.data ?? []) {
    const age = -daysUntil(lead.created_at as string, todayKey);

    items.push({
      id: `lead-${lead.id}`,
      kind: "lead",
      section: age >= 1 ? "follow" : "today",
      title: lead.name,
      detail: `Lead nova${lead.insurance_type ? ` · ${lead.insurance_type}` : ""} — ainda sem contacto.`,
      when: `chegou ${ago(age)}`,
      rank: -age,
      href: "/leads",
      action: "Contactar",
    });
  }

  // ---------------- OPORTUNIDADES
  for (const opportunity of opportunitiesResult.data ?? []) {
    const days = daysUntil(opportunity.expected_close_date as string, todayKey);

    items.push({
      id: `opportunity-${opportunity.id}`,
      kind: "opportunity",
      section: "follow",
      title: opportunity.title,
      detail: "Data prevista de fecho já passou — atualizar ou fechar.",
      when: `fecho ${inDays(days)}`,
      rank: days,
      href: "/oportunidades",
      action: "Atualizar",
    });
  }

  // ---------------- CONVERSAS (uma linha só)
  const unread = (conversationsResult.data ?? []).length;

  if (unread > 0) {
    items.push({
      id: "conversations",
      kind: "conversation",
      section: "today",
      title: plural(unread, "conversa por responder", "conversas por responder"),
      detail: "Clientes à espera de resposta no WhatsApp.",
      when: "agora",
      rank: -100,
      href: "/conversas",
      action: "Responder",
    });
  }

  // ---------------- PARCEIROS (uma linha só)
  if (partnerCount > 0) {
    items.push({
      id: "partners",
      kind: "partner",
      section: "today",
      title: plural(partnerCount, "apólice de parceiro por abrir", "apólices de parceiros por abrir"),
      detail: "Enviadas por parceiros para ti.",
      when: "novo",
      rank: -99,
      href: "/apolices-parceiros",
      action: "Abrir",
    });
  }

  // Corta cada tipo por secção (recibos/renovações podem ser dezenas).
  const sorted = items.sort((a, b) => a.rank - b.rank);
  const kept: TodayItem[] = [];
  const hiddenMap = new Map<TodayKind, number>();
  const counter = new Map<string, number>();

  for (const item of sorted) {
    const key = `${item.section}:${item.kind}`;
    const count = (counter.get(key) ?? 0) + 1;
    counter.set(key, count);

    if (count <= MAX_PER_GROUP) {
      kept.push(item);
    } else {
      hiddenMap.set(item.kind, (hiddenMap.get(item.kind) ?? 0) + 1);
    }
  }

  const hiddenHref: Partial<Record<TodayKind, string>> = {
    receipt: vencimentosHref("receipts"),
    renewal: vencimentosHref("renewals"),
    task: "/tarefas",
    lead: "/leads",
    opportunity: "/oportunidades",
  };

  return {
    todayKey,
    week,
    items: kept,
    hidden: [...hiddenMap.entries()].map(([kind, count]) => ({
      kind,
      count,
      href: hiddenHref[kind] ?? "/hoje",
    })),
    storeName: (storeResult.data as { name: string } | null)?.name ?? null,
  };
}
