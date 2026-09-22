import type { QuoteComparison } from "@/lib/quoting/domain/types";

/*
 * Tipos partilhados entre a UI do simulador (cliente) e os Server Actions.
 *
 * Só `import type` do motor de cotações: este ficheiro é importado por
 * componentes cliente e não pode arrastar o motor (nem o Supabase admin)
 * para o bundle do browser.
 */

export type DrivingUsage =
  | "PRIVATE"
  | "PROFESSIONAL"
  | "MIXED"
  | "TVDE"
  | "TAXI";

export type SimulatorPaymentFrequency =
  | "ANNUAL"
  | "SEMIANNUAL"
  | "QUARTERLY"
  | "MONTHLY";

/** Resposta à pergunta "teve sinistros nos últimos 3 anos?". */
export type ClaimsAnswer = "UNKNOWN" | "NONE" | "SOME";

/*
 * Coberturas escolhidas na UI. A responsabilidade civil é obrigatória por
 * lei e por isso não é opcional aqui (o pedido envia-a sempre a true).
 *
 * `ownDamage` representa "danos próprios" na linguagem do mediador; ao
 * construir o pedido alimenta tanto `ownDamage` como `collision`.
 */
export type AutoCoverageFlags = {
  ownDamage: boolean;
  fire: boolean;
  theft: boolean;
  glass: boolean;
  assistance: boolean;
  legalProtection: boolean;
};

export type AutoFormValues = {
  /** Sempre normalizada (XX-XX-XX, maiúsculas) ou vazia. */
  registration: string;

  /** yyyy-mm-dd ou vazio. */
  birthDate: string;

  /** NNNN-NNN, ou parcial enquanto o utilizador escreve. */
  postalCode: string;

  /** yyyy-mm-dd ou vazio. */
  drivingLicenceDate: string;

  usage: DrivingUsage;

  coverages: AutoCoverageFlags;

  /** Euros; null = indiferente / a definir. Só se aplica com danos próprios. */
  deductible: number | null;

  paymentFrequency: SimulatorPaymentFrequency;

  claimsAnswer: ClaimsAnswer;
  claimsCount: number;
  atFaultClaims: number;

  /** Texto livre em euros (ex.: "12500"); só se aplica com danos próprios. */
  vehicleValue: string;
};

export type AutoFieldKey =
  | "registration"
  | "birthDate"
  | "postalCode"
  | "drivingLicenceDate"
  | "vehicleValue";

export type AutoFormErrors = Partial<Record<AutoFieldKey, string>>;

/** Campos que podem vir pré-preenchidos a partir do CRM. */
export type PrefilledFields = Partial<Record<AutoFieldKey, true>>;

export type SimulatorVehicle = {
  registration: string;
  /** Apólice ativa associada a esta matrícula. */
  active: boolean;
};

/** Cliente do CRM, reduzido ao que o simulador aproveita. */
export type SimulatorClient = {
  id: string;
  name: string;
  nif: string | null;
  birthDate: string | null;
  postalCode: string | null;
  city: string | null;
  vehicles: SimulatorVehicle[];
};

export type SearchClientsResult =
  | { ok: true; clients: SimulatorClient[] }
  | { ok: false; error: string };

export type SimulationInput = {
  productLine: "AUTO";
  clientId: string | null;
  values: AutoFormValues;
};

export type SimulationResult =
  | {
      ok: true;
      comparison: QuoteComparison;

      /**
       * Token assinado (pedido + previsão Zurich) para guardar a cotação real
       * depois. Opaco para a UI; null se não houve estimativa Zurich.
       */
      zurichSnapshotToken?: string | null;
    }
  | {
      ok: false;
      error: string;
      fieldErrors?: AutoFormErrors;
    };
