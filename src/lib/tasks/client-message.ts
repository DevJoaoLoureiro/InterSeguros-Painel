/*
 * Mensagem de primeira abordagem ao cliente de um processo. Há um
 * modelo por tipo de ramo (editável em Configurações → Mensagens, tabela
 * message_templates); sem modelo gravado usa-se o DEFAULT_TEMPLATES.
 *
 * Variáveis do texto:
 *   {saudacao}    "Boa tarde Sr. Gary" (hora do dia + tratamento + nome)
 *   {colaborador} quem assina
 *   {assunto}     "a viatura que adquiriu com o Sr. Mário", "o seguro de vida"...
 *   {planos}      "com três planos: o Base com ..., o ... e o ..."
 */

export const MESSAGE_LINE_KINDS = [
  "AUTO",
  "HABITACAO",
  "SAUDE",
  "VIDA",
  "OTHER",
] as const;

export type MessageLineKind = (typeof MESSAGE_LINE_KINDS)[number];

export const MESSAGE_LINE_KIND_LABELS: Record<MessageLineKind, string> = {
  AUTO: "Automóvel",
  HABITACAO: "Habitação",
  SAUDE: "Saúde",
  VIDA: "Vida",
  OTHER: "Outros ramos",
};

export const MESSAGE_VARIABLES = [
  { key: "{saudacao}", hint: "Boa tarde Sr. Gary" },
  { key: "{colaborador}", hint: "quem assina" },
  { key: "{assunto}", hint: "a viatura que adquiriu com o Sr. Mário" },
  { key: "{planos}", hint: "com três planos: o Base com ..." },
] as const;

export type MessagePlan = { name: string; description: string };

export type MessageTemplate = {
  lineKind: MessageLineKind;
  newBody: string;
  renewalBody: string;
  plans: MessagePlan[];
};

const INTRO =
  "{saudacao}, o meu nome é {colaborador} e trabalho no departamento de seguros do grupo Fisacar.";
const CLOSING =
  "Qualquer dúvida, por favor disponha.\n\nCom os melhores cumprimentos,\n{colaborador}";

const NEW_BODY = `${INTRO}\n\nEm anexo envio a cotação para {assunto}, {planos}.\n\n${CLOSING}`;
const RENEWAL_BODY = `${INTRO}\n\nEm anexo envio uma proposta para {assunto}, para poder comparar com o que tem atualmente, {planos}.\n\n${CLOSING}`;

export const DEFAULT_TEMPLATES: Record<MessageLineKind, MessageTemplate> = {
  AUTO: {
    lineKind: "AUTO",
    newBody: NEW_BODY,
    renewalBody: RENEWAL_BODY,
    plans: [
      { name: "Base", description: "com quebra de vidros" },
      { name: "Intermédio", description: "com furto e roubo" },
      {
        name: "VIP/Gold",
        description: "com danos próprios (o chamado contra todos os riscos)",
      },
    ],
  },
  HABITACAO: {
    lineKind: "HABITACAO",
    newBody: NEW_BODY,
    renewalBody: RENEWAL_BODY,
    plans: [
      { name: "Base", description: "com incêndio, tempestades e danos por água" },
      { name: "Intermédio", description: "com fenómenos sísmicos" },
      { name: "Premium", description: "com danos acidentais" },
    ],
  },
  SAUDE: {
    lineKind: "SAUDE",
    newBody: NEW_BODY,
    renewalBody: RENEWAL_BODY,
    plans: [
      { name: "Base", description: "com hospitalização" },
      { name: "Intermédio", description: "com consultas e exames" },
      { name: "Premium", description: "com estomatologia e parto" },
    ],
  },
  VIDA: {
    lineKind: "VIDA",
    newBody: NEW_BODY,
    renewalBody: RENEWAL_BODY,
    plans: [],
  },
  OTHER: {
    lineKind: "OTHER",
    newBody: NEW_BODY,
    renewalBody: RENEWAL_BODY,
    plans: [],
  },
};

export function isMessageLineKind(value: unknown): value is MessageLineKind {
  return (
    typeof value === "string" &&
    (MESSAGE_LINE_KINDS as readonly string[]).includes(value)
  );
}

