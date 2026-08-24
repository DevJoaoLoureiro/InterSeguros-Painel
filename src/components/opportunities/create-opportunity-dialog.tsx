"use client";

import {
  useState,
} from "react";

import {
  CalendarDays,
  CircleDollarSign,
  Plus,
  UserRound,
  X,
} from "lucide-react";

import {
  useRouter,
} from "next/navigation";

import {
  createOpportunity,
} from "@/app/(dashboard)/oportunidades/action";

type ProfileOption = {
  id: string;
  full_name: string;
  store_id: string | null;
};

type CreateOpportunityDialogProps = {
  users: ProfileOption[];
  canAssignOthers: boolean;
};

export function CreateOpportunityDialog({
  users,
}: CreateOpportunityDialogProps) {
  const router =
    useRouter();

  const [
    open,
    setOpen,
  ] = useState(false);

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
    assignedUserId,
    setAssignedUserId,
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
    notes,
    setNotes,
  ] = useState("");

  function resetForm() {
    setTitle("");
    setInsuranceType("");
    setEstimatedValue("");
    setAssignedUserId("");
    setCompanyName("");
    setExpectedCloseDate("");
    setNotes("");
    setError(null);
  }

  function handleClose() {
    if (loading) {
      return;
    }

    setOpen(false);
    resetForm();
  }

  async function handleSubmit(
    event: React.FormEvent,
  ) {
    event.preventDefault();

    if (!title.trim()) {
      setError(
        "Indica o título da oportunidade.",
      );

      return;
    }

    if (!assignedUserId) {
      setError(
        "Seleciona um responsável.",
      );

      return;
    }

    try {
      setLoading(true);
      setError(null);

      const parsedValue =
        estimatedValue.trim()
          ? Number(
              estimatedValue.replace(
                ",",
                ".",
              ),
            )
          : null;

      if (
        parsedValue !== null &&
        (
          Number.isNaN(
            parsedValue,
          ) ||
          parsedValue < 0
        )
      ) {
        throw new Error(
          "O valor estimado não é válido.",
        );
      }

      await createOpportunity({
        title:
          title.trim(),

        insuranceType:
          insuranceType ||
          null,

        estimatedValue:
          parsedValue,

        assignedUserId,

        companyName:
          companyName.trim() ||
          null,

        expectedCloseDate:
          expectedCloseDate ||
          null,

        notes:
          notes.trim() ||
          null,
      });

      resetForm();
      setOpen(false);

      router.refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Erro ao criar oportunidade.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* BOTÃO */}

      <button
        type="button"
        onClick={() =>
          setOpen(true)
        }
        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#ff4b0a] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#e94308]"
      >
        <Plus className="h-4 w-4" />

        Nova oportunidade
      </button>

      {/* MODAL */}

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#e5e8ec] bg-white shadow-2xl">
            {/* HEADER */}

            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-[#edf0f2] bg-white px-6 py-5">
              <div>
                <h2 className="text-lg font-semibold text-[#20242a]">
                  Nova oportunidade
                </h2>

                <p className="mt-1 text-sm text-[#7d848e]">
                  Adiciona uma nova oportunidade ao pipeline comercial.
                </p>
              </div>

              <button
                type="button"
                onClick={
                  handleClose
                }
                disabled={
                  loading
                }
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[#737a84] transition hover:bg-[#f4f5f7]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* FORM */}

            <form
              onSubmit={
                handleSubmit
              }
              className="space-y-5 p-6"
            >
              {/* TÍTULO */}

              <div>
                <label className="mb-2 block text-sm font-medium text-[#353b44]">
                  Título *
                </label>

                <input
                  value={title}
                  onChange={(
                    event,
                  ) =>
                    setTitle(
                      event.target
                        .value,
                    )
                  }
                  placeholder="Ex: Seguro automóvel - João Silva"
                  className="h-11 w-full rounded-xl border border-[#e1e4e8] bg-white px-4 text-sm outline-none transition focus:border-[#ff4b0a] focus:ring-2 focus:ring-orange-100"
                />
              </div>

              {/* SEGURO + COMPANHIA */}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#353b44]">
                    Tipo de seguro
                  </label>

                  <select
                    value={
                      insuranceType
                    }
                    onChange={(
                      event,
                    ) =>
                      setInsuranceType(
                        event.target
                          .value,
                      )
                    }
                    className="h-11 w-full rounded-xl border border-[#e1e4e8] bg-white px-3 text-sm outline-none focus:border-[#ff4b0a]"
                  >
                    <option value="">
                      Selecionar
                    </option>

                    <option value="Automóvel">
                      Automóvel
                    </option>

                    <option value="Vida">
                      Vida
                    </option>

                    <option value="Multirriscos">
                      Multirriscos
                    </option>

                    <option value="Acidentes Pessoais">
                      Acidentes Pessoais
                    </option>

                    <option value="Saúde">
                      Saúde
                    </option>

                    <option value="Outros">
                      Outros
                    </option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#353b44]">
                    Companhia
                  </label>

                  <input
                    value={
                      companyName
                    }
                    onChange={(
                      event,
                    ) =>
                      setCompanyName(
                        event.target
                          .value,
                      )
                    }
                    placeholder="Ex: Fidelidade"
                    className="h-11 w-full rounded-xl border border-[#e1e4e8] bg-white px-4 text-sm outline-none transition focus:border-[#ff4b0a] focus:ring-2 focus:ring-orange-100"
                  />
                </div>
              </div>

              {/* RESPONSÁVEL */}

              <div>
                <label className="mb-2 block text-sm font-medium text-[#353b44]">
                  Responsável *
                </label>

                <div className="relative">
                  <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a9099]" />

                  <select
                    value={
                      assignedUserId
                    }
                    onChange={(
                      event,
                    ) =>
                      setAssignedUserId(
                        event.target
                          .value,
                      )
                    }
                    className="h-11 w-full appearance-none rounded-xl border border-[#e1e4e8] bg-white pl-10 pr-4 text-sm outline-none focus:border-[#ff4b0a]"
                  >
                    <option value="">
                      Selecionar responsável
                    </option>

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

                <p className="mt-1.5 text-xs text-[#8a9099]">
                  A loja será atribuída automaticamente com base no responsável.
                </p>
              </div>

              {/* VALOR + DATA */}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#353b44]">
                    Valor estimado
                  </label>

                  <div className="relative">
                    <CircleDollarSign className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a9099]" />

                    <input
                      value={
                        estimatedValue
                      }
                      onChange={(
                        event,
                      ) =>
                        setEstimatedValue(
                          event.target
                            .value,
                        )
                      }
                      inputMode="decimal"
                      placeholder="0,00"
                      className="h-11 w-full rounded-xl border border-[#e1e4e8] bg-white pl-10 pr-12 text-sm outline-none transition focus:border-[#ff4b0a] focus:ring-2 focus:ring-orange-100"
                    />

                    <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-[#8a9099]">
                      €
                    </span>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#353b44]">
                    Previsão de fecho
                  </label>

                  <div className="relative">
                    <CalendarDays className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a9099]" />

                    <input
                      type="date"
                      value={
                        expectedCloseDate
                      }
                      onChange={(
                        event,
                      ) =>
                        setExpectedCloseDate(
                          event.target
                            .value,
                        )
                      }
                      className="h-11 w-full rounded-xl border border-[#e1e4e8] bg-white pl-10 pr-4 text-sm outline-none transition focus:border-[#ff4b0a]"
                    />
                  </div>
                </div>
              </div>

              {/* NOTAS */}

              <div>
                <label className="mb-2 block text-sm font-medium text-[#353b44]">
                  Notas
                </label>

                <textarea
                  value={notes}
                  onChange={(
                    event,
                  ) =>
                    setNotes(
                      event.target
                        .value,
                    )
                  }
                  rows={4}
                  placeholder="Informação relevante sobre esta oportunidade..."
                  className="w-full resize-none rounded-xl border border-[#e1e4e8] bg-white px-4 py-3 text-sm outline-none transition focus:border-[#ff4b0a] focus:ring-2 focus:ring-orange-100"
                />
              </div>

              {/* ERROR */}

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              {/* FOOTER */}

              <div className="flex justify-end gap-3 border-t border-[#edf0f2] pt-5">
                <button
                  type="button"
                  onClick={
                    handleClose
                  }
                  disabled={
                    loading
                  }
                  className="h-11 rounded-xl border border-[#e1e4e8] px-5 text-sm font-medium text-[#59616d] transition hover:bg-[#f5f6f7] disabled:opacity-50"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={
                    loading
                  }
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#ff4b0a] px-5 text-sm font-semibold text-white transition hover:bg-[#e94308] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Plus className="h-4 w-4" />

                  {loading
                    ? "A criar..."
                    : "Criar oportunidade"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}