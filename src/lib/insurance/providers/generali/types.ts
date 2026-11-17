/*
 * Tipos da API "Digitização V2" da Generali (ex-Tranquilidade).
 *
 * Copiados da especificação Swagger:
 *   https://ws.tranquilidade.pt/invoke/Digitizacao.V2/Documentacao
 *
 * Regras de formato da API:
 * - todos os valores chegam como TEXTO, incluindo números ("10.00",
 *   sempre com ponto);
 * - datas em AAAA-MM-DD;
 * - cada código tem a descrição num campo com o mesmo nome + "Desc"
 *   (ex.: EstadoApolice / EstadoApoliceDesc). A tabela completa dos
 *   códigos vem da operação /listas.
 *
 * Os campos são todos opcionais: a API omite os que vêm vazios.
 */

export type GeneraliMorada = {
  Morada?: string;
  Localidade?: string;
  CodPostal?: string;
  LocalidadePostal?: string;
};

// -----------------------------------------------------
// CLIENTES (/clientes, /carregamentoinicial?Tipo=Clientes)
// -----------------------------------------------------

export type GeneraliCliente = {
  /** Referência interna da companhia (10 caracteres). */
  NrCliente?: string;
  Tipo?: string;
  TipoDesc?: string;
  Nome?: string;
  MoradaResidencia?: GeneraliMorada;
  DtNascimento?: string;
  EstadoCivil?: string;
  EstadoCivilDesc?: string;
  NrContribuinte?: string;
  NrIdentificacao?: string;
  Nacionalidade?: string;
  NacionalidadeDesc?: string;
  HabilitacoesLiterarias?: string;
  HabilitacoesLiterariasDesc?: string;
  Profissao?: string;
  ProfissaoDesc?: string;
  Contactos?: { Contacto?: string }[];
  Emails?: { TipoEmail?: string; TipoEmailDesc?: string; Email?: string }[];
  CartaConducao?: {
    NrCartaConducao?: string;
    Detalhes?: { Tipo?: string; TipoDesc?: string; Data?: string }[];
  };
  Sexo?: string;
  SexoDesc?: string;
  CAE?: string;
  NrEmpregados?: string;
  AnoInicioActividade?: string;
  IndEntidadeVerde?: string;
  DtEntidadeVerde?: string;
};

// -----------------------------------------------------
// APÓLICES (/apolices, /carregamentoinicial?Tipo=Apolices)
// -----------------------------------------------------

export type GeneraliObjetoSeguro = {
  LinhaNegocio?: string;
  LinhaNegocioDesc?: string;
  NrObjeto?: string;
  TipoObjeto?: string;
  TipoObjetoDesc?: string;
  SubTipoObjeto?: string;
  SubTipoObjetoDesc?: string;
  Capital?: string;
  LocalRisco?: GeneraliMorada;
  DtConstrucao?: string;
  PercentagemIndexacao?: string;
  NrPessoaSegura?: string;
  NomePessoaSegura?: string;
  Matricula?: string;
  DtMatricula?: string;
  Categoria?: string;
  CategoriaDesc?: string;
  TipoMatricula?: string;
  TipoMatriculaDesc?: string;
  Marca?: string;
  Modelo?: string;
  Versao?: string;
  NrLugares?: string;
  Potencia?: string;
  PremioComercial?: string;
  CodigoMediacao?: string;
  ModoRenovacao?: string;
  ModoRenovacaoDesc?: string;
  NIFPessoaSegura?: string;
  Credores?: {
    Relacao?: string;
    NomeCredor?: string;
    NIF?: string;
    DtInicio?: string;
    DtFim?: string;
  }[];
  Emprestimos?: {
    NrEmprestimo?: string;
    ValorEmprestimo?: string;
    DtEmprestimo?: string;
  }[];
};

export type GeneraliApolice = {
  NrApolice?: string;
  NrApoliceGrupo?: string;
  /** "NNNNN-Descrição": código do produto + descrição. */
  Produto?: string;
  ProdutoDesc?: string;
  Opcao?: string;
  OpcaoDesc?: string;
  /** Nº da entidade tomadora (= NrCliente em /clientes). */
  NrTomador?: string;
  EstadoApolice?: string;
  EstadoApoliceDesc?: string;
  Fracionamento?: string;
  FracionamentoDesc?: string;
  DtInicioApolice?: string;
  /** Só tem data a sério quando a apólice está anulada. */
  DtFimApolice?: string;
  DtInicioPeriodo?: string;
  DtFimPeriodo?: string;
  DtVencimentoApolice?: string;
  MotivoAlteracao?: string;
  MotivoAlteracaoDesc?: string;
  MoradaCorrespondencia?: GeneraliMorada;
  NrAcaoMarketing?: string;
  CapitalApolice?: string;
  PremioTotal?: string;
  ContaCobranca?: string;
  NomeTomador?: string;
  NrContribuinte?: string;
  MotivoAnulacao?: string;
  MotivoAnulacaoDesc?: string;
  ObjetosSeguros?: GeneraliObjetoSeguro[];
  // Versão 2.2 (maio 2026):
  UtilizadorEmissaoApolice?: string;
  DtEmissaoApolice?: string;
  ValorAnualComissao?: string;
};