export function sanitizePlans(value: unknown): MessagePlan[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((plan) => ({
      name: typeof plan?.name === "string" ? plan.name.trim() : "",
      description:
        typeof plan?.description === "string" ? plan.description.trim() : "",
    }))
    .filter((plan) => plan.name);
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function lineKindFromName(lineName: string | null): MessageLineKind {
  if (!lineName) return "OTHER";

  const name = normalize(lineName);

  if (/\bauto|automovel|viatura/.test(name)) return "AUTO";
  if (/empres|comerci/.test(name)) return "OTHER";
  if (/habita|mrh|multirrisco|casa/.test(name)) return "HABITACAO";
  if (/saude/.test(name)) return "SAUDE";
  if (/\bvida\b/.test(name)) return "VIDA";

  return "OTHER";
}

export function greetingFor(date: Date) {
  const hour = date.getHours();
  if (hour >= 6 && hour < 13) return "Bom dia";
  if (hour >= 13 && hour < 20) return "Boa tarde";
  return "Boa noite";
}

function titleCase(value: string) {
  return value
    .toLocaleLowerCase("pt-PT")
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, letter: string) =>
      sep + letter.toLocaleUpperCase("pt-PT"),
    );
}

/* "GARY SMITH" → "Gary" (o nome que se usa a falar com o cliente). */
export function firstName(fullName: string | null) {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  return first ? titleCase(first) : "";
}

export function displayName(fullName: string | null) {
  return titleCase((fullName ?? "").trim());
}

const COUNT_WORDS = ["", "um", "dois", "três", "quatro", "cinco"];

function joinPt(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

function plansText(plans: MessagePlan[]) {
  const valid = plans.filter((plan) => plan.name.trim());
  if (valid.length === 0) return "";

  const parts = valid.map((plan) =>
    `o ${plan.name.trim()} ${plan.description.trim()}`.trim(),
  );

  if (valid.length === 1) return `com ${parts[0]}`;

  const count = COUNT_WORDS[valid.length] ?? String(valid.length);
  return `com ${count} planos: ${joinPt(parts)}`;
}

type SubjectInput = {
  lineKind: MessageLineKind;
  lineName: string | null;
  isNewPolicy: boolean;
  seller: string;
  insuredItem: string;
};

function subjectFor(input: SubjectInput) {
  const item = input.insuredItem.trim();
  const seller = input.seller.trim();

  switch (input.lineKind) {
    case "AUTO": {
      if (!input.isNewPolicy) {
        return item ? `o seguro da viatura ${item}` : "o seguro da sua viatura";
      }
      const vehicle = item ? `a viatura ${item}` : "a viatura";
      const article = /^(sra\b|d\.|dona\b)/i.test(seller) ? "a" : "o";
      return `${vehicle} que adquiriu${seller ? ` com ${article} ${seller}` : ""}`;
    }
    case "HABITACAO":
      return item
        ? `o seguro da habitação (${item})`
        : "o seguro da sua habitação";
    case "SAUDE":
      return "o seguro de saúde";
    case "VIDA":
      return "o seguro de vida";
    default:
      if (input.lineName) {
        return `o seguro de ${input.lineName.trim().toLocaleLowerCase("pt-PT")}${item ? ` (${item})` : ""}`;
      }
      return item ? `o seguro (${item})` : "o seguro que nos pediu";
  }
}

export type ClientMessageInput = SubjectInput & {
  template: MessageTemplate;
  salutation: string;
  clientName: string;
  senderName: string;
  plans: MessagePlan[];
  now?: Date;
};

export function buildClientMessage(input: ClientMessageInput) {
  const who = [input.salutation.trim(), input.clientName.trim()]
    .filter(Boolean)
    .join(" ");

  const values: Record<string, string> = {
    "{saudacao}": `${greetingFor(input.now ?? new Date())}${who ? ` ${who}` : ""}`,
    "{colaborador}": input.senderName.trim(),
    "{assunto}": subjectFor(input),
    "{planos}": plansText(input.plans),
  };

  const body = input.isNewPolicy
    ? input.template.newBody
    : input.template.renewalBody;

  return (
    body
      .replace(/\{(saudacao|colaborador|assunto|planos)\}/g, (key) => values[key])
      // {planos} vazio deixa ", ." ou ",  ," para trás.
      .replace(/,\s*(?=[.,;!?])/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}
