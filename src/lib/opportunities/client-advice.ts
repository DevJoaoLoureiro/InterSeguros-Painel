/*
 * Conselhos do cliente (a "lâmpada" no painel do cliente).
 *
 * Regras fixas sobre dados que já temos — instantâneas e sem custo.
 * Função pura: não toca na BD, recebe tudo já carregado.
 *
 * Importante na forma de escrever: "não tem Automóvel" quer dizer
 * "não tem CONNOSCO". Pode ter noutro mediador, por isso os
 * conselhos sugerem perguntar, nunca afirmam necessidade.
 */

export type AdvicePriority = "high" | "medium" | "low";

export type AdviceCategory =
  | "cross_sell"
  | "retention"
  | "collection"
  | "recovery"
  | "data";

export type AdviceAction =
  | {
      type: "create_process";
      lineCode: string;
      lineId: string | null;
      lineName: string;
      isNewPolicy: boolean;
      policyStartDate: string | null;
    }
  | { type: "open_policy"; policyId: string }
  | { type: "open_receipts"; policyId: string | null }
  | { type: "open_client_data" };

export type ClientAdvice = {
  // Estável entre visitas: é a chave usada para "Dispensar".
  key: string;
  category: AdviceCategory;
  priority: AdvicePriority;
  title: string;
  reason: string;
  action: AdviceAction;
  // Já há um processo aberto para isto (não sugerir criar outro).
  processAlreadyOpen: boolean;
};

export type AdvicePolicy = {
  id: string;
  policy_number: string;
  status: string;
  line_code: string | null;
  line_name: string | null;
  company_name: string | null;
  annualized_premium: number | null;
};

export type AdviceReceipt = {
  status: string;
  isReversal: boolean;
  due_date: string | null;
  period_end: string | null;
  premium_change_pct: number | null;
  premium_increase_alert: boolean;
};

export type AdviceTransfer = {
  direction: "outgoing" | "incoming";
  kind: "TRANSFER" | "REPLACEMENT" | "OTHER_HOLDER" | "NOT_FOUND";
  referenceDate: string | null;
};

export type AdviceInput = {
  today: string; // YYYY-MM-DD
  client: {
    nif: string | null;
    email: string | null;
    phone: string | null;
    birth_date: string | null;
    // Ficha da companhia (Zurich): Filhos, EstadoCivil, Tipo, ...
    metadata: Record<string, unknown>;
  };
  policies: AdvicePolicy[];
  receiptsByPolicy: Record<string, AdviceReceipt[]>;
  transfers: Record<string, AdviceTransfer>;
  lineIdsByCode: Record<string, string>;
  lineNamesByCode: Record<string, string>;
  // Ramos com processo de simulação já aberto para este NIF.
  openProcessLineCodes: Set<string>;
};

const LINE = {
  AUTO: "AUTO",
  MRH: "MRH",
  MRE: "MULTIRRISCOS_EMPRESARIAL",
  AT: "AT",
  RC: "RC",
  AP: "AP",
  VIDA: "VIDA",
} as const;

const RENEWAL_WINDOW_DAYS = 45;
const RECOVERY_WINDOW_DAYS = 365;

const PRIORITY_ORDER: Record<AdvicePriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

// Com a mesma prioridade, o que está em risco vem antes de vender.
const CATEGORY_ORDER: Record<AdviceCategory, number> = {
  collection: 0,
  retention: 1,
  recovery: 2,
  cross_sell: 3,
  data: 4,
};

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

function ageFrom(birthDate: string | null, today: string) {
  if (!birthDate) return null;

  const birth = birthDate.slice(0, 10);
  if (Number.isNaN(Date.parse(birth))) return null;

  let age = Number(today.slice(0, 4)) - Number(birth.slice(0, 4));
  if (today.slice(5) < birth.slice(5)) age -= 1;

  return age;
}

/* NIF começado por 5 = pessoa coletiva (empresa). */
function isCompany(input: AdviceInput) {
  const nif = (input.client.nif ?? "").replace(/\D/g, "");
  if (nif.startsWith("5")) return true;

  const tipo = String(input.client.metadata.Tipo ?? "").toLowerCase();
  return tipo.includes("colectiv") || tipo.includes("coletiv") || tipo.includes("empresa");
}

function childrenCount(metadata: Record<string, unknown>) {
  const raw = metadata.Filhos;
  if (raw === null || raw === undefined) return null;

  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? n : null;
}

