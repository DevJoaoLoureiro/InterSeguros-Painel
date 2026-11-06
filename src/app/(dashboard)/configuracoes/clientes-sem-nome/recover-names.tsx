"use client";

import { useState } from "react";
import {
  CheckCircle2,
  FileUp,
  Loader2,
  Search,
  TriangleAlert,
} from "lucide-react";

/*
 * Envia o ficheiro de Clientes da Carteira Total para
 * /api/dev/zurich-recuperar-nomes. Primeiro "Simular" (não grava),
 * depois "Gravar" com o mesmo ficheiro.
 */

type Result = {
  success: boolean;
  error?: string;
  mode?: string;
  fileClients?: number;
  placeholders?: number;
  found?: number;
  updated?: number;
  notFound?: number;
  errors?: number;
  errorSamples?: string[];
};

export function RecoverNames() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"simulate" | "apply" | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  // Só deixa gravar depois de uma simulação com este ficheiro.
  const [simulatedFile, setSimulatedFile] = useState<File | null>(null);

  async function send(apply: boolean) {
    if (!file) return;

    if (
      apply &&
      !window.confirm(
        `Gravar os nomes de ${result?.found ?? 0} clientes? Só são alterados clientes com nome provisório.`,
      )
    ) {
      return;
    }

    setBusy(apply ? "apply" : "simulate");
    setResult(null);

    try {
      const form = new FormData();
      form.append("ficheiro", file);

      const response = await fetch(
        `/api/dev/zurich-recuperar-nomes${apply ? "?apply=1" : ""}`,
        { method: "POST", body: form },
      );

      const data = (await response.json()) as Result;
      setResult(data);
      if (!apply && data.success) setSimulatedFile(file);
      if (apply) setSimulatedFile(null);
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : "Erro de rede.",
      });
    } finally {
      setBusy(null);
    }
  }

  const canApply =
    !!file && simulatedFile === file && (result?.found ?? 0) > 0 && !busy;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        <h2 className="text-sm font-semibold text-[#20242a]">
          1. Descarrega o ficheiro de Clientes da Carteira Total
        </h2>
        <p className="mt-1 text-sm text-[#737a84]">
          No portal MyZurich, menu superior <strong>Serviços</strong> →
          Carteira Total → ficheiro de <strong>Clientes</strong>. Traz todos os
          clientes da agência, incluindo os anulados, e não gasta o token da
          Zurich.
        </p>

        <h2 className="mt-5 text-sm font-semibold text-[#20242a]">
          2. Envia-o aqui
        </h2>

        <label className="mt-2 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-[#dfe2e6] bg-[#fafbfc] px-4 py-4 transition hover:border-[#ffb899]">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-[#ea5b0c]">
            <FileUp className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-[#20242a]">
              {file ? file.name : "Escolher ficheiro…"}
            </span>
            <span className="block text-xs text-[#8a9099]">
              {file
                ? `${Math.round(file.size / 1024)} KB`
                : "O ficheiro de texto tal como vem da Zurich."}
            </span>
          </span>
          <input
            type="file"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              setSimulatedFile(null);
            }}
          />
        </label>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!file || !!busy}
            onClick={() => send(false)}
            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-[#e4e6e9] bg-white px-4 text-sm font-medium text-[#40464f] transition hover:border-[#ffb899] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "simulate" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Simular (não grava)
          </button>

          <button
            type="button"
            disabled={!canApply}
            onClick={() => send(true)}
            title={
              canApply ? undefined : "Simula primeiro com este ficheiro."
            }
            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-[#ff4b0a] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#e64409] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === "apply" && <Loader2 className="h-4 w-4 animate-spin" />}
            Gravar nomes
          </button>
        </div>
      </section>

      {result && <ResultCard result={result} />}
    </div>
  );
}

function ResultCard({ result }: { result: Result }) {
  if (!result.success) {
    return (
      <div className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <TriangleAlert className="h-5 w-5 shrink-0" />
        {result.error ?? "Não foi possível processar o ficheiro."}
      </div>
    );
  }

  const saved = result.mode === "gravado";

  return (
    <section className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
      <div className="flex items-center gap-2">
        <CheckCircle2
          className={`h-5 w-5 ${saved ? "text-green-600" : "text-blue-600"}`}
        />
        <h2 className="text-sm font-semibold text-[#20242a]">
          {saved ? "Nomes gravados" : "Simulação — nada foi gravado"}
        </h2>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Clientes no ficheiro" value={result.fileClients} />
        <Stat label="Sem nome no CRM" value={result.placeholders} />
        <Stat label="Encontrados" value={result.found} tone="text-green-700" />
        <Stat label="Não encontrados" value={result.notFound} />
      </dl>

      {saved && (
        <p className="mt-4 text-sm text-[#40464f]">
          {result.updated ?? 0} clientes ficaram com o nome verdadeiro.
        </p>
      )}

      {!saved && (result.found ?? 0) > 0 && (
        <p className="mt-4 text-sm text-[#40464f]">
          Se os números fizerem sentido, carrega em{" "}
          <strong>Gravar nomes</strong>.
        </p>
      )}

      {(result.notFound ?? 0) > 0 && (
        <p className="mt-2 text-xs text-[#8a9099]">
          Os não encontrados não estão neste ficheiro (podem ser de outra
          conta/loja Zurich). Mantêm o nome provisório e podem ser
          corrigidos à mão na ficha do cliente.
        </p>
      )}

      {(result.errors ?? 0) > 0 && (
        <p className="mt-2 text-xs text-red-700">
          {result.errors} erros ao gravar
          {result.errorSamples?.length ? `: ${result.errorSamples[0]}` : ""}.
        </p>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  tone = "text-[#20242a]",
}: {
  label: string;
  value?: number;
  tone?: string;
}) {
  return (
    <div className="rounded-xl bg-[#fafbfc] px-3 py-2.5">
      <dt className="text-[11px] text-[#8a9099]">{label}</dt>
      <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${tone}`}>
        {value ?? 0}
      </dd>
    </div>
  );
}
