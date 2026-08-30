"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";

import {
  classifyProduct,
  type InsuranceLineOption,
  type UnclassifiedProduct,
} from "./action";

type Props = {
  companyCode: string;
  product: UnclassifiedProduct;
  lineOptions: InsuranceLineOption[];
};

export function ProductClassificationRow({
  companyCode,
  product,
  lineOptions,
}: Props) {
  const [selectedLineId, setSelectedLineId] = useState("");
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    if (!selectedLineId) {
      return;
    }

    setError(null);

    startTransition(async () => {
      try {
        await classifyProduct({
          companyCode,
          productCode: product.productCode,
          productName: product.productName,
          insuranceLineId: selectedLineId,
        });

        setSaved(true);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Erro desconhecido.",
        );
      }
    });
  }

  if (saved) {
    return (
      <tr className="bg-green-50/50 text-sm">
        <td className="px-5 py-4 text-[#606771]">
          #{product.productCode}
        </td>

        <td className="px-5 py-4 font-medium text-[#20242a]">
          {product.productName ?? "—"}
        </td>

        <td className="px-5 py-4 text-[#606771]">
          {product.policiesCount}
        </td>

        <td className="px-5 py-4 text-green-700" colSpan={2}>
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4" />
            Classificado
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="text-sm">
      <td className="px-5 py-4 text-[#606771]">
        #{product.productCode}
      </td>

      <td className="px-5 py-4 font-medium text-[#20242a]">
        {product.productName ?? "—"}
      </td>

      <td className="px-5 py-4 text-[#606771]">
        {product.policiesCount}
      </td>

      <td className="px-5 py-4">
        <select
          value={selectedLineId}
          onChange={(event) =>
            setSelectedLineId(event.target.value)
          }
          className="h-10 w-full rounded-lg border border-[#e4e6e9] bg-white px-3 text-sm outline-none focus:border-[#ff4b0a]"
        >
          <option value="">Escolher ramo...</option>

          {lineOptions.map((line) => (
            <option key={line.id} value={line.id}>
              {line.name} ({line.planType})
            </option>
          ))}
        </select>

        {error && (
          <p className="mt-1 text-xs text-red-600">{error}</p>
        )}
      </td>

      <td className="px-5 py-4 text-right">
        <button
          type="button"
          disabled={!selectedLineId || isPending}
          onClick={handleSave}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#ff4b0a] px-4 text-sm font-medium text-white transition hover:bg-[#e64409] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPending && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          Guardar
        </button>
      </td>
    </tr>
  );
}