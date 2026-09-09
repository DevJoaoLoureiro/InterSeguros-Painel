// =====================================================
// ZURICH - PARSER DE FICHEIROS (ObterFicheiroDia / Adhoc)
// =====================================================
//
// A Zurich não tem um endpoint de "listar tudo" via API de
// consulta direta — os dados em massa (clientes, apólices,
// recibos, objetos, coberturas) só saem via ficheiro:
//   - ObterFicheiroDia: delta de um dia específico
//   - RegistarPedidoFicheiroAdhoc + ObterFicheiroAdhoc: período à escolha
//   - Carteira Total: só pela página do MyZurich (não pela API)
//
// O campo "Ficheiro" devolvido por estes serviços vem em
// "binary data" — assumimos Base64 (padrão comum para JSON),
// e o conteúdo descodificado é texto delimitado.
//
// ⚠️ ATENÇÃO: a documentação (Anexo 4) dá a ORDEM exata dos
// campos de cada tipo de ficheiro, mas NÃO diz qual o
// delimitador usado (vírgula, ponto e vírgula, tab...).
// Assumi ";" (ponto e vírgula) porque é o mais comum em
// exports portugueses (a vírgula normal é usada como separador
// decimal nos valores monetários). ASSIM QUE TESTARES COM UM
// FICHEIRO REAL, confirma o delimitador e ajusta a constante
// DELIMITER abaixo se for diferente.
// =====================================================

const DELIMITER = ";";

function decodeZurichFile(base64Ficheiro: string): string {
  // A Zurich devolve o ficheiro em Latin-1 (ISO-8859-1), não UTF-8 —
  // confirmado ao ver "N�o Vida" em vez de "Não Vida" com utf-8.
  return Buffer.from(base64Ficheiro, "base64").toString("latin1");
}

function parseLines(fileContent: string): string[][] {
  return fileContent
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split(DELIMITER).map((cell) => cell.trim()));
}

function mapRows<T extends Record<string, string>>(
  rows: string[][],
  columns: (keyof T)[],
): T[] {
  // A Zurich inclui uma linha de cabeçalho (nomes das colunas) como
  // primeira linha do ficheiro — saltamo-la se detetada.
  const firstColumnName = String(columns[0]).toLowerCase();
  const dataRows =
    rows.length > 0 && rows[0][0]?.trim().toLowerCase() === firstColumnName
      ? rows.slice(1)
      : rows;

  return dataRows.map((row) => {
    const obj = {} as T;

    columns.forEach((col, i) => {
      obj[col] = (row[i] ?? "") as T[keyof T];
    });

    return obj;
  });
}

/**
 * Converte uma data no formato "DD-MM-AAAA HH:mm:ss" (usado nos
 * ficheiros da Zurich) para ISO, ou null se for a data-sentinela
 * "01-01-1900 00:00:00" (usada para representar "sem data").
 */
