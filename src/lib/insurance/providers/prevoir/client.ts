type PrevoirLoginResponse = {
  user: {
    id: number;
    username: string;
    password?: string;
    role: string;
    nAgente: number;
  };
  token: string;
};

export type PrevoirPolicy = {
  modalidade: number;
  versao: number;
  apolice: number;
  descricaoModalidade: string | null;

  dataEmissaoContrato: string | null;
  dataInicioContrato: string | null;

  valorPremioActual: number | null;
  valorPremioAnualizado: number | null;

  capitalMorte: number | null;
  capitalVida: number | null;

  situacaoContrato: string | null;
  fracionamento: string | null;

  nomeTitular: string | null;
  sexoTitular: string | null;
  nifTitular: string | null;

  ruaTitular: string | null;
  localidadeTitular: string | null;
  codPostalTitular: string | null;

  nomePessoaSegura1: string | null;
  dataNascimentoPessoaSegura1: string | null;

  nomePessoaSegura2: string | null;
  dataNascimentoPessoaSegura2: string | null;

  subAgente: string | null;
  descricaoSubagente: string | null;
  idUtlizador: string | null;

  // Não assumimos que a documentação contém
  // todos os campos que possam surgir no futuro.
  [key: string]: unknown;
};

function getConfig() {
  const apiUrl = process.env.PREVOIR_API_URL;
  const username = process.env.PREVOIR_USERNAME;
  const password = process.env.PREVOIR_PASSWORD;

  if (!apiUrl) {
    throw new Error(
      "PREVOIR_API_URL não está configurado.",
    );
  }

  if (!username) {
    throw new Error(
      "PREVOIR_USERNAME não está configurado.",
    );
  }

  if (!password) {
    throw new Error(
      "PREVOIR_PASSWORD não está configurado.",
    );
  }

  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    username,
    password,
  };
}

export async function loginPrevoir(): Promise<PrevoirLoginResponse> {
  const {
    apiUrl,
    username,
    password,
  } = getConfig();

  const response = await fetch(
    `${apiUrl}/v1/account/login`,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },

      body: JSON.stringify({
        username,
        password,
      }),

      cache: "no-store",
    },
  );

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Erro no login Prévoir (${response.status}): ${body.slice(0, 500)}`,
    );
  }

  const data =
    (await response.json()) as PrevoirLoginResponse;

  if (!data.token) {
    throw new Error(
      "A Prévoir não devolveu token no login.",
    );
  }

  return data;
}

export async function getPrevoirPolicy(
  modalidade: string | number,
  apolice: string | number,
): Promise<PrevoirPolicy[]> {
  const { apiUrl } = getConfig();

  const login = await loginPrevoir();

  const mediatorNumber =
    process.env.PREVOIR_MEDIATOR_NUMBER ||
    String(login.user.nAgente);

  if (!mediatorNumber) {
    throw new Error(
      "Não foi possível determinar o número de mediador Prévoir.",
    );
  }

  const response = await fetch(
    `${apiUrl}/v1/export/listaapolices/prevoir/${encodeURIComponent(
      mediatorNumber,
    )}/${encodeURIComponent(
      String(modalidade),
    )}/${encodeURIComponent(
      String(apolice),
    )}`,
    {
      method: "GET",

      headers: {
        Authorization: `Bearer ${login.token}`,
        Accept: "application/json",
      },

      cache: "no-store",
    },
  );

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Erro ao obter apólice Prévoir (${response.status}): ${body.slice(0, 500)}`,
    );
  }

  return (await response.json()) as PrevoirPolicy[];
}

export async function getPrevoirPolicies(): Promise<PrevoirPolicy[]> {
  const { apiUrl } = getConfig();

  const login = await loginPrevoir();

  const mediatorNumber =
    process.env.PREVOIR_MEDIATOR_NUMBER ||
    String(login.user.nAgente);

  if (!mediatorNumber) {
    throw new Error(
      "Não foi possível determinar o número de mediador Prévoir.",
    );
  }

  const response = await fetch(
    `${apiUrl}/v1/export/listaapolices/prevoir/${encodeURIComponent(
      mediatorNumber,
    )}`,
    {
      method: "GET",

      headers: {
        Authorization: `Bearer ${login.token}`,
        Accept: "application/json",
      },

      cache: "no-store",
    },
  );

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Erro ao obter apólices Prévoir (${response.status}): ${body.slice(
        0,
        500,
      )}`,
    );
  }

  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new Error(
      "A resposta da Prévoir não é uma lista de apólices.",
    );
  }

  return data as PrevoirPolicy[];
}

/*
 * Endpoint incremental confirmado manualmente em teste:
 *
 * /v1/export/listaapolices/prevoir/{mediador}/{AAAAMMDD}
 *
 * Devolve apenas as apólices alteradas desde essa data
 * (confirmado: com data antiga devolveu 488 de 490,
 * portanto filtra por alteração, não é um "snapshot total").
 *
 * sinceDate deve vir no formato AAAAMMDD (ex: "20260115").
 */
export async function getPrevoirPoliciesIncremental(
  sinceDate: string,
): Promise<PrevoirPolicy[]> {
  const { apiUrl } = getConfig();

  const login = await loginPrevoir();

  const mediatorNumber =
    process.env.PREVOIR_MEDIATOR_NUMBER ||
    String(login.user.nAgente);

  if (!mediatorNumber) {
    throw new Error(
      "Não foi possível determinar o número de mediador Prévoir.",
    );
  }

  if (!/^\d{8}$/.test(sinceDate)) {
    throw new Error(
      `Data inválida para sync incremental Prévoir: "${sinceDate}". Esperado formato AAAAMMDD.`,
    );
  }

  const response = await fetch(
    `${apiUrl}/v1/export/listaapolices/prevoir/${encodeURIComponent(
      mediatorNumber,
    )}/${sinceDate}`,
    {
      method: "GET",

      headers: {
        Authorization: `Bearer ${login.token}`,
        Accept: "application/json",
      },

      cache: "no-store",
    },
  );

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Erro ao obter apólices incrementais Prévoir (${response.status}): ${body.slice(
        0,
        500,
      )}`,
    );
  }

  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new Error(
      "A resposta incremental da Prévoir não é uma lista de apólices.",
    );
  }

  return data as PrevoirPolicy[];
}