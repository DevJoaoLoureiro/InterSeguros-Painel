"use client";

import {
  useEffect,
  useState,
} from "react";

import {
  UserRound,
  X,
} from "lucide-react";

import {
  useRouter,
} from "next/navigation";

import {
  updateOpportunity,
  type OpportunityStatus,
} from "@/app/(dashboard)/oportunidades/action";

type Opportunity = {
  id: string;
  title: string;
  insurance_type: string | null;
  status: OpportunityStatus;
  estimated_value: number | null;
  assigned_user_id: string | null;
  company_name: string | null;
  expected_close_date: string | null;
};

type UserOption = {
  id: string;
  full_name: string;
};

type Props = {
  opportunity:
    | Opportunity
    | null;

  users: UserOption[];

  canAssignOthers: boolean;

  onClose: () => void;
};

export function EditOpportunityDialog({
  opportunity,
  users,
  canAssignOthers,
  onClose,
}: Props) {
  const router =
    useRouter();

  const [
    title,
    setTitle,
  ] = useState("");

  const [
    insuranceType,
    setInsuranceType,
  ] = useState("");

  const [
    estimatedValue,
    setEstimatedValue,
  ] = useState("");

  const [
    companyName,
    setCompanyName,
  ] = useState("");

  const [
    expectedCloseDate,
    setExpectedCloseDate,
  ] = useState("");

  const [
    assignedUserId,
    setAssignedUserId,
  ] = useState("");

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!opportunity) {
      return;
    }

    setTitle(
      opportunity.title,
    );

    setInsuranceType(
      opportunity.insurance_type ??
        "",
    );

    setEstimatedValue(
      opportunity.estimated_value !==
        null
        ? String(
            opportunity.estimated_value,
          )
        : "",
    );

    setCompanyName(
      opportunity.company_name ??
        "",
    );

    setExpectedCloseDate(
      opportunity.expected_close_date ??
        "",
    );

    setAssignedUserId(
      opportunity.assigned_user_id ??
        "",
    );

    setError(null);
  }, [opportunity]);

  if (!opportunity) {
    return null;
  }

  const currentOpportunity =
    opportunity;

  async function handleSubmit(
    event: React.FormEvent,
  ) {
    event.preventDefault();

    try {
      setLoading(true);
      setError(null);

      const value =
        estimatedValue.trim()
          ? Number(
              estimatedValue.replace(
                ",",
                ".",
              ),
            )
          : null;

      if (
        value !== null &&
        (
          Number.isNaN(value) ||
          value < 0
        )
      ) {
        throw new Error(
          "Valor estimado inválido.",
        );
      }

      await updateOpportunity(
        currentOpportunity.id,
        {
          title,

          insuranceType:
            insuranceType ||
            null,

          estimatedValue:
            value,

          assignedUserId:
            canAssignOthers
              ? assignedUserId ||
                null
              : null,

          companyName:
            companyName ||
            null,

          expectedCloseDate:
            expectedCloseDate ||
            null,

          notes: null,
        },
      );

      onClose();

      router.refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Erro ao editar oportunidade.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold">
              Editar oportunidade
            </h2>

            <p className="mt-1 text-sm text-[#7d848e]">
              Atualiza os dados da oportunidade.
            </p>
          </div>

          <button
            type="button"
            onClick={
              onClose
            }
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={
            handleSubmit
          }
          className="space-y-5 p-6"
        >
          <Field
            label="Título"
            value={title}
            onChange={
              setTitle
            }
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Tipo de seguro"
              value={
                insuranceType
              }
              onChange={
                setInsuranceType
              }
            />

            <Field
              label="Companhia"
              value={
                companyName
              }
              onChange={
                setCompanyName
              }
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Valor estimado"
              value={
                estimatedValue
              }
              onChange={
                setEstimatedValue
              }
            />

            <div>
              <label className="mb-2 block text-sm font-medium">
                Previsão de fecho
              </label>

              <input
                type="date"
                value={
                  expectedCloseDate
                }
                onChange={(
                  event,
                ) =>
                  setExpectedCloseDate(
                    event.target.value,
                  )
                }
                className="h-11 w-full rounded-xl border px-4 text-sm"
              />
            </div>
          </div>

          {/* SOMENTE OWNER / ADMIN */}

          {canAssignOthers ? (
            <div>
              <label className="mb-2 block text-sm font-medium">
                Responsável
              </label>

              <select
                value={
                  assignedUserId
                }
                onChange={(
                  event,
                ) =>
                  setAssignedUserId(
                    event.target.value,
                  )
                }
                className="h-11 w-full rounded-xl border bg-white px-3 text-sm"
              >
                {users.map(
                  (user) => (
                    <option
                      key={
                        user.id
                      }
                      value={
                        user.id
                      }
                    >
                      {
                        user.full_name
                      }
                    </option>
                  ),
                )}
              </select>
            </div>
          ) : (
            <div className="rounded-xl border bg-[#f8f9fa] px-4 py-3">
              <div className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-[#ff4b0a]" />

                <div>
                  <p className="text-sm font-medium">
                    {users.find(
                      (user) =>
                        user.id ===
                        currentOpportunity.assigned_user_id,
                    )?.full_name ??
                      "Responsável atual"}
                  </p>

                  <p className="text-xs text-[#8a9099]">
                    O responsável não pode ser alterado.
                  </p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 border-t pt-5">
            <button
              type="button"
              onClick={
                onClose
              }
              className="h-11 rounded-xl border px-5 text-sm"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={
                loading
              }
              className="h-11 rounded-xl bg-[#ff4b0a] px-5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading
                ? "A guardar..."
                : "Guardar alterações"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (
    value: string,
  ) => void;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium">
        {label}
      </label>

      <input
        value={value}
        onChange={(event) =>
          onChange(
            event.target.value,
          )
        }
        className="h-11 w-full rounded-xl border px-4 text-sm"
      />
    </div>
  );
}