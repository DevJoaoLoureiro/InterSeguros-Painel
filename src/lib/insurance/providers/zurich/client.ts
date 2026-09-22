// =====================================================
// ZURICH MYWEBSERVICES - CLIENT
// =====================================================
//
// Documentação: "Documento Funcional MyWebServices" v2.9
//
// Autenticação:
// - Basic Auth (Nome de Utilizador + Palavra-Chave definida
//   na ativação do token, NÃO a password de login do MyZurich)
// - + Token1/Token2 (derivados do token de 22 caracteres,
//   através do algoritmo de "unscramble" descrito no Anexo 1)
//
// SUPORTE A MÚLTIPLAS CONTAS:
// A Zurich não distingue "loja" nos dados que devolve — cada
// loja física tem a sua própria conta MyZurich (AgenteNr,
// utilizador, password, token próprios). Por isso, tal como a
// Prévoir usa códigos diferentes por loja, aqui integramos uma
// conta por loja e sabemos a loja pela CONTA usada na chamada,
// não pelos dados devolvidos.
//
// Se não passares "account" a nenhuma função, usa-se a conta
// "default" lida das env vars de sempre (ZURICH_AGENTE_NR, etc.)
// — mantém tudo o que já testámos a funcionar sem alterações.
//
// TOKEN: SÓ DO ENV, SEM RENOVAÇÃO
// O utilizador/token Zurich é PARTILHADO por vários CRMs. Emitir um
// token novo (CriarNovoToken) pode anular o token que os outros
// usam. Por isso este client lê o token SEMPRE de account.token
// (ZURICH_TOKEN, ou o campo "token" de cada entrada de
// ZURICH_ACCOUNTS), não o guarda nem o lê da BD e nunca o renova
// sozinho. Se a Zurich rejeitar o token, o erro sobe e o token é
// atualizado no env, de forma coordenada com os outros CRMs.
// =====================================================

import { sanitizeZurichText } from "./log-safety";

// -----------------------------------------------------
// CONTAS (uma por loja)
// -----------------------------------------------------

export type ZurichAccount = {
  /** Identificador curto e estável desta conta (ex: "riomau"). */
  key: string;
  agenteNr: string;
  username: string;
  password: string;
  /** Token inicial (de arranque) — depois passa a viver na BD. */
  token: string;
  /**
   * Código a usar em store_external_refs para resolver a loja
   * desta conta. Por convenção, o próprio AgenteNr já chega,
   * mas podes definir outro valor se preferires.
   */
  storeExternalCode?: string;
};

/**
 * Lê as contas configuradas em ZURICH_ACCOUNTS (JSON), uma por
 * loja. Exemplo de valor para essa env var:
 *
 * [
 *   {"key":"riomau","agenteNr":"12603","username":"12603","password":"...","token":"...","storeExternalCode":"12603"},
 *   {"key":"braga","agenteNr":"XXXXX","username":"XXXXX","password":"...","token":"...","storeExternalCode":"XXXXX"},
 *   {"key":"balazar","agenteNr":"YYYYY","username":"YYYYY","password":"...","token":"...","storeExternalCode":"YYYYY"}
 * ]
 *
 * Se ZURICH_ACCOUNTS não estiver definida, cai para o modo de
 * conta única (compatível com tudo o que já tínhamos).
 */
