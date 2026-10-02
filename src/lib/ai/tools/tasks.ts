import type { AiUserContext } from "@/lib/ai/context";
import { getExpiryAlerts, ALERT_DAYS } from "@/lib/alerts/expiry-alerts";
import { reconcileProcessReceipts } from "@/lib/tasks/process-receipts";

const MAX_TASKS = 200;

type Relation<T> = T | T[] | null;

type TaskQueryRow = {
  id: string;
  kind: "TASK" | "PROCESS";
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  client_name: string | null;
  client_nif: string | null;
  policy_start_date: string | null;
  is_new_policy: boolean | null;
  simulation_presented: boolean;
  issued: boolean;
  receipt_paid: boolean;
  receipt_source: string | null;
  assigned_user_id: string | null;
  insurance_line: Relation<{ name: string }>;
  receipt: Relation<{
    receipt_number: string | null;
    status: string;
    due_date: string | null;
    payment_date: string | null;
    total_premium: number | string | null;
  }>;
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/*
 * Tarefas e processos (simulações / renegociações) visíveis para o
 * utilizador. Num processo, a data que conta é a data de início do
 * seguro; numa tarefa normal é o prazo.
 */
export async function getTasks(
  context: AiUserContext,
  args: {
    from: string | null;
    to: string | null;
    kind: "ALL" | "TASK" | "PROCESS";
    status: "OPEN" | "COMPLETED" | "ALL";
    search: string | null;
  },
) {
  // Garante que o estado do recibo está atualizado com o webservice.
  try {
    await reconcileProcessReceipts(context.supabase);
  } catch (error) {
    console.error("[ai] reconcileProcessReceipts", error);
  }

  let query = context.supabase
    .from("tasks")
    .select(`
      id,
      kind,
      title,
      description,
      status,
      priority,
      due_at,
      completed_at,
      created_at,
      client_name,
      client_nif,
      policy_start_date,
      is_new_policy,
      simulation_presented,
      issued,
      receipt_paid,
      receipt_source,
      insurance_line:insurance_lines ( name ),
      assigned_user_id,
      receipt:receipts ( receipt_number, status, due_date, payment_date, total_premium )
    `)
    .order("created_at", { ascending: false });

  // Tarefas da equipa toda (sem restrição por pessoa nem por loja);
  // a loja escolhida no seletor funciona como filtro.
  if (context.storeId) {
    query = query.eq("store_id", context.storeId);
  }

  if (args.kind !== "ALL") {
    query = query.eq("kind", args.kind);
  }

  if (args.status === "OPEN") {
    query = query.not("status", "in", "(COMPLETED,CANCELLED)");
  } else if (args.status === "COMPLETED") {
    query = query.eq("status", "COMPLETED");
  }

  const search = args.search?.trim();

  if (search) {
    const safe = search.replace(/[%,()]/g, "");
    query = query.or(
      `title.ilike.%${safe}%,client_name.ilike.%${safe}%,client_nif.ilike.%${safe}%`,
    );
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  const taskRows = (data ?? []) as unknown as TaskQueryRow[];

  const assignedIds = Array.from(
    new Set(taskRows.map((row) => row.assigned_user_id).filter(Boolean)),
  ) as string[];

  const { data: profilesData } =
    assignedIds.length > 0
      ? await context.supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", assignedIds)
      : { data: [] as { id: string; full_name: string }[] };

  const profileNames = new Map(
    (profilesData ?? []).map((p) => [p.id, p.full_name]),
  );

  const rows = taskRows
    .map((row) => {
      const receipt = firstRelation(row.receipt);
      const date =
        row.kind === "PROCESS"
          ? row.policy_start_date ?? row.due_at?.slice(0, 10) ?? null
          : row.due_at?.slice(0, 10) ?? null;

      return {
        kind: row.kind === "PROCESS" ? "processo" : "tarefa",
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        date,
        created_at: row.created_at.slice(0, 10),
        completed_at: row.completed_at?.slice(0, 10) ?? null,
        responsible_name: row.assigned_user_id
          ? profileNames.get(row.assigned_user_id) ?? null
          : null,
        ...(row.kind === "PROCESS"
          ? {
              client_name: row.client_name,
              client_nif: row.client_nif,
              insurance_type:
                firstRelation(row.insurance_line)?.name ??
                null,
              policy_start_date: row.policy_start_date,
              new_policy: row.is_new_policy !== false,
              renegotiation: row.is_new_policy === false,
              simulation_presented: row.simulation_presented,
              issued: row.issued,
              receipt_paid: row.receipt_paid,
              receipt_source:
                row.receipt_source === "WEBSERVICE"
                  ? "webservice da companhia"
                  : row.receipt_source === "MANUAL"
                    ? "manual"
                    : null,
              receipt: receipt
                ? {
                    number: receipt.receipt_number,
                    status: receipt.status,
                    due_date: receipt.due_date,
                    payment_date: receipt.payment_date,
                    total_premium:
                      receipt.total_premium === null
                        ? null
                        : Number(receipt.total_premium),
                  }
                : null,
            }
          : {}),
      };
    })
    .filter((row) => {
      if (!args.from && !args.to) return true;
      if (!row.date) return false;
      if (args.from && row.date < args.from) return false;
      if (args.to && row.date > args.to) return false;
      return true;
    })
    .sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));

  return {
    from: args.from,
    to: args.to,
    count: rows.length,
    truncated: rows.length > MAX_TASKS,
    tasks: rows.slice(0, MAX_TASKS),
  };
}

/*
 * Tudo o que vence nos próximos 5 dias: renovações, recibos por
 * cobrar e processos com início de seguro a chegar.
 */
export async function getExpiryAlertsForAi() {
  const alerts = await getExpiryAlerts();

  return {
    days: ALERT_DAYS,
    count: alerts.length,
    alerts: alerts.map((a) => ({
      type:
        a.type === "renewal"
          ? "renovação"
          : a.type === "receipt"
            ? "recibo por cobrar"
            : "início de seguro (processo)",
      client: a.title,
      detail: a.subtitle,
      date: a.date,
      days_left: a.daysLeft,
    })),
  };
}
