const LIBAX_TOKEN_URL =
  "https://id.libax.com/api/connect/token";

const LIBAX_SEGUROS_BASE_URL =
  "https://api.libax.com/seguros/v1";

const LIBAX_BUSINESS_BASE_URL =
  "https://api.libax.com/business/v1";

// ==========================================
// TIPOS
// ==========================================

export type LibaxDocument = {
  documentId: number;
  saleId: number | null;

  companyId: number;
  companyName: string | null;

  contractId: number;
  contractNativeCode: string | null;

  productId: number;
  productNativeCode: string | null;

  lineId: number;
  productName: string | null;

  nativeCode: string | null;

  entityId: number;

  type: number;

  issueDate: string | null;

  startDateCoverage: string | null;
  endDateCoverage: string | null;
  dueDate: string | null;

  statusDate: string | null;

  billingMethod: number;

  totalAmount: number;
  pendingAmount: number;
  commissionAmount: number;
  commercialAmount: number;

  isCanceled: boolean;
  companyStatus: number;
  newProduction: boolean;

  creationDate: string | null;
  modifiedDate: string | null;
  registerDate: string | null;

  sellers?: Array<{
    sellerId: number;
    sellerType: number;
  }>;
};



type LibaxTokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
};

type LibaxPagedResponse<T> = {
  results: T[];
  skip: number;
  take: number;
  total: number;
};

export type LibaxContract = {
  contractId: number;

  productId: number;
  productNativeCode: string | null;

  lineId: number;

  companyId: number;
  policyHolderId: number;

  nativeCode: string;

  startDate: string | null;
  periodStartDate: string | null;

  fractionType: number;

  endDate: string | null;

  status: number;

  creationDate: string | null;
  registerDate: string | null;
  issueDate: string | null;
  renewDate: string | null;
  modifiedDate: string | null;

  lastDocumentAmount: number;

  officeId: number | null;

  sellers?: Array<{
  sellerId: number;
  sellerType: number;
}>;
};

export type LibaxBusinessSeller = {
  sellerId: number;
  number?: number;
  name?: string | null;

  libaxUserId?: number | null;
  officeId?: number | null;
  entityId?: number | null;

  isActive?: boolean;

  contact?: {
    phone?: string | null;
    mobile?: string | null;
    email?: string | null;
  } | null;
};

export type LibaxEntity = {
  entityId?: number;
  id?: number;
  number?: number;

  name: string;

  vatNumber?: string | null;

  email?: string | null;

  phone?: string | null;
  mobile?: string | null;

  birthDate?: string | null;

  city?: string | null;
  street?: string | null;
  region?: string | null;
  code?: string | null;

  status?: number;
  type?: number;

  officeId?: number | null;

  observation?: string | null;
};

export type LibaxCompany = {
  companyId?: number;
  id?: number;

  name?: string | null;

  nativeCode?: string | null;
};

export type LibaxProduct = {
  productId?: number;
  id?: number;

  name?: string | null;

  nativeCode?: string | null;

  lineId?: number | null;
  companyId?: number | null;
};

export type LibaxProductLine = {
  productLineId?: number;
  id?: number;

  name?: string | null;

  nativeCode?: string | null;
};

// ==========================================
// CREDENCIAIS
// ==========================================

function getSegurosCredentials() {
  const clientId =
    process.env.LIBAX_SEGUROS_CLIENT_ID;

  const clientSecret =
    process.env.LIBAX_SEGUROS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Credenciais da Libax Seguros API em falta.",
    );
  }

  return {
    clientId,
    clientSecret,
  };
}

function getBusinessCredentials() {
  const clientId =
    process.env.LIBAX_BUSINESS_CLIENT_ID;

  const clientSecret =
    process.env.LIBAX_BUSINESS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Credenciais da Libax Business API em falta.",
    );
  }

  return {
    clientId,
    clientSecret,
  };
}

// ==========================================
// CACHE DOS TOKENS
// ==========================================

let segurosToken: string | null =
  null;

let segurosTokenExpiresAt = 0;

let businessToken: string | null =
  null;

let businessTokenExpiresAt = 0;

// ==========================================
// OAUTH GENÉRICO
// ==========================================

async function requestAccessToken(
  clientId: string,
  clientSecret: string,
) {
  const body =
    new URLSearchParams();

  body.set(
    "grant_type",
    "client_credentials",
  );

  body.set(
    "client_id",
    clientId,
  );

  body.set(
    "client_secret",
    clientSecret,
  );

  const response = await fetch(
    LIBAX_TOKEN_URL,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
      },

      body: body.toString(),

      cache: "no-store",
    },
  );

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `Erro Libax OAuth (${response.status}): ${text}`,
    );
  }

  const data =
    (await response.json()) as LibaxTokenResponse;

  if (!data.access_token) {
    throw new Error(
      "A Libax não devolveu access_token.",
    );
  }

  return data;
}

// ==========================================
// AUTH SEGUROS
// ==========================================

