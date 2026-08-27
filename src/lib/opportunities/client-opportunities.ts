export type OpportunityLevel =
  | "low"
  | "medium"
  | "high";

export type ClientOpportunity = {
  type: "cross_sell";

  targetLine: string;

  score: number;

  level: OpportunityLevel;

  reason: string;
};

type PolicyForOpportunity = {
  line_name: string | null;
  premium: number | null;
  renew_date: string | null;
};

const CROSS_SELL_RULES: Record<
  string,
  string[]
> = {
  Automóvel: [
    "Multirriscos Habitação",
    "Vida",
  ],

  "Multirriscos Habitação": [
    "Automóvel",
    "Vida",
  ],

  "Acidentes de trabalho": [
    "Vida",
  ],
};

function normalizeLine(
  value: string,
) {
  return value
    .trim()
    .toLocaleLowerCase(
      "pt-PT",
    );
}

function getLevel(
  score: number,
): OpportunityLevel {
  if (score >= 75) {
    return "high";
  }

  if (score >= 50) {
    return "medium";
  }

  return "low";
}

export function calculateClientOpportunities(
  policies: PolicyForOpportunity[],
  today: string,
): ClientOpportunity[] {
  const existingLines =
    new Map<
      string,
      string
    >();

  for (const policy of policies) {
    if (!policy.line_name) {
      continue;
    }

    existingLines.set(
      normalizeLine(
        policy.line_name,
      ),
      policy.line_name,
    );
  }

  const candidates =
    new Map<
      string,
      {
        targetLine: string;
        sources: string[];
      }
    >();

  for (
    const existingLine
    of existingLines.values()
  ) {
    const targets =
      CROSS_SELL_RULES[
        existingLine
      ] ?? [];

    for (const target of targets) {
      const normalizedTarget =
        normalizeLine(target);

      // Já possui este ramo
      if (
        existingLines.has(
          normalizedTarget,
        )
      ) {
        continue;
      }

      const current =
        candidates.get(
          normalizedTarget,
        ) ?? {
          targetLine:
            target,

          sources: [],
        };

      if (
        !current.sources.includes(
          existingLine,
        )
      ) {
        current.sources.push(
          existingLine,
        );
      }

      candidates.set(
        normalizedTarget,
        current,
      );
    }
  }

  const totalPremium =
    policies.reduce(
      (total, policy) =>
        total +
        Number(
          policy.premium ?? 0,
        ),
      0,
    );

  const hasUpcomingRenewal =
    policies.some(
      (policy) => {
        if (
          !policy.renew_date
        ) {
          return false;
        }

        const renewal =
          new Date(
            `${policy.renew_date}T12:00:00Z`,
          );

        const current =
          new Date(
            `${today}T12:00:00Z`,
          );

        const difference =
          renewal.getTime() -
          current.getTime();

        const days =
          difference /
          86_400_000;

        return (
          days >= 0 &&
          days <= 30
        );
      },
    );

  return Array.from(
    candidates.values(),
  )
    .map((candidate) => {
      // Base por existir uma relação
      // de cross-sell conhecida.
      let score = 40;

      // Cliente já possui vários
      // produtos/ramos.
      if (
        existingLines.size >= 2
      ) {
        score += 15;
      }

      // Carteira com maior valor.
      if (
        totalPremium >= 1000
      ) {
        score += 10;
      }

      // Momento comercial próximo.
      if (
        hasUpcomingRenewal
      ) {
        score += 15;
      }

      // Mais do que um ramo existente
      // aponta para a mesma oportunidade.
      if (
        candidate.sources.length >= 2
      ) {
        score += 10;
      }

      score =
        Math.min(
          score,
          100,
        );

      return {
        type:
          "cross_sell" as const,

        targetLine:
          candidate.targetLine,

        score,

        level:
          getLevel(score),

        reason:
          `Cliente possui ${candidate.sources.join(
            " e ",
          )}, mas não possui ${candidate.targetLine}.`,
      };
    })
    .sort(
      (a, b) =>
        b.score -
        a.score,
    );
}