export function parseZurichFileDate(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed || trimmed.startsWith("01-01-1900")) {
    return null;
  }

  const match = trimmed.match(
    /^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/,
  );

  if (!match) {
    return null;
  }

  const [, day, month, year, hour = "00", minute = "00", second = "00"] =
    match;

  return `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
}

/**
 * Converte um valor decimal com vírgula (ex: "410,92000000000000000000")
 * para number. Devolve null se não for um número válido.
 */
export function parseZurichFileDecimal(value: string): number | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(",", ".");
  const parsed = Number(normalized);

  return Number.isNaN(parsed) ? null : parsed;
}

// -----------------------------------------------------
// 1ª Ficheiro Apólices
// -----------------------------------------------------

export type ZurichApoliceFicheiro = {
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
  DataRevalidacao: string;
  TipoPremio: string;
  PremioApolice: string;
  FraccionamentoCod: string;
  Fraccionamento: string;
  IBAN: string;
  EstadoCod: string;
  Estado: string;
  NIF: string;
  IDCliente: string;
  AgenteAngariador: string;
  AgenteCobrador: string;
};

const APOLICES_COLUMNS: (keyof ZurichApoliceFicheiro)[] = [
  "NumeroApolice",
  "Ramo",
  "LinhaNegocioCod",
  "LinhaNegocioDesc",
  "NumeroFrota",
  "NomeFrota",
  "DataInicio",
  "DataCriacao",
  "DataCancelamento",
  "DataFim",
  "DataRevalidacao",
  "TipoPremio",
  "PremioApolice",
  "FraccionamentoCod",
  "Fraccionamento",
  "IBAN",
  "EstadoCod",
  "Estado",
  "NIF",
  "IDCliente",
  "AgenteAngariador",
  "AgenteCobrador",
];

/**
 * Faz parse a partir do texto já descodificado (ex: um ficheiro
 * lido do disco, como a Carteira Total). Usa esta função quando
 * já tens o conteúdo em texto, não em Base64.
 */
export function parseApolicesFileFromText(
  content: string,
): ZurichApoliceFicheiro[] {
  const rows = parseLines(content);
  return mapRows<ZurichApoliceFicheiro>(rows, APOLICES_COLUMNS);
}

/**
 * Faz parse a partir do Base64 devolvido pela API da Zurich
 * (ObterFicheiroDia / ObterFicheiroAdhoc).
 */
export function parseApolicesFile(
  base64Ficheiro: string,
): ZurichApoliceFicheiro[] {
  const content = decodeZurichFile(base64Ficheiro);
  return parseApolicesFileFromText(content);
}

// -----------------------------------------------------
// 2ª Ficheiro Recibos
// -----------------------------------------------------

export type ZurichReciboFicheiro = {
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
  ValorSeguro: string;
  PremioComercial: string;
  PremioSimples: string;
  ValorEncargos: string;
  ValorFracionamento: string;
  ValorApoliceAta: string;
  ValorCartaVerde: string;
  TotalRecibo: string;
  ComissaoCobranca: string;
  ComissaoAngariacao: string;
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
  ValorRecebidoBoletim: string;
  DescricaoBoletim: string;
  UtilizadorFechouBoletim: string;
  // Apenas preenchidos pela Médis, mas a coluna existe sempre
  // no ficheiro (vazia quando não aplicável).
  CustoApolice: string;
  ValorISelo: string;
  ValorINEM: string;
};

const RECIBOS_COLUMNS: (keyof ZurichReciboFicheiro)[] = [
  "NumRecibo",
  "NumResumo",
  "Ramo",
  "TipoReciboCod",
  "TipoRecibo",
  "AgenteCobrador",
  "TipoAgenteCobrador",
  "AgenteAngariador",
  "DataInicio",
  "DataTermo",
  "DataEmissao",
  "DataPagamento",
  "DataAnulacao",
  "DataCriacao",
  "DataDevolucao",
  "CodDevolucao",
  "MotivoDevolucao",
  "DataReenvio",
  "ValorSeguro",
  "PremioComercial",
  "PremioSimples",
  "ValorEncargos",
  "ValorFracionamento",
  "ValorApoliceAta",
  "ValorCartaVerde",
  "TotalRecibo",
  "ComissaoCobranca",
  "ComissaoAngariacao",
  "SituacaoCod",
  "Situacao",
  "NumeroApolice",
  "NIF",
  "IDCliente",
  "NumeroBoletim",
  "SituacaoBoletimCod",
  "SituacaoBoletim",
  "AgenteCobradorBoletim",
  "DataInicioBoletim",
  "DataFechoBoletim",
  "DataContabilizacaoBoletim",
  "ValorRecebidoBoletim",
  "DescricaoBoletim",
  "UtilizadorFechouBoletim",
  "CustoApolice",
  "ValorISelo",
  "ValorINEM",
];

/**
 * Faz parse a partir do texto já descodificado (ex: um ficheiro
 * lido do disco, como a Carteira Total). Usa esta função quando
 * já tens o conteúdo em texto, não em Base64.
 */
export function parseRecibosFileFromText(
  content: string,
): ZurichReciboFicheiro[] {
  const rows = parseLines(content);
  return mapRows<ZurichReciboFicheiro>(rows, RECIBOS_COLUMNS);
}

/**
 * Faz parse a partir do Base64 devolvido pela API da Zurich
 * (ObterFicheiroDia / ObterFicheiroAdhoc).
 */
export function parseRecibosFile(
  base64Ficheiro: string,
): ZurichReciboFicheiro[] {
  const content = decodeZurichFile(base64Ficheiro);
  return parseRecibosFileFromText(content);
}

// -----------------------------------------------------
// 3ª Ficheiro Clientes
// -----------------------------------------------------

export type ZurichClienteFicheiro = {
  IDCliente: string;
  NomeCliente: string;
  Morada: string;
  Localidade: string;
  CodigoPostal: string;
  OrdemPostal: string;
  LocalidadePostal: string;
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
};

const CLIENTES_COLUMNS: (keyof ZurichClienteFicheiro)[] = [
  "IDCliente",
  "NomeCliente",
  "Morada",
  "Localidade",
  "CodigoPostal",
  "OrdemPostal",
  "LocalidadePostal",
  "Pais",
  "NIF",
  "Telefone",
  "Telemovel",
  "Fax",
  "Email",
  "NCartaoIdentificacao",
  "DataNascimento",
  "Tipo",
  "Sexo",
  "CodigoAtividade",
  "NomeAtividade",
  "EstadoCivil",
  "Filhos",
  "NIB",
  "CodSituacao",
  "Situacao",
  "DataUltimaAlteracao",
  "Zurich4You",
  "RecDocPorEmail",
  "DataAtualizacaoTipoCliente",
];

/**
 * Faz parse a partir do texto já descodificado (ex: um ficheiro
 * lido do disco, como a Carteira Total). Usa esta função quando
 * já tens o conteúdo em texto, não em Base64.
 */
export function parseClientesFileFromText(
  content: string,
): ZurichClienteFicheiro[] {
  const rows = parseLines(content);
  return mapRows<ZurichClienteFicheiro>(rows, CLIENTES_COLUMNS);
}

/**
 * Faz parse a partir do Base64 devolvido pela API da Zurich
 * (ObterFicheiroDia / ObterFicheiroAdhoc).
 */
export function parseClientesFile(
  base64Ficheiro: string,
): ZurichClienteFicheiro[] {
  const content = decodeZurichFile(base64Ficheiro);
  return parseClientesFileFromText(content);
}

// -----------------------------------------------------
// 4ª Ficheiro Objetos
// -----------------------------------------------------

export type ZurichObjetoFicheiro = {
  NumeroApolice: string;
  NumeroObjeto: string;
  DescricaoObjeto: string;
  TipoObjeto: string;
  Capital: string;
  EstadoCod: string;
  Estado: string;
  Premio: string;
};

const OBJETOS_COLUMNS: (keyof ZurichObjetoFicheiro)[] = [
  "NumeroApolice",
  "NumeroObjeto",
  "DescricaoObjeto",
  "TipoObjeto",
  "Capital",
  "EstadoCod",
  "Estado",
  "Premio",
];

/**
 * Faz parse a partir do texto já descodificado (ex: um ficheiro
 * lido do disco, como a Carteira Total). Usa esta função quando
 * já tens o conteúdo em texto, não em Base64.
 */
export function parseObjetosFileFromText(
  content: string,
): ZurichObjetoFicheiro[] {
  const rows = parseLines(content);
  return mapRows<ZurichObjetoFicheiro>(rows, OBJETOS_COLUMNS);
}

/**
 * Faz parse a partir do Base64 devolvido pela API da Zurich
 * (ObterFicheiroDia / ObterFicheiroAdhoc).
 */
export function parseObjetosFile(
  base64Ficheiro: string,
): ZurichObjetoFicheiro[] {
  const content = decodeZurichFile(base64Ficheiro);
  return parseObjetosFileFromText(content);
}

// -----------------------------------------------------
// 5ª Ficheiro Coberturas
// -----------------------------------------------------

export type ZurichCoberturaFicheiro = {
  NumeroApolice: string;
  NumeroObjeto: string;
  DescricaoCobertura: string;
  Capital: string;
  Franquia: string;
  ValorFranquia: string;
  ValorMaxFranquia: string;
  NumDiasFranquia: string;
};

const COBERTURAS_COLUMNS: (keyof ZurichCoberturaFicheiro)[] = [
  "NumeroApolice",
  "NumeroObjeto",
  "DescricaoCobertura",
  "Capital",
  "Franquia",
  "ValorFranquia",
  "ValorMaxFranquia",
  "NumDiasFranquia",
];

/**
 * Faz parse a partir do texto já descodificado (ex: um ficheiro
 * lido do disco, como a Carteira Total). Usa esta função quando
 * já tens o conteúdo em texto, não em Base64.
 */
export function parseCoberturasFileFromText(
  content: string,
): ZurichCoberturaFicheiro[] {
  const rows = parseLines(content);
  return mapRows<ZurichCoberturaFicheiro>(rows, COBERTURAS_COLUMNS);
}

/**
 * Faz parse a partir do Base64 devolvido pela API da Zurich
 * (ObterFicheiroDia / ObterFicheiroAdhoc).
 */
export function parseCoberturasFile(
  base64Ficheiro: string,
): ZurichCoberturaFicheiro[] {
  const content = decodeZurichFile(base64Ficheiro);
  return parseCoberturasFileFromText(content);
}