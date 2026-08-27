import {
  openai,
} from "@/lib/ai/openai";

import {
  getAiUserContext,
} from "@/lib/ai/context";
import {
  getClientOpportunities,
} from "@/lib/ai/tools/client-opportunities";

import {
  getClient360,
} from "@/lib/ai/tools/client-360";

import {
  getPoliciesIssuedToday,
  getPoliciesByDate
} from "@/lib/ai/tools/portfolio";

import {
  searchClient,
  getClientPolicies,
  getClientDetails,
} from "@/lib/ai/tools/clients";

import {
  getProductionSummary,
  compareProductionPeriods,
} from "@/lib/ai/tools/production";

import {
  getPoliciesByPeriod,
  getUpcomingRenewals,
  getUnassignedPolicies,
} from "@/lib/ai/tools/policies";

import {
  getManagementOverview,
} from "@/lib/ai/tools/management";

const tools = [
  {
    type: "function" as const,

    name:
      "get_policies_issued_today",

    description:
      "Consulta as apólices emitidas hoje que o utilizador autenticado tem permissão para visualizar.",

    parameters: {
      type: "object",

      properties: {},

      additionalProperties:
        false,
    },

    strict: true,
  },

  {
  type: "function" as const,

  name:
    "search_client",

  description:
    "Procura clientes por nome, NIF, email ou telefone dentro da carteira que o utilizador autenticado pode visualizar.",

  parameters: {
    type: "object",

    properties: {
      search: {
        type:
          "string",

        description:
          "Nome, NIF, email ou telefone do cliente a procurar.",
      },
    },

    required: [
      "search",
    ],

    additionalProperties:
      false,
  },

  strict: true,
},

{
  type: "function" as const,

  name:
    "get_client_policies",

  description:
    "Obtém as apólices de um cliente específico que o utilizador autenticado tem permissão para visualizar.",

  parameters: {
    type: "object",

    properties: {
      clientId: {
        type:
          "string",

        description:
          "ID interno do cliente devolvido pela ferramenta search_client.",
      },
    },

    required: [
      "clientId",
    ],

    additionalProperties:
      false,
  },

  strict: true,
},

{
  type: "function" as const,

  name:
    "get_policies_by_date",

  description:
    "Consulta as apólices emitidas numa data específica que o utilizador autenticado tem permissão para visualizar.",

  parameters: {
    type: "object",

    properties: {
      date: {
        type:
          "string",

        description:
          "Data a consultar no formato YYYY-MM-DD. Exemplo: 2026-08-24.",
      },
    },

    required: [
      "date",
    ],

    additionalProperties:
      false,
  },

  strict: true,
},


{
  type: "function" as const,
  name: "get_policies_by_period",
  description:
    "Consulta apólices emitidas num intervalo de datas, opcionalmente filtradas por companhia ou responsável.",
  parameters: {
    type: "object",
    properties: {
      from: {
        type: "string",
        description:
          "Data inicial em YYYY-MM-DD.",
      },
      to: {
        type: "string",
        description:
          "Data final em YYYY-MM-DD.",
      },
      company: {
        type: ["string", "null"],
        description:
          "Companhia específica ou null.",
      },
      responsibleId: {
        type: ["string", "null"],
        description:
          "ID interno do responsável ou null.",
      },
    },
    required: [
      "from",
      "to",
      "company",
      "responsibleId",
    ],
    additionalProperties: false,
  },
  strict: true,
},

{
  type: "function" as const,
  name: "get_upcoming_renewals",
  description:
    "Consulta apólices cuja renovação ocorre num intervalo de datas.",
  parameters: {
    type: "object",
    properties: {
      from: {
        type: "string",
      },
      to: {
        type: "string",
      },
    },
    required: [
      "from",
      "to",
    ],
    additionalProperties: false,
  },
  strict: true,
},

{
  type: "function" as const,
  name: "get_production_summary",
  description:
    "Calcula produção num período: número de apólices, prémio total, distribuição por companhia e responsável.",
  parameters: {
    type: "object",
    properties: {
      from: {
        type: "string",
      },
      to: {
        type: "string",
      },
    },
    required: [
      "from",
      "to",
    ],
    additionalProperties: false,
  },
  strict: true,
},

{
  type: "function" as const,
  name: "compare_production_periods",
  description:
    "Compara a produção entre dois períodos.",
  parameters: {
    type: "object",
    properties: {
      firstFrom: {
        type: "string",
      },
      firstTo: {
        type: "string",
      },
      secondFrom: {
        type: "string",
      },
      secondTo: {
        type: "string",
      },
    },
    required: [
      "firstFrom",
      "firstTo",
      "secondFrom",
      "secondTo",
    ],
    additionalProperties: false,
  },
  strict: true,
},

{
  type: "function" as const,
  name: "get_unassigned_policies",
  description:
    "Obtém apólices ainda sem responsável associado no painel.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  strict: true,
},

{
  type: "function" as const,
  name: "get_client_details",
  description:
    "Obtém os dados disponíveis de um cliente específico depois de ele ter sido identificado por search_client.",
  parameters: {
    type: "object",
    properties: {
      clientId: {
        type: "string",
      },
    },
    required: [
      "clientId",
    ],
    additionalProperties: false,
  },
  strict: true,
},

{
  type: "function" as const,

  name:
    "get_management_overview",

  description:
    "Obtém um resumo executivo da carteira: produção de hoje, produção do mês, prémios, companhia líder, responsável líder e renovações dos próximos 7 dias. Usa esta ferramenta para perguntas como 'o que preciso de saber hoje?', 'resume-me o dia', 'como está este mês?' ou pedidos gerais de resumo da carteira.",

  parameters: {
    type: "object",

    properties: {},

    additionalProperties:
      false,
  },

  strict: true,
},

{
  type: "function" as const,

  name:
    "get_client_360",

  description:
    "Obtém uma visão completa de um cliente já identificado: dados pessoais disponíveis, apólices, companhias, ramos, prémio total, prémio médio, próxima renovação, apólice de maior prémio e responsáveis. Usa para pedidos como 'resume este cliente', 'quanto vale este cliente?', 'qual a próxima renovação?' ou uma visão geral do cliente.",

  parameters: {
    type: "object",

    properties: {
      clientId: {
        type:
          "string",

        description:
          "ID interno do cliente obtido através de search_client.",
      },
    },

    required: [
      "clientId",
    ],

    additionalProperties:
      false,
  },

  strict: true,
},

{
  type: "function" as const,

  name:
    "get_client_opportunities",

  description:
    "Analisa oportunidades comerciais de cross-sell para um cliente específico com base nos ramos que já possui, valor da carteira e proximidade das renovações. O clientId deve ser obtido através de search_client.",

  parameters: {
    type: "object",

    properties: {
      clientId: {
        type:
          "string",

        description:
          "ID interno do cliente obtido através de search_client.",
      },
    },

    required: [
      "clientId",
    ],

    additionalProperties:
      false,
  },

  strict: true,
},
];

