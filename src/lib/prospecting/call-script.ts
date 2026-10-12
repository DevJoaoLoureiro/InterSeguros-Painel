import { openai } from "@/lib/ai/openai";
import type { Prospect } from "@/lib/prospecting/types";

/*
 * Guião da primeira chamada a uma empresa da prospeção.
 *
 * A IA só recebe dados públicos do negócio (nome, atividade, localidade)
 * e os seguros que as regras sugeriram. Se a IA falhar, a lead guarda-se
 * na mesma com o guião base.
 */

const CALL_SCRIPT_MODEL = "gpt-5-mini";

export function fallbackCallScript(prospect: Prospect, userFirstName: string) {
  const [main, ...others] = prospect.products;

  return [
    `Bom dia, fala ${userFirstName}, da Inter Seguros. Estou a falar com o responsável da ${prospect.name}?`,
    `Trabalhamos com empresas da zona${prospect.locality ? ` de ${prospect.locality}` : ""} e ligo para saber quem trata dos vossos seguros.`,
    `Quando renova o vosso seguro de ${main.toLowerCase()}? Posso fazer uma comparação sem compromisso${others.length ? ` e ver também ${others.join(" e ").toLowerCase()}` : ""}.`,
    "Qual é a melhor altura para lhe enviar a proposta ou voltar a ligar?",
  ].join("\n");
}

export async function generateCallScript(prospect: Prospect, userFirstName: string) {
  const instructions = `
És um assistente comercial de uma mediadora de seguros portuguesa (Inter Seguros).
Escreve o guião da PRIMEIRA chamada telefónica a uma empresa que ainda não nos conhece.

FORMATO
- 4 linhas curtas, uma por passo: abertura, motivo da chamada, pergunta, fecho.
- Máximo 600 caracteres no total. Texto simples, sem títulos, sem marcadores e sem emojis.
- Quem liga é ${userFirstName}, da Inter Seguros. Trata o interlocutor por "o senhor/a senhora" ou de forma neutra.

REGRAS
- Fala de UM seguro só: o primeiro de "seguros". Os restantes podem ser mencionados numa frase curta no fim.
- Não sabemos que seguros a empresa tem. NUNCA afirmes que não tem ou que precisa: PERGUNTA quem trata dos seguros e quando renovam.
- Propõe uma comparação sem compromisso. Nunca inventes preços, descontos, coberturas ou poupanças.
- Adapta o motivo à atividade do negócio (ex.: oficina, restaurante), sem exageros.
- Português de Portugal.
`;

  try {
    const response = await openai.responses.create({
      model: CALL_SCRIPT_MODEL,
      reasoning: { effort: "low" },
      instructions,
      input: JSON.stringify({
        empresa: prospect.name,
        atividade: prospect.activity,
        localidade: prospect.locality,
        seguros: prospect.products,
      }),
    });

    return response.output_text.trim() || fallbackCallScript(prospect, userFirstName);
  } catch (error) {
    console.error("[PROSPEÇÃO] Guião por IA falhou:", error);
    return fallbackCallScript(prospect, userFirstName);
  }
}
