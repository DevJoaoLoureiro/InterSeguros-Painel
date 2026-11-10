import OpenAI from "openai";

// Criado só na 1.ª utilização: no build (Cloudflare) os segredos não
// existem e `new OpenAI()` sem chave rebenta logo ao importar.
let client: OpenAI | null = null;

function getOpenAI() {
  return (client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
}

export const openai = {
  get responses() {
    return getOpenAI().responses;
  },
};
