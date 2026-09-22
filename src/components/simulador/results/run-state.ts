import type { QuoteComparison } from "@/lib/quoting/domain/types";

import type { SimulatorPaymentFrequency } from "../types";

/*
 * Estado do último cálculo. É independente do ramo: os resultados só
 * precisam da comparação, da periodicidade pedida (para rotular prémios
 * por prestação) e de um resumo do pedido já formatado.
 */
export type RunState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "failed"; message: string }
  | {
      phase: "done";
      comparison: QuoteComparison;

      /** Frases curtas do pedido (ex.: "Particular", "Todos os riscos"). */
      summary: string[];

      frequency: SimulatorPaymentFrequency;

      /** Identifica os dados usados; se o form mudar, os resultados ficam desatualizados. */
      snapshotKey: string;

      /**
       * Snapshot assinado da simulação Zurich (habilita "Guardar cotação real
       * Zurich"). Ausente em pré-visualizações e sem estimativa Zurich.
       */
      zurichSnapshotToken?: string;

      /** Preenchido só em pré-visualizações com dados fictícios. */
      demoLabel?: string;
    };