export async function authenticateLibaxSeguros() {
  if (
    segurosToken &&
    Date.now() < segurosTokenExpiresAt
  ) {
    return segurosToken;
  }

  const {
    clientId,
    clientSecret,
  } = getSegurosCredentials();

  const data =
    await requestAccessToken(
      clientId,
      clientSecret,
    );

  segurosToken =
    data.access_token;

  segurosTokenExpiresAt =
    Date.now() +
    Math.max(
      data.expires_in - 60,
      30,
    ) *
      1000;

  return segurosToken;
}

// ==========================================
// AUTH BUSINESS
// ==========================================

export async function authenticateLibaxBusiness() {
  if (
    businessToken &&
    Date.now() < businessTokenExpiresAt
  ) {
    return businessToken;
  }

  const {
    clientId,
    clientSecret,
  } = getBusinessCredentials();

  const data =
    await requestAccessToken(
      clientId,
      clientSecret,
    );

  businessToken =
    data.access_token;

  businessTokenExpiresAt =
    Date.now() +
    Math.max(
      data.expires_in - 60,
      30,
    ) *
      1000;

  return businessToken;
}

// ==========================================
// FETCH SEGUROS
// ==========================================

async function segurosGet<T>(
  path: string,
  params?: URLSearchParams,
): Promise<T> {
  const token =
    await authenticateLibaxSeguros();

  const query =
    params?.toString()
      ? `?${params.toString()}`
      : "";

  const response = await fetch(
    `${LIBAX_SEGUROS_BASE_URL}${path}${query}`,
    {
      method: "GET",

      headers: {
        Authorization:
          `Bearer ${token}`,

        Accept:
          "application/json",
      },

      cache: "no-store",
    },
  );

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `Erro Libax Seguros ${path} (${response.status}): ${text}`,
    );
  }

  return response.json();
}

// ==========================================
// FETCH BUSINESS
// ==========================================

async function businessGet<T>(
  path: string,
  params?: URLSearchParams,
): Promise<T> {
  const token =
    await authenticateLibaxBusiness();

  const query =
    params?.toString()
      ? `?${params.toString()}`
      : "";

  const response = await fetch(
    `${LIBAX_BUSINESS_BASE_URL}${path}${query}`,
    {
      method: "GET",

      headers: {
        Authorization:
          `Bearer ${token}`,

        Accept:
          "application/json",
      },

      cache: "no-store",
    },
  );

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `Erro Libax Business ${path} (${response.status}): ${text}`,
    );
  }

  return response.json();
}

// ==========================================
// CONTRACTS
// ==========================================

export async function getLibaxContractsPage(
  skip = 0,
  take = 400,
) {
  const params =
    new URLSearchParams();

  params.set(
    "Take",
    String(take),
  );

  params.set(
    "Skip",
    String(skip),
  );

  return segurosGet<
    LibaxPagedResponse<LibaxContract>
  >(
    "/Contracts",
    params,
  );
}


// ==========================================
// DOCUMENTS
// ==========================================

export async function getLibaxDocumentsPage(
  skip = 0,
  take = 400,
) {
  const params =
    new URLSearchParams();

  params.set(
    "Take",
    String(take),
  );

  params.set(
    "Skip",
    String(skip),
  );

  params.set(
    "fixedSellerList",
    "false",
  );

  return segurosGet<
    LibaxPagedResponse<LibaxDocument>
  >(
    "/Documents",
    params,
  );
}

// ==========================================
// ENTITY / TOMADOR
// ==========================================

export async function getLibaxEntity(
  entityId: number,
) {
  return businessGet<LibaxEntity>(
    `/Entities/${entityId}`,
  );
}

// ==========================================
// COMPANY
// ==========================================

export async function getLibaxCompany(
  companyId: number,
) {
  return segurosGet<LibaxCompany>(
    `/Companies/${companyId}`,
  );
}

// ==========================================
// PRODUCT
// ==========================================

export async function getLibaxProduct(
  productId: number,
) {
  return segurosGet<LibaxProduct>(
    `/Products/${productId}`,
  );
}

// ==========================================
// PRODUCT LINE / RAMO
// ==========================================

export async function getLibaxProductLine(
  lineId: number,
) {
  return segurosGet<LibaxProductLine>(
    `/ProductLines/${lineId}`,
  );
}

// ==========================================
// DATAS
// ==========================================

function toDateKey(
  value:
    | string
    | null
    | undefined,
) {
  if (!value) {
    return null;
  }

  return value.slice(0, 10);
}


// ==========================================
// DOCUMENTOS / RECIBOS EMITIDOS NUM DIA
// ==========================================

export async function getDocumentsIssuedOn(
  targetDate: string,
) {
  const take = 400;

  let skip = 0;

  const documents:
    LibaxDocument[] = [];

  while (true) {
    const page =
      await getLibaxDocumentsPage(
        skip,
        take,
      );

    const matches =
      page.results.filter(
        (document) =>
          toDateKey(
            document.issueDate,
          ) === targetDate,
      );

    documents.push(
      ...matches,
    );

    skip +=
      page.results.length;

    if (
      page.results.length === 0 ||
      skip >= page.total
    ) {
      break;
    }
  }

  return documents;
}