export function computeClientAdvice(input: AdviceInput): ClientAdvice[] {
  const advice: ClientAdvice[] = [];

  const active = input.policies.filter(
    (p) => p.status === "ACTIVE" || p.status === "PENDING",
  );
  const activeLines = new Set(active.map((p) => p.line_code).filter(Boolean));
  const company = isCompany(input);
  const age = ageFrom(input.client.birth_date, input.today);
  const children = childrenCount(input.client.metadata);

  const lineName = (code: string) =>
    input.lineNamesByCode[code] ?? code;

  function crossSell(
    code: string,
    priority: AdvicePriority,
    title: string,
    reason: string,
  ) {
    if (activeLines.has(code)) return;

    advice.push({
      key: `cross_sell:${code}`,
      category: "cross_sell",
      priority,
      title,
      reason,
      action: {
        type: "create_process",
        lineCode: code,
        lineId: input.lineIdsByCode[code] ?? null,
        lineName: lineName(code),
        isNewPolicy: true,
        policyStartDate: null,
      },
      processAlreadyOpen: input.openProcessLineCodes.has(code),
    });
  }

  // ----------------------------------------
  // CROSS-SELL (só para quem é cliente ativo)
  // ----------------------------------------

  if (active.length > 0) {
    if (company) {
      if (!activeLines.has(LINE.AT)) {
        crossSell(
          LINE.AT,
          "high",
          "Empresa sem Acidentes de Trabalho connosco",
          "O seguro de Acidentes de Trabalho é obrigatório para empresas com trabalhadores. Pergunta quantos trabalhadores tem e onde está segurado.",
        );
      }

      if (!activeLines.has(LINE.MRE)) {
        crossSell(
          LINE.MRE,
          "medium",
          "Empresa sem Multirriscos Empresarial connosco",
          "Instalações, recheio e perda de exploração. Pergunta se as instalações estão seguras e em que condições.",
        );
      }

      if (!activeLines.has(LINE.RC)) {
        crossSell(
          LINE.RC,
          "medium",
          "Empresa sem Responsabilidade Civil connosco",
          "Danos causados a terceiros na atividade. Muitas atividades e contratos exigem-na.",
        );
      }
    } else {
      if (activeLines.has(LINE.MRH) && !activeLines.has(LINE.AUTO)) {
        crossSell(
          LINE.AUTO,
          "high",
          "Tem Multirriscos Habitação mas não tem Automóvel connosco",
          "Pergunta se tem carro e quando renova o seguro — é a oportunidade mais comum para quem já tem a casa connosco.",
        );
      }

      if (activeLines.has(LINE.AUTO) && !activeLines.has(LINE.MRH)) {
        crossSell(
          LINE.MRH,
          "high",
          "Tem Automóvel mas não tem Multirriscos Habitação connosco",
          "Pergunta se a casa tem seguro (muitas vezes é o do banco, mais caro). Uma simulação costuma compensar.",
        );
      }

      const familyReason =
        children && children > 0
          ? `Tem ${children} filho${children === 1 ? "" : "s"}: a proteção da família é um bom ponto de conversa.`
          : null;

      if (!activeLines.has(LINE.VIDA) && (age === null || (age >= 25 && age <= 60))) {
        crossSell(
          LINE.VIDA,
          familyReason ? "high" : "low",
          "Sem seguro de Vida connosco",
          familyReason ??
            "Pergunta se tem crédito à habitação: o Vida do banco costuma ser mais caro do que no mercado.",
        );
      }

      if (
        !activeLines.has(LINE.AP) &&
        familyReason &&
        (activeLines.has(LINE.AUTO) || activeLines.has(LINE.MRH))
      ) {
        crossSell(
          LINE.AP,
          "low",
          "Sem Acidentes Pessoais connosco",
          familyReason,
        );
      }
    }
  }

  // ----------------------------------------
  // RETENÇÃO / COBRANÇA (por apólice ativa)
  // ----------------------------------------

  for (const policy of active) {
    const receipts = (input.receiptsByPolicy[policy.id] ?? []).filter(
      (r) => !r.isReversal,
    );
    const label = `${policy.line_name ?? "Apólice"} nº ${policy.policy_number}`;

    // Recibo devolvido (o último válido).
    const last = receipts[0];
    if (last?.status === "RETURNED") {
      advice.push({
        key: `returned:${policy.id}`,
        category: "collection",
        priority: "high",
        title: `Recibo devolvido — ${label}`,
        reason:
          "O último recibo foi devolvido. Confirma o meio de pagamento (IBAN do débito direto) antes que a apólice seja anulada.",
        action: { type: "open_receipts", policyId: policy.id },
        processAlreadyOpen: false,
      });
    }

    // Recibos em atraso.
    const overdue = receipts.filter(
      (r) => r.status === "PENDING" && r.due_date && r.due_date.slice(0, 10) < input.today,
    );
    if (overdue.length > 0) {
      advice.push({
        key: `overdue:${policy.id}`,
        category: "collection",
        priority: "high",
        title: `${overdue.length} recibo${overdue.length === 1 ? "" : "s"} em atraso — ${label}`,
        reason: "Contacta o cliente para regularizar antes da anulação por falta de pagamento.",
        action: { type: "open_receipts", policyId: policy.id },
        processAlreadyOpen: false,
      });
    }

    // Renovação a chegar (pelo fim do período do último recibo).
    const renewal = receipts
      .map((r) => r.period_end?.slice(0, 10))
      .filter(Boolean)
      .sort()
      .at(-1);

    if (renewal) {
      const days = daysBetween(input.today, renewal);

      if (days >= 0 && days <= RENEWAL_WINDOW_DAYS) {
        const increase = receipts.find(
          (r) => r.premium_change_pct !== null,
        )?.premium_change_pct;
        const raised = increase !== undefined && increase !== null && increase > 5;
        const when =
          days === 0 ? "Renova hoje" : days === 1 ? "Renova amanhã" : `Renova em ${days} dias`;
        const code = policy.line_code ?? "";

        advice.push({
          key: `renewal:${policy.id}:${renewal}`,
          category: "retention",
          priority: raised ? "high" : "medium",
          title: raised
            ? `${when} e o prémio subiu ${increase!.toFixed(1)}% — ${label}`
            : `${when} — ${label}`,
          reason: raised
            ? "Bom momento para renegociar ou simular noutra companhia antes da renovação."
            : "Contacta o cliente antes da renovação: confirma dados e aproveita para rever coberturas.",
          action: {
            type: "create_process",
            lineCode: code,
            lineId: input.lineIdsByCode[code] ?? null,
            lineName: policy.line_name ?? lineName(code),
            isNewPolicy: false,
            policyStartDate: renewal,
          },
          processAlreadyOpen: input.openProcessLineCodes.has(code),
        });
      }
    }
  }

  // ----------------------------------------
  // RECUPERAÇÃO (anuladas sem seguimento)
  // ----------------------------------------

  for (const policy of input.policies) {
    const transfer = input.transfers[policy.id];

    if (
      policy.status !== "CANCELLED" ||
      transfer?.direction !== "outgoing" ||
      transfer.kind !== "NOT_FOUND"
    ) {
      continue;
    }

    const code = policy.line_code ?? "";

    // Já voltou a ter este ramo connosco: nada a recuperar.
    if (activeLines.has(code)) continue;

    const days = transfer.referenceDate
      ? daysBetween(transfer.referenceDate, input.today)
      : null;

    if (days !== null && days > RECOVERY_WINDOW_DAYS) continue;

    advice.push({
      key: `recover:${policy.id}`,
      category: "recovery",
      priority: "medium",
      title: `Apólice de ${policy.line_name ?? "seguro"} anulada sem seguimento`,
      reason: `A apólice nº ${policy.policy_number}${policy.company_name ? ` (${policy.company_name})` : ""} foi anulada${days !== null ? ` há ${days} dias` : ""} e não encontrámos outra connosco. Pergunta onde está segurado e propõe uma simulação.`,
      action: {
        type: "create_process",
        lineCode: code,
        lineId: input.lineIdsByCode[code] ?? null,
        lineName: policy.line_name ?? lineName(code),
        isNewPolicy: true,
        policyStartDate: null,
      },
      processAlreadyOpen: input.openProcessLineCodes.has(code),
    });
  }

  // Ex-cliente: tem apólices mas nenhuma ativa.
  if (input.policies.length > 0 && active.length === 0) {
    advice.push({
      key: "former_client",
      category: "recovery",
      priority: "medium",
      title: "Ex-cliente: já não tem apólices ativas connosco",
      reason: "Liga para saber como está segurado agora e propõe rever os seguros.",
      action: { type: "open_client_data" },
      processAlreadyOpen: false,
    });
  }

  // ----------------------------------------
  // DADOS
  // ----------------------------------------

  if (!input.client.email && !input.client.phone) {
    advice.push({
      key: "missing_contacts",
      category: "data",
      priority: "low",
      title: "Sem email nem telefone",
      reason: "Sem contactos não consegues avisar de renovações nem de recibos em atraso.",
      action: { type: "open_client_data" },
      processAlreadyOpen: false,
    });
  }

  return advice.sort(
    (a, b) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category],
  );
}