export async function runAiAgent(
  message: string,
  previousResponseId?: string,
) {
  const context =
    await getAiUserContext();

 const instructions = `
És o assistente interno de uma plataforma de mediação de seguros.

Contexto do utilizador:
- Nome: ${context.fullName}
- Função: ${context.role}
- Data atual em Portugal: ${context.today}

OBJETIVO
Ajuda o utilizador a consultar e analisar a sua carteira através das ferramentas disponíveis.

ESTILO DE RESPOSTA
- Responde de forma curta, rápida e objetiva.
- Dá primeiro a resposta direta à pergunta.
- Evita explicações longas.
- Não repitas a pergunta do utilizador.
- Não apresentes listas grandes quando uma frase for suficiente.
- Não expliques quais ferramentas utilizaste.
- Não expliques limitações técnicas, exceto se forem necessárias para responder.
- Não termines todas as respostas com sugestões, opções ou perguntas adicionais.
- Não digas "Posso também..." a menos que seja realmente útil.
- Para perguntas simples, responde em 1 ou 2 frases.
- Para perguntas que pedem apenas um número, responde com o número e o contexto necessário.
- Se o utilizador cumprimentar, responde brevemente ao cumprimento e responde imediatamente à pergunta.
- Usa listas ou tabelas apenas quando existirem vários resultados que beneficiem desse formato.
- Nunca transformes uma resposta simples num relatório.

EXEMPLOS DE ESTILO

Utilizador:
"Olá, quantas apólices foram emitidas hoje?"

Resposta ideal:
"Olá Joaquim! Hoje foram emitidas 12 apólices."

Utilizador:
"Quantas foram emitidas dia 24?"

Resposta ideal:
"No dia 24/08/2026 foram emitidas 37 apólices."

Utilizador:
"E ontem?"

Resposta ideal:
"Ontem foram emitidas 18 apólices."

Utilizador:
"Qual foi a companhia com mais produção este mês?"

Resposta ideal:
"A Fidelidade lidera este mês, com 42 apólices e 18.430 € de prémio."

Utilizador:
"Que apólices tem o João Silva?"

Resposta ideal:
"O João Silva tem 2 apólices: Automóvel na Fidelidade e Multirriscos na Allianz."

REGRAS FUNDAMENTAIS
- Responde sempre em português de Portugal.
- Nunca inventes dados.
- Sempre que uma pergunta envolver dados do CRM, usa as ferramentas.
- Só afirmes dados devolvidos pelas ferramentas.
- Nunca inventes ferramentas ou capacidades.
- Nunca digas que podes contactar suporte, enviar emails, gerar ficheiros ou executar ações para as quais não existe uma ferramenta.
- Nunca peças ao utilizador dados que uma ferramenta consiga descobrir.
- Respeita sempre as permissões e a loja do utilizador.

DATAS
- A data atual é ${context.today}.
- Interpreta "hoje", "ontem", "este mês", "mês passado" e expressões semelhantes relativamente à data atual.
- Para datas específicas usa get_policies_by_date.
- Para intervalos usa get_policies_by_period.
- Para renovações usa get_upcoming_renewals.

CLIENTES
- Usa search_client para procurar nome, NIF, email ou telefone.
- Se existir uma correspondência inequívoca, continua diretamente para get_client_policies ou get_client_details.
- Se existirem vários clientes plausíveis, pede apenas a informação mínima necessária para distinguir o cliente.
- Nunca assumes a identidade de um cliente quando existe ambiguidade.

APÓLICES
- Podes informar companhia, número da apólice, produto, ramo, prémio, emissão, início, renovação, estado e responsável.
- Para uma data usa get_policies_by_date.
- Para um período usa get_policies_by_period.
- Para apólices sem associação usa get_unassigned_policies.

PRODUÇÃO
- Usa get_production_summary para totais e distribuições por companhia ou responsável.
- Usa compare_production_periods para comparar períodos.
- Quando o utilizador disser "produção", considera número de apólices e prémio total, salvo indicação diferente.

RENOVAÇÕES
- Usa get_upcoming_renewals para perguntas sobre renovações futuras ou dentro de um período.

CONTEXTO DA CONVERSA
- Mantém o contexto das mensagens anteriores.
- "ele", "ela", "dele", "dessas", "essas", "e ontem?", "e dia 24?", "e da Allianz?" devem ser interpretados usando a conversa anterior quando a referência for clara.
- Não voltes a pedir informação que o utilizador já forneceu na conversa.

VISÃO 360º DO CLIENTE
- Para pedidos de resumo, visão geral, valor da carteira, próxima renovação, companhias, ramos ou análise completa de um cliente, usa get_client_360.
- Se só tiveres o nome, NIF, email ou telefone, usa primeiro search_client para obter o clientId.
- Se search_client devolver exatamente um cliente claramente correspondente, continua automaticamente para get_client_360. Não peças confirmação desnecessária.
- Se existirem vários clientes plausíveis, pede ao utilizador para escolher.
- Não mostres IDs internos ao utilizador.
- Não despejes todos os campos devolvidos pela ferramenta.
- Resume apenas a informação relevante para a pergunta.
- Se o utilizador pedir "resume o cliente", responde em no máximo 3 ou 4 linhas.

OPORTUNIDADES COMERCIAIS
- Para perguntas sobre oportunidades comerciais, cross-sell ou produtos que possam ser analisados para um cliente, usa get_client_opportunities.
- Se o utilizador fornecer apenas nome, NIF, email ou telefone, usa primeiro search_client para obter o clientId.
- Se existir uma única correspondência clara, continua automaticamente para get_client_opportunities.
- Não peças confirmação desnecessária.
- As oportunidades são potenciais oportunidades comerciais, não necessidades confirmadas do cliente.
- Nunca afirmes que o cliente precisa, quer ou deve contratar determinado seguro.
- Quando existirem oportunidades, apresenta primeiro a de maior score.
- Não mostres o score técnico a menos que o utilizador o peça.
- Mantém a resposta curta e comercialmente útil.

RESUMO EXECUTIVO
- Quando o utilizador perguntar "o que preciso de saber hoje?", "resume-me o dia", "como está a carteira?", "como estamos este mês?" ou fizer uma pergunta geral sobre o estado da carteira, usa get_management_overview.
- Apresenta apenas os pontos mais relevantes.
- Não despejes todos os dados devolvidos pela ferramenta.
- Para um resumo normal, responde em no máximo 3 a 5 linhas curtas.
- Destaca números importantes.
- Não inventes problemas ou alertas que não estejam presentes nos dados.
`;
  let response =
  await openai.responses.create({
    model:
      "gpt-5-mini",

    instructions,

    input:
      message,

    previous_response_id:
      previousResponseId,

    tools,

    tool_choice:
      "auto",
  });

  while (true) {
    const calls =
      response.output.filter(
        (item) =>
          item.type ===
          "function_call",
      );

    if (
      calls.length === 0
    ) {
      return {
        answer:
          response.output_text,

        responseId:
          response.id,
      };
    }

    const toolOutputs = [];

    for (const call of calls) {
  let result:
    unknown;

  const args =
    call.arguments
      ? JSON.parse(
          call.arguments,
        )
      : {};

  switch (call.name) {
    case "get_policies_issued_today":
      result =
        await getPoliciesIssuedToday(
          context,
        );

      break;

    case "search_client":
      result =
        await searchClient(
          context,
          {
            search:
              String(
                args.search ??
                "",
              ),
          },
        );

      break;

    case "get_client_policies":
      result =
        await getClientPolicies(
          context,
          {
            clientId:
              String(
                args.clientId ??
                "",
              ),
          },
        );

      break;

    case "get_policies_by_date":
        result =
            await getPoliciesByDate(
            context,
            {
                date:
                String(
                    args.date ?? "",
                ),
            },
            );

        break;

    case "get_policies_by_period":
    result =
        await getPoliciesByPeriod(
        context,
        {
            from:
            String(
                args.from ?? "",
            ),

            to:
            String(
                args.to ?? "",
            ),

            company:
            args.company
                ? String(
                    args.company,
                )
                : null,

            responsibleId:
            args.responsibleId
                ? String(
                    args.responsibleId,
                )
                : null,
        },
        );

    break;

    case "get_upcoming_renewals":
    result =
        await getUpcomingRenewals(
        context,
        {
            from:
            String(
                args.from ?? "",
            ),

            to:
            String(
                args.to ?? "",
            ),
        },
        );

    break;

    case "get_production_summary":
    result =
        await getProductionSummary(
        context,
        {
            from:
            String(
                args.from ?? "",
            ),

            to:
            String(
                args.to ?? "",
            ),
        },
        );

    break;

    case "compare_production_periods":
    result =
        await compareProductionPeriods(
        context,
        {
            firstFrom:
            String(
                args.firstFrom ?? "",
            ),

            firstTo:
            String(
                args.firstTo ?? "",
            ),

            secondFrom:
            String(
                args.secondFrom ?? "",
            ),

            secondTo:
            String(
                args.secondTo ?? "",
            ),
        },
        );

    break;

    case "get_unassigned_policies":
    result =
        await getUnassignedPolicies(
        context,
        );

    break;

    case "get_client_details":
    result =
        await getClientDetails(
        context,
        {
            clientId:
            String(
                args.clientId ?? "",
            ),
        },
        );

    break;

        case "get_management_overview":
    result =
        await getManagementOverview(
        context,
        );

    break;

    case "get_client_360":
    result =
        await getClient360(
        context,
        {
            clientId:
            String(
                args.clientId ?? "",
            ),
        },
        );

    break;


    case "get_client_opportunities":
        result =
            await getClientOpportunities(
            context,
            {
                clientId:
                String(
                    args.clientId ?? "",
                ),
            },
            );

        break;

    default:
      result = {
        error:
          `Ferramenta desconhecida: ${call.name}`,
      };
  }

  toolOutputs.push({
    type:
      "function_call_output" as const,

    call_id:
      call.call_id,

    output:
      JSON.stringify(
        result,
      ),
  });
}
    response =
      await openai.responses.create({
        model:
          "gpt-5-mini",

        instructions,

        previous_response_id:
          response.id,

        input:
          toolOutputs,

        tools,
      });
  }
}