// ==========================================
// DOCUMENTOS EMITIDOS + CONTRATOS COMPLETOS
// ==========================================

export async function getIssuedDocumentsWithDetails(
  targetDate: string,
) {
  const documents =
    await getDocumentsIssuedOn(
      targetDate,
    );

  const clientCache =
    new Map<number, LibaxEntity>();

  const companyCache =
    new Map<number, LibaxCompany>();

  const productCache =
    new Map<number, LibaxProduct>();

  const lineCache =
    new Map<number, LibaxProductLine>();

  const contractCache =
    new Map<number, LibaxContract>();

  async function getContract(
    contractId: number,
  ) {
    const cached =
      contractCache.get(
        contractId,
      );

    if (cached) {
      return cached;
    }

    const contract =
      await getLibaxContract(
        contractId,
      );

    contractCache.set(
      contractId,
      contract,
    );

    return contract;
  }

  async function getClient(
    entityId: number,
  ) {
    const cached =
      clientCache.get(entityId);

    if (cached) {
      return cached;
    }

    const client =
      await getLibaxEntity(
        entityId,
      );

    clientCache.set(
      entityId,
      client,
    );

    return client;
  }

  async function getCompany(
    companyId: number,
  ) {
    const cached =
      companyCache.get(companyId);

    if (cached) {
      return cached;
    }

    const company =
      await getLibaxCompany(
        companyId,
      );

    companyCache.set(
      companyId,
      company,
    );

    return company;
  }

  async function getProduct(
    productId: number,
  ) {
    const cached =
      productCache.get(productId);

    if (cached) {
      return cached;
    }

    const product =
      await getLibaxProduct(
        productId,
      );

    productCache.set(
      productId,
      product,
    );

    return product;
  }

  async function getLine(
    lineId: number,
  ) {
    const cached =
      lineCache.get(lineId);

    if (cached) {
      return cached;
    }

    const line =
      await getLibaxProductLine(
        lineId,
      );

    lineCache.set(
      lineId,
      line,
    );

    return line;
  }

  const results = [];

  for (const document of documents) {
    // DOCUMENT → CONTRACT
    const contract =
      await getContract(
        document.contractId,
      );

    const client =
      await getClient(
        contract.policyHolderId,
      );

    const company =
      await getCompany(
        contract.companyId,
      );

    const product =
      await getProduct(
        contract.productId,
      );

    const line =
      await getLine(
        contract.lineId,
      );

    results.push({
      // ======================================
      // DOCUMENTO / RECIBO
      // ======================================

      documentId:
        document.documentId,

      receiptNumber:
        document.nativeCode,

      documentIssueDate:
        document.issueDate,

      documentStartDate:
        document.startDateCoverage,

      documentEndDate:
        document.endDateCoverage,

      documentDueDate:
        document.dueDate,

      documentAmount:
        document.totalAmount,

      newProduction:
        document.newProduction,

      // ======================================
      // CONTRATO / APÓLICE
      // ======================================

      contractId:
        contract.contractId,

      policyNumber:
        contract.nativeCode,

      issueDate:
        contract.issueDate,

      startDate:
        contract.startDate,

      endDate:
        contract.endDate,

      renewDate:
        contract.renewDate,

      premium:
        contract.lastDocumentAmount,

      fractionType:
        contract.fractionType,

      status:
        contract.status,

      // Podemos aproveitar os sellers
      // diretamente do documento.
      sellers:
        document.sellers ??
        contract.sellers ??
        [],

      // ======================================
      // CLIENTE
      // ======================================

      client: {
        id:
          contract.policyHolderId,

        name:
          client.name,

        nif:
          client.vatNumber ??
          null,

        email:
          client.email ??
          null,

        phone:
          client.mobile ??
          client.phone ??
          null,

        birthDate:
          client.birthDate ??
          null,

        city:
          client.city ??
          null,

        street:
          client.street ??
          null,
      },

      // ======================================
      // COMPANHIA
      // ======================================

      company: {
        id:
          contract.companyId,

        name:
          company.name ??
          document.companyName ??
          null,

        nativeCode:
          company.nativeCode ??
          null,
      },

      // ======================================
      // PRODUTO
      // ======================================

      product: {
        id:
          contract.productId,

        name:
          product.name ??
          document.productName ??
          null,

        nativeCode:
          product.nativeCode ??
          null,
      },

      // ======================================
      // RAMO
      // ======================================

      line: {
        id:
          contract.lineId,

        name:
          line.name ??
          null,

        nativeCode:
          line.nativeCode ??
          null,
      },
    });
  }

  return results;
}

// ==========================================
// APÓLICES DO DIA ENRIQUECIDAS
// ==========================================


export async function getLibaxContract(
  contractId: number,
) {
  return segurosGet<LibaxContract>(
    `/Contracts/${contractId}`,
  );
}

export async function getLibaxBusinessSeller(
  sellerId: number,
) {
  return businessGet<LibaxBusinessSeller>(
    `/Sellers/${sellerId}`,
  );
}
