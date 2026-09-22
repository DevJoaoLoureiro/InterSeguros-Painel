const agenteNr = process.env.ZURICH_AGENTE_NR;
const username = process.env.ZURICH_USERNAME;
const password = process.env.ZURICH_PASSWORD;
const token = process.env.ZURICH_TOKEN;

console.log({
  agenteNr: Boolean(agenteNr),
  username: Boolean(username),
  password: Boolean(password),
  token: Boolean(token),
  tokenLength: token?.length ?? 0,
});

if (!agenteNr || !username || !password || !token) {
  throw new Error("Variáveis Zurich em falta");
}

console.log(
  "Este teste precisa de Token1 e Token2 já transformados pelo algoritmo Zurich.",
);