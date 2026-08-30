"use client";

import { useTransition } from "react";
import { ChevronRight, MapPin, UserRoundX, X } from "lucide-react";

import { assignCurrentUserToPolicy } from "@/app/(dashboard)/clientes/action";
import type { ClientsPortfolioData } from "@/components/clientes/types";

type ClientItem = ClientsPortfolioData["items"][number];

type ClientsTableProps = {
  items: ClientItem[];
  onSelectClient: (item: ClientItem) => void;

  totalCount: number;
  onlyUnassigned: boolean;
  onToggleUnassigned: () => void;
  hasFilters: boolean;
  onClearFilters: () => void;
};

function getInsuranceCodes(item: ClientItem) {
  return Array.from(
    new Set(
      item.policies
        .map((policy) => policy.insurance_line?.code)
        .filter(Boolean) as string[],
    ),
  );
}

function getInsuranceTypesLabel(item: ClientItem) {
  const labels = Array.from(
    new Set(
      item.policies.map(
        (policy) =>
          policy.insurance_line?.name ??
          policy.product_name ??
          "Produto",
      ),
    ),
  );

  return labels.length > 0 ? labels.join(", ") : "—";
}

// ============================================================
// BOTÃO ASSOCIAR-ME
// ============================================================

function AssignMeButton({
  policyId,
  onDone,
}: {
  policyId: string;
  onDone: () => void;
}) {
  const [isAssigning, startTransition] = useTransition();

  function handleClick(event: React.MouseEvent) {
    event.stopPropagation();

    startTransition(async () => {
      try {
        await assignCurrentUserToPolicy(policyId);
        onDone();
      } catch (error) {
        window.alert(
          error instanceof Error
            ? error.message
            : "Não foi possível associar a apólice.",
        );
      }
    });
  }

  return (
    <button
      type="button"
      disabled={isAssigning}
      onClick={handleClick}
      className="inline-flex items-center rounded-lg bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-[#ff4b0a] transition hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isAssigning ? "A associar..." : "Associar-me"}
    </button>
  );
}

// ============================================================
// TABELA
// ============================================================

export function ClientsTable({
  items,
  onSelectClient,
  totalCount,
  onlyUnassigned,
  onToggleUnassigned,
  hasFilters,
  onClearFilters,
}: ClientsTableProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#e8eaed] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
      {/* HEADER COM AÇÕES */}

      <div className="flex flex-col gap-3 border-b border-[#edf0f2] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-[#20242a]">
            Carteira de clientes
          </h2>

          <p className="mt-1 text-sm text-[#7d848e]">
            {totalCount} cliente{totalCount === 1 ? "" : "s"}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onToggleUnassigned}
            className={[
              "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition",
              onlyUnassigned
                ? "bg-[#ff4b0a] text-white shadow-sm"
                : "border border-[#e1e4e8] bg-white text-[#59616d] hover:bg-[#f5f6f7]",
            ].join(" ")}
          >
            {onlyUnassigned ? "A ver: por associar" : "Ver por associar"}
          </button>

          {hasFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-[#ff4b0a] transition hover:text-[#df3f06]"
            >
              <X className="h-4 w-4" />
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {/* TABELA / EMPTY STATE */}

      {items.length === 0 ? (
        <div className="flex min-h-[280px] flex-col items-center justify-center px-6 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#f4f5f7]">
            <UserRoundX className="h-5 w-5 text-[#69717d]" />
          </div>

          <h3 className="text-base font-semibold text-[#24272d]">
            Nenhum cliente encontrado
          </h3>

          <p className="mt-1 max-w-sm text-sm text-[#7a818c]">
            Experimenta alterar ou limpar os filtros.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="border-b border-[#e8eaed] bg-[#fafafa]">
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
                  Cliente
                </th>

                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
                  Tipo de seguro
                </th>

                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
                  Localidade
                </th>

                <th className="w-12" />
              </tr>
            </thead>

            <tbody className="divide-y divide-[#eef0f2]">
              {items.map((item) => {
                const client = item.client;
                const codes = getInsuranceCodes(item);

                const unassignedPolicy = item.policies.find(
                  (policy) => !policy.commercial_user_id,
                );

                return (
                  <tr
                    key={client.id}
                    onClick={() => onSelectClient(item)}
                    className="cursor-pointer transition-colors hover:bg-[#fafafa]"
                  >
                    <td className="px-5 py-4">
                      <p className="font-semibold text-[#24272d]">
                        {client.name}
                      </p>

                      <p className="mt-1 text-xs text-[#7a818c]">
                        NIF {client.nif ?? "—"}
                      </p>

                      {unassignedPolicy && (
                        <div className="mt-1.5">
                          <AssignMeButton
                            policyId={unassignedPolicy.id}
                            onDone={() => window.location.reload()}
                          />
                        </div>
                      )}
                    </td>

                    <td className="px-5 py-4">
                      {codes.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {codes.map((code) => (
                            <span
                              key={code}
                              className="inline-flex rounded-md bg-[#f4f5f7] px-2 py-0.5 text-[11px] font-semibold text-[#59616d]"
                            >
                              {code}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm font-medium text-[#343941]">
                          {getInsuranceTypesLabel(item)}
                        </p>
                      )}
                    </td>

                    <td className="px-5 py-4">
                      {client.city ? (
                        <span className="inline-flex items-center gap-1.5 text-sm text-[#555d68]">
                          <MapPin className="h-3.5 w-3.5 text-[#9aa0a8]" />
                          {client.city}
                        </span>
                      ) : (
                        <span className="text-sm text-[#9aa0a8]">—</span>
                      )}
                    </td>

                    <td className="px-3 py-4">
                      <ChevronRight className="h-4 w-4 text-[#9aa0a8]" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}