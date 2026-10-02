import { createHash } from "node:crypto";

import { openai } from "@/lib/ai/openai";
import type { ClientAdvice } from "@/lib/opportunities/client-advice";

/*
 * Parte 2 da lâmpada: a IA por cima das regras.
 *
 * A IA NÃO inventa conselhos: recebe os que as regras encontraram e
 * os factos que os justificam, escolhe os mais úteis, explica porquê,
 * sugere como abordar e escreve uma mensagem para o cliente.
 *
 * Para a IA só vão factos mínimos (primeiro nome, idade, ramos,
 * prémios, datas). Nunca NIF, IBAN, CC, email, telefone ou morada.
 */

export const CLIENT_ADVICE_MODEL = "gpt-5-mini";

export type AdviceFacts = {
  cliente: {
    primeiroNome: string;
    idade: number | null;
    sexo: string | null;
    estadoCivil: string | null;
    filhos: string | null;
    profissao: string | null;
    empresa: boolean;
    clienteDesde: string | null;
  };
  apolices: {
    ramo: string | null;
    companhia: string | null;
    estado: string;
    premioAnual: number | null;
    inicio: string | null;
    renovacao: string | null;
    recibosEmAtraso: number;
    ultimoReciboDevolvido: boolean;
    variacaoPremioPct: number | null;
    seguimento: string | null;
  }[];
  conselhos: {
    key: string;
    categoria: string;
    prioridade: string;
    titulo: string;
    motivo: string;
  }[];
};

export type ClientAiAdvice = {
  resumo: string;
  prioridades: { key: string; porque: string; abordagem: string }[];
  mensagem: string;
};

/* Hash dos factos: se nada mudou, a análise guardada serve. */
export function hashFacts(facts: AdviceFacts) {
  return createHash("sha256").update(JSON.stringify(facts)).digest("hex");
}

export async function generateClientAiAdvice({
  facts,
  advice,
  userFirstName,
  today,
}: {
  facts: AdviceFacts;
  advice: ClientAdvice[];
  userFirstName: string;
  today: string;
}): Promise<ClientAiAdvice> {
  const keys = advice.map((a) => a.key);

  const instructions = `
És um assistente comercial de uma mediadora de seguros portuguesa (Inter Seguros).
Recebes FACTOS sobre um cliente e CONSELHOS já calculados por regras.
Data de hoje: ${today}.

TAREFA
1. "resumo": 1 a 2 frases sobre o cliente (relação connosco, o que tem, o que se destaca). Sem repetir a lista de apólices.
2. "prioridades": escolhe ATÉ 4 conselhos, do mais para o menos importante, usando SÓ as keys fornecidas. Para cada um:
   - "porque": 1 frase específica com os números/datas dos factos (ex.: "renova a 20/10 e o prémio subiu 8%").
   - "abordagem": 1 a 2 frases práticas — o que perguntar ou propor na conversa.
   Dá prioridade a: dinheiro em risco (recibos em atraso/devolvidos), renovações próximas com aumento, depois oportunidades.
3. "mensagem": uma mensagem curta de WhatsApp (máx. 450 caracteres) para enviar ao cliente sobre UM SÓ assunto — o conselho mais importante. Não juntes vários assuntos (uma mensagem que tenta vender três coisas não resulta). Trata-o pelo primeiro nome, tom cordial e próximo, sem emojis em excesso. Termina com uma pergunta simples que convide a responder. Assina "${userFirstName}, Inter Seguros". Se não houver conselhos, devolve "".

REGRAS
- Datas sempre no formato dd/mm/aaaa (nunca 2026-10-20). Valores em euros com vírgula decimal (ex.: 420,00 €).
- Nunca inventes dados, preços, coberturas ou descontos. Usa só os factos.
- "Não tem X connosco" NÃO quer dizer que não tenha X — pode ter noutro mediador. Sugere PERGUNTAR, nunca afirmar que precisa.
- Não menciones dados internos (keys, scores, nomes de regras).
- Português de Portugal.
`;

  const response = await openai.responses.create({
    model: CLIENT_ADVICE_MODEL,
    reasoning: { effort: "low" },
    instructions,
    input: JSON.stringify(facts),
    text: {
      format: {
        type: "json_schema",
        name: "client_advice",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            resumo: { type: "string" },
            prioridades: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  key: { type: "string", enum: keys },
                  porque: { type: "string" },
                  abordagem: { type: "string" },
                },
                required: ["key", "porque", "abordagem"],
              },
            },
            mensagem: { type: "string" },
          },
          required: ["resumo", "prioridades", "mensagem"],
        },
      },
    },
  });

  const parsed = JSON.parse(response.output_text) as ClientAiAdvice;

  // Defesa extra: só keys reais, sem repetidos, no máximo 4.
  const seen = new Set<string>();

  return {
    resumo: parsed.resumo.trim(),
    prioridades: parsed.prioridades
      .filter((p) => keys.includes(p.key) && !seen.has(p.key) && seen.add(p.key))
      .slice(0, 4),
    mensagem: parsed.mensagem.trim(),
  };
}