export function getZurichAccounts(): ZurichAccount[] {
  const raw = process.env.ZURICH_ACCOUNTS;

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as ZurichAccount[];

      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("ZURICH_ACCOUNTS deve ser um array não vazio.");
      }

      return parsed;
    } catch (err) {
      throw new Error(
        `ZURICH_ACCOUNTS inválido (deve ser JSON válido): ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  // Modo de conta única (compatibilidade com o que já tínhamos).
  const agenteNr = process.env.ZURICH_AGENTE_NR;
  const username = process.env.ZURICH_USERNAME;
  const password = process.env.ZURICH_PASSWORD;
  const token = process.env.ZURICH_TOKEN;

  if (!agenteNr || !username || !password || !token) {
    throw new Error(
      "Nem ZURICH_ACCOUNTS nem as env vars de conta única (ZURICH_AGENTE_NR/ZURICH_USERNAME/ZURICH_PASSWORD/ZURICH_TOKEN) estão configuradas.",
    );
  }

  return [
    {
      key: "default",
      agenteNr,
      username,
      password,
      token,
      storeExternalCode: agenteNr,
    },
  ];
}

// -----------------------------------------------------
// TOKEN UNSCRAMBLE (Anexo 1 do documento funcional)
// -----------------------------------------------------

type TokenOperation = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M";

function mix(token: string): string {
  const half = token.length / 2;
  const token1 = token.substring(0, half);
  const token2 = token.substring(half, half + half);

  let transformed = "";

  for (let i = 0; i < token1.length; i++) {
    transformed += token1[i];
    transformed += token2[i];
  }

  return transformed;
}

function invert(token: string): string {
  let transformed = "";

  for (let i = 0; i < token.length; i++) {
    transformed += token[token.length - i - 1];
  }

  return transformed;
}

function invertHalf(token: string): string {
  const half = token.length / 2;

  return (
    invert(token.substring(0, half)) +
    invert(token.substring(half, half + half))
  );
}

function swapPairs(token: string): string {
  let transformed = "";

  for (let i = 0; i < token.length; i += 2) {
    transformed += token[i + 1];
    transformed += token[i];
  }

  return transformed;
}

type TokenTransform = (token: string) => string;

// Tabela de Operações (secção 3.3.2 do documento):
// cada letra aplica 2 transformações, pela ordem indicada.
const TOKEN_OPERATIONS: Record<TokenOperation, [TokenTransform, TokenTransform]> = {
  A: [mix, mix],
  B: [swapPairs, mix],
  C: [invert, mix],
  D: [invertHalf, mix],
  E: [mix, swapPairs],
  F: [invert, swapPairs],
  G: [invertHalf, swapPairs],
  H: [mix, invert],
  I: [swapPairs, invert],
  J: [invertHalf, invert],
  K: [mix, invertHalf],
  L: [swapPairs, invertHalf],
  M: [invert, invertHalf],
};

/**
 * Recebe o token de 22 caracteres devolvido pelo MyZurich
 * (20 caracteres de GUID + 1 letra de operação + 1 dígito
 * de posição de separação) e devolve as duas partes
 * (Token1, Token2) que devem ser enviadas em cada chamada
 * ao webservice.
 */
export function splitZurichToken(
  fullToken: string,
): { token1: string; token2: string } {
  if (fullToken.length !== 22) {
    throw new Error(
      `Token Zurich inválido: esperado 22 caracteres, recebido ${fullToken.length}.`,
    );
  }

  let guid = fullToken.substring(0, 20);

  const operationLetter = fullToken
    .substring(20, 21)
    .toUpperCase() as TokenOperation;

  const separationPosition = parseInt(fullToken.substring(21, 22), 10);

  const operations = TOKEN_OPERATIONS[operationLetter];

  if (!operations) {
    throw new Error(
      `Operação de token Zurich desconhecida: "${operationLetter}".`,
    );
  }

  if (Number.isNaN(separationPosition)) {
    throw new Error(
      `Posição de separação do token Zurich inválida: "${fullToken.substring(21, 22)}".`,
    );
  }

  const [firstOp, secondOp] = operations;

  guid = firstOp(guid);
  guid = secondOp(guid);

  let token1 = "";
  let token2 = "";

  for (let i = 0; i < guid.length; i++) {
    if (i >= separationPosition && i < separationPosition + 10) {
      token1 += guid[i];
    } else {
      token2 += guid[i];
    }
  }

  return { token1, token2 };
}

// -----------------------------------------------------
// CONFIG (ambiente UAT/PROD, comum a todas as contas)
// -----------------------------------------------------

type ZurichEnv = "uat" | "prod";

function getUrls() {
  const env = (process.env.ZURICH_ENV || "uat").toLowerCase() as ZurichEnv;

  return env === "prod"
    ? {
        token: "https://myzurich.zurich.com.pt/ZurichServicos/rest/ZurichServicosAPI/",
        consultas: "https://myzurich.zurich.com.pt/ZurichServicos/rest/InfoAgente/",
        cobrancas: "https://myzurich.zurich.com.pt/ZurichServicos/rest/Cobrancas/",
      }
    : {
        token: "https://uat-myzurich-pt.zurich.com/ZurichServicos/rest/ZurichServicosAPI/",
        consultas: "https://uat-myzurich-pt.zurich.com/ZurichServicos/rest/InfoAgente/",
        cobrancas: "https://uat-myzurich-pt.zurich.com/ZurichServicos/rest/Cobrancas/",
      };
}

/**
 * Resolve a conta a usar: a que for passada explicitamente, ou
 * a "default" (modo de conta única, env vars de sempre).
 */
function resolveAccount(account?: ZurichAccount): ZurichAccount {
  if (account) {
    return account;
  }

  const accounts = getZurichAccounts();
  const defaultAccount = accounts.find((a) => a.key === "default") ?? accounts[0];

  return defaultAccount;
}

// -----------------------------------------------------
// TOKEN (SÓ DO ENV; SEM RENOVAÇÃO NEM PERSISTÊNCIA)
// -----------------------------------------------------
//
// O token vem de account.token e mais nenhum sítio: nada de BD
// (a tabela integration_tokens já não é usada por este client) e
// nada de renovação automática. Ver o cabeçalho do ficheiro.

const cachedTokenParts = new Map<
  string,
  { token: string; parts: { token1: string; token2: string } }
>();

async function getTokenParts(
  account: ZurichAccount,
): Promise<{ token1: string; token2: string }> {
  const token = account.token;

  if (typeof token !== "string" || token.trim() === "") {
    throw new Error(
      `Token Zurich em falta para a conta ${account.key} (ZURICH_TOKEN ou o campo "token" da entrada em ZURICH_ACCOUNTS).`,
    );
  }

  const cached = cachedTokenParts.get(account.key);

  if (cached && cached.token === token) {
    return cached.parts;
  }

  const parts = splitZurichToken(token);
  cachedTokenParts.set(account.key, { token, parts });

  return parts;
}

// -----------------------------------------------------
// HTTP HELPER
// -----------------------------------------------------

type ZurichBaseOutput = {
  Successo?: boolean;
  Sucesso?: boolean;
  CodigoErro?: number;
  Mensagem?: string;
};

async function zurichRequest<T>(
  baseUrl: string,
  path: string,
  extraParams: Record<string, string | number | undefined>,
  init?: { method?: "GET" | "POST"; body?: unknown },
  agenteParamName: string = "AgenteNr",
  // Reservado: já não há repetição automática (ver TOKEN no cabeçalho).
  // Mantém-se só para não mudar a posição dos argumentos dos chamadores.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _isRetry: boolean = false,
  account?: ZurichAccount,
): Promise<T> {
  const resolvedAccount = resolveAccount(account);
  const { agenteNr, username, password } = resolvedAccount;
  const { token1, token2 } = await getTokenParts(resolvedAccount);

  const params = new URLSearchParams({
    [agenteParamName]: agenteNr,
    Token1: token1,
    Token2: token2,
  });

  for (const [key, value] of Object.entries(extraParams)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }

  const basicAuth = Buffer.from(`${username}:${password}`).toString(
    "base64",
  );

  const startedAt = Date.now();

  const response = await fetch(
    `${baseUrl.replace(/\/+$/, "")}/${path}?${params.toString()}`,
    {
      method: init?.method || "GET",

      headers: {
        Authorization: `Basic ${basicAuth}`,
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },

      body: init?.body ? JSON.stringify(init.body) : undefined,

      cache: "no-store",
    },
  );

  const durationMs = Date.now() - startedAt;

  if (!response.ok) {
    // O corpo NÃO é lido nem incluído: pode repetir o URL do pedido
    // (com Token1/Token2 e AgenteNr) ou trazer dados pessoais.
    await response.body?.cancel().catch(() => undefined);

    console.warn("[Zurich] Request falhou", {
      operation: path,
      account: resolvedAccount.key,
      status: response.status,
      durationMs,
    });

    throw new Error(
      `Erro Zurich em ${path} (${response.status}) [conta ${resolvedAccount.key}]`,
    );
  }

  const data = (await response.json()) as T;

  // Verificação de sucesso "solta": a maioria dos endpoints usa
  // "Successo"/"Sucesso" (booleano) no topo, mas alguns (ex:
  // AlterarMetodoCobrancaOutput) fogem a esse padrão na doc.
  // Por isso não fazemos o generic depender de ZurichBaseOutput.
  const raw = data as Record<string, unknown>;
  const sucesso = raw.Successo ?? raw.Sucesso;
  const codigoErro = raw.CodigoErro;

  // Log operacional SEGURO: nunca a resposta (pode ter token, NIF,
  // IBAN, ficheiros inteiros em base64) nem os parâmetros do pedido.
  console.log("[Zurich] Request concluído", {
    operation: path,
    account: resolvedAccount.key,
    status: response.status,
    durationMs,
    success:
      sucesso !== false && (codigoErro === undefined || codigoErro === 0),
    code: codigoErro ?? null,
  });

  // Alguns erros (Anexo 3) vêm só com CodigoErro + Mensagem,
  // sem o campo Successo/Sucesso — por isso tratamos qualquer
  // CodigoErro truthy (não-zero) como falha também.
  if (sucesso === false || (codigoErro !== undefined && codigoErro !== 0)) {
    // "Código N" tem de se manter tal e qual: o sync reconhece os
    // códigos 6/7 ("sem ficheiro/dados") por esse texto. A Mensagem
    // é redigida porque pode repetir NIF, IBAN ou outros dados.
    throw new Error(
      `Zurich devolveu erro em ${path} (Código ${codigoErro}) [conta ${resolvedAccount.key}]: ${sanitizeZurichText(String(raw.Mensagem))}${
        codigoErro === 1 || codigoErro === 5
          ? " [token rejeitado: a renovação automática está desativada porque o token é partilhado; atualiza o token no env]"
          : ""
      }`,
    );
  }

  return data;
}

// -----------------------------------------------------
// GERAR / RENOVAR TOKEN
// -----------------------------------------------------

export type CriarNovoTokenOutput = ZurichBaseOutput & {
  Token: string;
};

/**
 * DESATIVADO POR OMISSÃO. Emite um token novo na Zurich, o que pode
 * ANULAR o token que os outros CRMs partilham. Nada neste projeto o
 * chama automaticamente. Só corre com ZURICH_ALLOW_TOKEN_ISSUE=1, de
 * forma deliberada e coordenada; o token devolvido NÃO é guardado em
 * lado nenhum: tem de ser copiado manualmente para o env de todos os
 * consumidores.
 */
export async function criarNovoTokenZurich(
  account?: ZurichAccount,
): Promise<CriarNovoTokenOutput> {
  if (process.env.ZURICH_ALLOW_TOKEN_ISSUE !== "1") {
    throw new Error(
      "Emitir tokens Zurich está desativado: o utilizador/token é partilhado por vários CRMs e uma emissão nova pode anular o token dos outros. Só com ZURICH_ALLOW_TOKEN_ISSUE=1, de forma deliberada e coordenada.",
    );
  }

  const urls = getUrls();

  return zurichRequest<CriarNovoTokenOutput>(
    urls.token,
    "CriarNovoToken",
    {},
    undefined,
    "ConsumidorID",
    false,
    account,
  );
}

// -----------------------------------------------------
// SERVIÇO DE CONSULTA DE CARTEIRA
// -----------------------------------------------------

export type ZurichApolice = {
  NumeroApolice: string;
  Ramo: string;
  LinhaNegocioCod: string;
  LinhaNegocioDesc: string;
  NumeroFrota: string;
  NomeFrota: string;
  DataInicio: string;
  DataCriacao: string;
  DataCancelamento: string;
  DataFim: string;
  TipoPremio: string;
  PremioApolice: number;
  FraccionamentoCod: string;
  Fraccionamento: string;
  IBAN: string;
  EstadoCod: string;
  Estado: string;
  NIF: string;
  IDCliente: string;
  AgenteAngariador: string;
  AgenteCobrador: string;
  AniversarioApolice: string;
  [key: string]: unknown;
};

export async function obterApolicePorNr(
  apoliceNr: string,
  account?: ZurichAccount,
): Promise<ZurichBaseOutput & { DadosApolice: ZurichApolice }> {
  const urls = getUrls();

  return zurichRequest(
    urls.consultas,
    "ObterApolicePorNr",
    { ApoliceNr: apoliceNr },
    undefined,
    undefined,
    undefined,
    account,
  );
}

export type ZurichRecibo = {
  NumRecibo: string;
  NumResumo: string;
  Ramo: string;
  TipoReciboCod: string;
  TipoRecibo: string;
  AgenteCobrador: string;
  TipoAgenteCobrador: string;
  AgenteAngariador: string;
  DataInicio: string;
  DataTermo: string;
  DataEmissao: string;
  DataPagamento: string;
  DataAnulacao: string;
  DataCriacao: string;
  DataDevolucao: string;
  CodDevolucao: string;
  MotivoDevolucao: string;
  DataReenvio: string;
  ValorSeguro: number;
  PremioComercial: number;
  PremioSimples: number;
  ValorEncargos: number;
  ValorFracionamento: number;
  ValorApoliceAta: number;
  ValorCartaVerde: number;
  TotalRecibo: number;
  ComissaoCobranca: number;
  ComissaoAngariacao: number;
  SituacaoCod: string;
  Situacao: string;
  NumeroApolice: string;
  NIF: string;
  IDCliente: string;
  NumeroBoletim: string;
  SituacaoBoletimCod: string;
  SituacaoBoletim: string;
  AgenteCobradorBoletim: string;
  DataInicioBoletim: string;
  DataFechoBoletim: string;
  DataContabilizacaoBoletim: string;
  ValorRecebidoBoletim: number;
  DescricaoBoletim: string;
  UtilizadorFechouBoletim: string;
  // Apenas preenchidos pela Médis:
  CustoApolice?: number;
  ValorISelo?: number;
  ValorINEM?: number;
  [key: string]: unknown;
};

export async function obterReciboPorNr(
  reciboNr: string,
  account?: ZurichAccount,
): Promise<ZurichBaseOutput & { DadosRecibo: ZurichRecibo }> {
  const urls = getUrls();

  return zurichRequest(
    urls.consultas,
    "ObterReciboPorNr",
    { ReciboNr: reciboNr },
    undefined,
    undefined,
    undefined,
    account,
  );
}

export type ZurichCliente = {
  IDCliente: string;
  NomeCliente: string;
  Morada: string;
  Localidade: string;
  CodigoPostal: string;
  OrdemPostal?: string;
  LocalidadePostal?: string;
  Pais: string;
  NIF: string;
  Telefone: string;
  Telemovel: string;
  Fax: string;
  Email: string;
  NCartaoIdentificacao: string;
  DataNascimento: string;
  Tipo: string;
  Sexo: string;
  CodigoAtividade: string;
  NomeAtividade: string;
  EstadoCivil: string;
  Filhos: string;
  NIB: string;
  CodSituacao: string;
  Situacao: string;
  DataUltimaAlteracao: string;
  Zurich4You: string;
  RecDocPorEmail: string;
  DataAtualizacaoTipoCliente: string;
  [key: string]: unknown;
};

/**
 * Pelo menos um dos dois parâmetros (clienteNif / clienteId)
 * deve ser fornecido. NOTA: "DadosCliente" vem como ARRAY na
 * resposta real da API (a doc sugere um objeto aninhado, mas
 * não é isso que a Zurich devolve).
 */
export async function obterClientePorIdNif(
  params: {
    clienteNif?: string;
    clienteId?: string;
  },
  account?: ZurichAccount,
): Promise<ZurichBaseOutput & { DadosCliente: ZurichCliente[] }> {
  const urls = getUrls();

  return zurichRequest(
    urls.consultas,
    "ObterClientePorIDNIF",
    {
      ClienteNIF: params.clienteNif,
      ClienteID: params.clienteId,
    },
    undefined,
    undefined,
    undefined,
    account,
  );
}

export type ZurichObjeto = {
  NumeroApolice: string;
  NumeroObjeto: string;
  DescricaoObjeto: string;
  TipoObjeto: string;
  Capital: number;
  EstadoCod: string;
  Estado: string;
  Premio: number;
};

export async function obterObjetosPorNrApolice(
  apoliceNr: string,
  account?: ZurichAccount,
): Promise<ZurichBaseOutput & { ListaObjetos: ZurichObjeto[] }> {
  const urls = getUrls();

  return zurichRequest(
    urls.consultas,
    "ObterObjetosPorNrApolice",
    { ApoliceNr: apoliceNr },
    undefined,
    undefined,
    undefined,
    account,
  );
}

export type ZurichCobertura = {
  NumeroApolice: string;
  NumeroObjeto: string;
  DescricaoCobertura: string;
  Capital: number;
  Franquia: number;
  ValorFranquia: number;
  ValorMaxFranquia: number;
  NumDiasFranquia: number;
  // Apenas preenchido pela Médis:
  PeriodoCarencia?: string;
};

export async function obterCoberturasPorApolice(
  apoliceNr: string,
  account?: ZurichAccount,
): Promise<ZurichBaseOutput & { ListaCoberturas: ZurichCobertura[] }> {
  const urls = getUrls();

  return zurichRequest(
    urls.consultas,
    "ObterCoberturasPorApolice",
    { ApoliceNr: apoliceNr },
    undefined,
    undefined,
    undefined,
    account,
  );
}

export enum ZurichTipoFicheiro {
  Apolices = 1,
  Recibos = 2,
  Clientes = 3,
  ObjetosDeRisco = 4,
  Coberturas = 5,
  ApolicesMedis = 6,
  RecibosMedis = 7,
  ObjetosMedis = 8,
  CoberturasMedis = 9,
}

/**
 * Data no formato AAAA-MM-DD.
 */
export async function obterFicheiroDia(
  tipoFicheiro: ZurichTipoFicheiro,
  data: string,
  account?: ZurichAccount,
): Promise<ZurichBaseOutput & { Ficheiro: string }> {
  const urls = getUrls();

  return zurichRequest(
    urls.consultas,
    "ObterFicheiroDia",
    { TipoFicheiro: tipoFicheiro, Data: data },
    undefined,
    undefined,
    undefined,
    account,
  );
}

/**
 * Só é possível agendar ficheiros com data de início até 15 dias
 * inferior à data corrente. Datas no formato AAAA-MM-DD.
 */
export async function registarPedidoFicheiroAdhoc(
  params: {
    tipoFicheiro: ZurichTipoFicheiro;
    dataInicio: string;
    dataFim: string;
  },
  account?: ZurichAccount,
): Promise<ZurichBaseOutput & { idPedido: number }> {
  const urls = getUrls();

  return zurichRequest(
    urls.consultas,
    "RegistarPedidoFicheiroAdhoc",
    {
      TipoFicheiro: params.tipoFicheiro,
      DataInicio: params.dataInicio,
      DataFim: params.dataFim,
    },
    undefined,
    undefined,
    undefined,
    account,
  );
}

export async function obterFicheiroAdhoc(
  idFicheiro: number,
  account?: ZurichAccount,
): Promise<ZurichBaseOutput & { Ficheiro: string }> {
  const urls = getUrls();

  return zurichRequest(
    urls.consultas,
    "ObterFicheiroAdhoc",
    { idFicheiro },
    undefined,
    undefined,
    undefined,
    account,
  );
}

/**
 * O campo "Ficheiro" devolvido por ObterFicheiroDia / ObterFicheiroAdhoc
 * vem codificado em Base64. Esta função descodifica para o conteúdo
 * de texto original (assumindo que o ficheiro é texto — CSV, largura
 * fixa, etc. — e não binário real como um .zip).
 */
export function decodeZurichFicheiro(ficheiroBase64: string): string {
  return Buffer.from(ficheiroBase64, "base64").toString("utf-8");
}

// -----------------------------------------------------
// SERVIÇO DE COBRANÇAS
// -----------------------------------------------------

export type ZurichReciboParaCobrar = {
  NumeroRecibo: string;
  Talao: "N" | "S";
  NrCheque?: string;
  DataCheque?: string;
};

export type CobrarOutput = ZurichBaseOutput & {
  ListaCobrarReciboMensagem: {
    ReciboNr: string;
    Mensagem: string;
  }[];
};

export async function cobrarRecibos(
  params: {
    agenteCobradorNr: string;
    listaRecibos: ZurichReciboParaCobrar[];
  },
  account?: ZurichAccount,
): Promise<CobrarOutput> {
  const urls = getUrls();

  return zurichRequest(
    urls.cobrancas,
    "Cobrar",
    { AgenteCobradorNr: params.agenteCobradorNr },
    { method: "POST", body: params.listaRecibos },
    undefined,
    undefined,
    account,
  );
}

export type AlterarMetodoCobrancaOutput = {
  AlterarMetodoCobrancaOutput: {
    Sucesso: boolean;
    NrRecibo: string;
  }[];
  Sucesso: string;
};

export async function alterarMetodoCobranca(
  params: {
    agenteCobradorNr: string;
    listaRecibos: ZurichReciboParaCobrar[];
  },
  account?: ZurichAccount,
): Promise<AlterarMetodoCobrancaOutput> {
  const urls = getUrls();

  return zurichRequest(
    urls.cobrancas,
    "Alterar",
    { AgenteCobradorNr: params.agenteCobradorNr },
    { method: "POST", body: params.listaRecibos },
    undefined,
    undefined,
    account,
  );
}

export enum ZurichMotivoTransferencia {
  AnulacaoPorSubstituicao = "001",
  ErroDeEmissao = "003",
  ApoliceAnulada = "004",
  FaltaDePagamento = "005",
  Estornos = "009",
}

export type DevolverOutput = ZurichBaseOutput & {
  ZupisReciboBPCDevolucao: {
    NumeroReciboProcessado: string;
    Success: boolean;
    ErrorMessage: string;
    ApoliceAnulada: boolean;
    NumeroBoletim: string;
    Ramo: string;
  };
};

export async function devolverRecibo(
  params: {
    numeroRecibo: string;
    motivoTransferencia: ZurichMotivoTransferencia;
    reciboPremioSubstituicao?: string;
    talao: "N" | "S";
  },
  account?: ZurichAccount,
): Promise<DevolverOutput> {
  const urls = getUrls();

  return zurichRequest(
    urls.cobrancas,
    "Devolver",
    {},
    {
      method: "POST",
      body: {
        NumeroRecibo: params.numeroRecibo,
        MotivoTransferencia: params.motivoTransferencia,
        ReciboPremioSubstituicao: params.reciboPremioSubstituicao,
        Talao: params.talao,
      },
    },
    undefined,
    undefined,
    account,
  );
}

export async function apagarRecibo(
  reciboNr: string,
  account?: ZurichAccount,
): Promise<ZurichBaseOutput> {
  const urls = getUrls();

  return zurichRequest(
    urls.cobrancas,
    "ApagarRecibo",
    { ReciboNr: reciboNr },
    undefined,
    undefined,
    undefined,
    account,
  );
}

export async function fecharBoletim(
  params: {
    boletimNr: string;
    descricao: string;
  },
  account?: ZurichAccount,
): Promise<ZurichBaseOutput> {
  const urls = getUrls();

  return zurichRequest(
    urls.cobrancas,
    "FecharBoletim",
    { BoletimNr: params.boletimNr, Descricao: params.descricao },
    undefined,
    undefined,
    undefined,
    account,
  );
}

export type ZurichRemessa = {
  TipoRemessa: "C" | "D" | "T" | "F";
  NumeroCheque: string;
  CodigoBanco: string;
  Valor: number;
  DataCheque: string;
  NomeBanco: string;
};

export async function obterRemessa(
  boletimNr: string,
  account?: ZurichAccount,
): Promise<ZurichBaseOutput & { ListaRemessas: ZurichRemessa[] }> {
  const urls = getUrls();

  return zurichRequest(
    urls.cobrancas,
    "ObterRemessa",
    { BoletimNr: boletimNr },
    undefined,
    undefined,
    undefined,
    account,
  );
}

export type AlterarRemessasBoletimOutput = ZurichBaseOutput & {
  AlterarRemessaBoletim: {
    Sequencia: number;
    Success: boolean;
    ErrorMessage: string;
  };
};

/**
 * Este método substitui por completo as remessas existentes no
 * boletim pelas que forem enviadas aqui (não faz merge).
 * Usar ObterRemessa antes, alterar o que for preciso na
 * estrutura recebida, e reenviar tudo aqui.
 */
export async function alterarRemessasBoletim(
  params: {
    boletimNr: string;
    // Nesta operação, TipoRemessa só aceita "C" ou "T".
    listaRemessas: Omit<ZurichRemessa, "TipoRemessa"> & {
      TipoRemessa: "C" | "T";
    }[];
  },
  account?: ZurichAccount,
): Promise<AlterarRemessasBoletimOutput> {
  const urls = getUrls();

  return zurichRequest(
    urls.cobrancas,
    "AlterarRemessasBoletim",
    { BoletimNr: params.boletimNr },
    { method: "POST", body: params.listaRemessas },
    undefined,
    undefined,
    account,
  );
}

// -----------------------------------------------------
// "BUSCAR TUDO" — equivalente ao fluxo incremental da Prévoir
// -----------------------------------------------------
//
// A Zurich não tem endpoint de listagem direta; o equivalente
// ao "getPoliciesIncremental" da Prévoir é pedir o ficheiro do
// dia e descodificar/fazer parse dele (ver file-parser.ts).
//
// Nota: a Zurich só gera o primeiro ficheiro de Carteira Total
// no dia seguinte à subscrição dos serviços, e mesmo esse só
// está disponível pela página do MyZurich (não pela API). O
// import inicial completo tem de ser feito manualmente uma vez;
// a partir daí, os ficheiros diários (esta função) mantêm tudo
// sincronizado.

import {
  parseApolicesFile,
  parseRecibosFile,
  parseClientesFile,
  parseObjetosFile,
  parseCoberturasFile,
  ZurichApoliceFicheiro,
  ZurichReciboFicheiro,
  ZurichClienteFicheiro,
  ZurichObjetoFicheiro,
  ZurichCoberturaFicheiro,
} from "./file-parser";

/**
 * Log operacional SEGURO de um ficheiro do dia já lido e interpretado:
 * só o tipo, o dia, a conta e o nº de registos. Nunca o conteúdo
 * (NIF, IBAN, nomes) nem o base64 do ficheiro.
 */
function logFicheiroDoDia(
  tipoFicheiro: string,
  dia: string,
  account: ZurichAccount | undefined,
  recordCount: number,
): void {
  console.log("[Zurich] Ficheiro do dia processado", {
    tipoFicheiro,
    dia,
    account: account?.key ?? "default",
    recordCount,
  });
}

/**
 * Data no formato AAAA-MM-DD (por omissão, hoje).
 */
export async function getApolicesDoDia(
  data?: string,
  account?: ZurichAccount,
): Promise<ZurichApoliceFicheiro[]> {
  const dia = data ?? new Date().toISOString().slice(0, 10);
  const result = await obterFicheiroDia(
  ZurichTipoFicheiro.Apolices,
  dia,
  account,
);

const apolices = parseApolicesFile(result.Ficheiro);

logFicheiroDoDia("Apolices", dia, account, apolices.length);

return apolices;
}

export async function getRecibosDoDia(
  data?: string,
  account?: ZurichAccount,
): Promise<ZurichReciboFicheiro[]> {
  const dia = data ?? new Date().toISOString().slice(0, 10);
  const result = await obterFicheiroDia(
    ZurichTipoFicheiro.Recibos,
    dia,
    account,
  );
  const recibos = parseRecibosFile(result.Ficheiro);
  logFicheiroDoDia("Recibos", dia, account, recibos.length);
  return recibos;
}

export async function getClientesDoDia(
  data?: string,
  account?: ZurichAccount,
): Promise<ZurichClienteFicheiro[]> {
  const dia = data ?? new Date().toISOString().slice(0, 10);
  const result = await obterFicheiroDia(
    ZurichTipoFicheiro.Clientes,
    dia,
    account,
  );
  const clientes = parseClientesFile(result.Ficheiro);
  logFicheiroDoDia("Clientes", dia, account, clientes.length);
  return clientes;
}

export async function getObjetosDoDia(
  data?: string,
  account?: ZurichAccount,
): Promise<ZurichObjetoFicheiro[]> {
  const dia = data ?? new Date().toISOString().slice(0, 10);
  const result = await obterFicheiroDia(
    ZurichTipoFicheiro.ObjetosDeRisco,
    dia,
    account,
  );
  const objetos = parseObjetosFile(result.Ficheiro);
  logFicheiroDoDia("ObjetosDeRisco", dia, account, objetos.length);
  return objetos;
}

export async function getCoberturasDoDia(
  data?: string,
  account?: ZurichAccount,
): Promise<ZurichCoberturaFicheiro[]> {
  const dia = data ?? new Date().toISOString().slice(0, 10);
  const result = await obterFicheiroDia(
    ZurichTipoFicheiro.Coberturas,
    dia,
    account,
  );
  const coberturas = parseCoberturasFile(result.Ficheiro);
  logFicheiroDoDia("Coberturas", dia, account, coberturas.length);
  return coberturas;
}

/**
 * Busca tudo (apólices, recibos, clientes, objetos, coberturas)
 * de um dia, num único pedido lógico — útil para o teu cron
 * diário, equivalente ao que fazias com o incremental da
 * Prévoir.
 */
export async function getTudoDoDia(data?: string, account?: ZurichAccount) {
  const dia = data ?? new Date().toISOString().slice(0, 10);

  const [apolices, recibos, clientes, objetos, coberturas] =
    await Promise.all([
      getApolicesDoDia(dia, account),
      getRecibosDoDia(dia, account),
      getClientesDoDia(dia, account),
      getObjetosDoDia(dia, account),
      getCoberturasDoDia(dia, account),
    ]);

  return { apolices, recibos, clientes, objetos, coberturas };
}