// -----------------------------------------------------
// RECIBOS (/recibos, /carregamentoinicial?Tipo=Recibos)
// -----------------------------------------------------

export type GeneraliRecibo = {
  NrRecibo?: string;
  TipoRecibo?: string;
  TipoReciboDesc?: string;
  NrApolice?: string;
  EstadoRecibo?: string;
  EstadoReciboDesc?: string;
  DtEmissao?: string;
  DtInicio?: string;
  DtFim?: string;
  DtLimiteCobranca?: string;
  DtPagamento?: string;
  PremioLiquido?: string;
  PremioTotal?: string;
  PremioComercial?: string;
  CodCobrador?: string;
  ComissaoCobranca?: string;
  IrsRetidoCobranca?: string;
  CodMediador?: string;
  ComissaoMediacao?: string;
  IrsRetidoMediacao?: string;
  SeloMediador?: string;
  SeloCobrador?: string;
  TemCheque?: string;
  NrCheque?: string;
  DtEmissaoCheque?: string;
  ReciboPertenceExtrato?: string;
  NrExtrato?: string;
  NrTomador?: string;
  TipoRecebimento?: string;
  TipoRecebimentoDesc?: string;
  ATM?: { Entidade?: string; Referencia?: string };
  Documento?: string;
  DtAnulacao?: string;
  MotivoAnulacao?: string;
  CustoApolice?: string;
  DtAlteracaoEstado?: string;
  Autorizado?: string;
};

// -----------------------------------------------------
// DETALHE DA APÓLICE (/apolices/{NrApolice}/detalhe)
// -----------------------------------------------------

export type GeneraliCobertura = {
  LinhaNegocio?: string;
  LinhaNegocioDesc?: string;
  Cobertura?: string;
  /** Sic: na API chama-se "CoberturaDec" (não "Desc"). */
  CoberturaDec?: string;
  Capital?: string;
  CodTipoFranquia?: string;
  ValorFranquia?: string;
};

export type GeneraliDetalheApolice = {
  Apolice?: {
    NrApoliceGrupo?: string;
    ObjetosSeguros?: {
      NrObjeto?: string;
      TipoObjeto?: string;
      TipoObjetoDesc?: string;
      SubTipoObjeto?: string;
      SubTipoObjetoDesc?: string;
      Capital?: string;
      LocalRisco?: GeneraliMorada;
      PercentagemIndexacao?: string;
      Cobertura?: GeneraliCobertura[];
      Automovel?: {
        Matricula?: string;
        DtMatricula?: string;
        Categoria?: string;
        CategoriaDesc?: string;
        TipoMatricula?: string;
        TipoMatriculaDesc?: string;
        Marca?: string;
        Modelo?: string;
        Versao?: string;
        NrLugares?: string;
        Potencia?: string;
        DtConstrucao?: string;
      };
      PessoaSegura?: { NrPessoaSegura?: string; NomePessoaSegura?: string };
    }[];
  };
};

// -----------------------------------------------------
// LISTAS DE CÓDIGOS (/listas)
// -----------------------------------------------------

export type GeneraliListas = {
  Servicos?: {
    Nome?: string;
    Campos?: {
      Nome?: string;
      Codigos?: {
        Nome?: string;
        Descricao?: string;
        DescricaoAdicional?: string;
      }[];
    }[];
  }[];
};

// -----------------------------------------------------
// PAGINAÇÃO POR SYNCTOKEN
// -----------------------------------------------------

/**
 * Campos comuns às respostas paginadas. Com MaisRegistos = "SIM"
 * chama-se outra vez só com o SyncToken devolvido; com "NAO" o
 * SyncToken devolvido é o ponto de partida da próxima sincronização.
 */
export type GeneraliPagina = {
  MaisRegistos?: string;
  SyncToken?: string;
};

/** Os três recursos que o CRM sincroniza. */
export type GeneraliRecurso = "Apolices" | "Recibos" | "Clientes";

export type GeneraliRespostaRecurso = GeneraliPagina & {
  Apolices?: GeneraliApolice[];
  Recibos?: GeneraliRecibo[];
  Clientes?: GeneraliCliente[];
};
