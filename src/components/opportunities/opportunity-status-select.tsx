"use client";

import {
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

import {
  updateOpportunityStatus,
  type OpportunityStatus,
} from "@/app/(dashboard)/oportunidades/action";

type Props = {
  opportunityId: string;
  currentStatus: OpportunityStatus;
};

export function OpportunityStatusSelect({
  opportunityId,
  currentStatus,
}: Props) {
  const router =
    useRouter();

  const [
    status,
    setStatus,
  ] = useState<OpportunityStatus>(
    currentStatus,
  );

  const [
    loading,
    setLoading,
  ] = useState(false);

  async function handleChange(
    newStatus: OpportunityStatus,
  ) {
    const previous =
      status;

    try {
      setLoading(true);
      setStatus(
        newStatus,
      );

      await updateOpportunityStatus(
        opportunityId,
        newStatus,
      );

      router.refresh();
    } catch (error) {
      setStatus(
        previous,
      );

      alert(
        error instanceof Error
          ? error.message
          : "Erro ao alterar estado.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <select
      value={status}
      disabled={loading}
      onChange={(event) =>
        void handleChange(
          event.target
            .value as OpportunityStatus,
        )
      }
    >
      <option value="nova">
        Nova
      </option>

      <option value="qualificada">
        Qualificada
      </option>

      <option value="simulacao">
        Simulação
      </option>

      <option value="negociacao">
        Negociação
      </option>

      <option value="proposta">
        Proposta
      </option>

      <option value="ganha">
        Ganha
      </option>

      <option value="perdida">
        Perdida
      </option>
    </select>
  );
}