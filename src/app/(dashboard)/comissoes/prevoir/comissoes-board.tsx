"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  CircleAlert,
  Coins,
  FileText,
  FileUp,
  Loader2,
  Pencil,
  ReceiptText,
} from "lucide-react";

import {
  getCommissionsDetail,
  getCommissionsSummaryByStore,
  getOfficialClosing,
  getOfficialCommissionMovements,
  parseOfficialClosingPdf,
  saveOfficialClosing,
  type CommissionReceiptRow,
  type OfficialClosing,
  type OfficialCommissionMovement,
  type ParsedCommissionMovement,
  type StoreCommissionSummary,
  type StoreOption,
} from "../actions";

type Props = {
  stores: StoreOption[];
  canAccessAll: boolean;
  initialMonth: string;
};

type Tab = "summary" | "stores" | "movements";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

function monthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);

  return new Intl.DateTimeFormat("pt-PT", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, monthNumber - 1, 1));
}

function planTypeLabel(planType: string | null) {
  switch (planType) {
    case "VIDA":
      return "Vida";
    case "NAO_VIDA":
      return "Não Vida";
    case "FINANCEIROS":
      return "Financeiros";
    default:
      return "Não classificado";
  }
}

function movementTypeLabel(type: string) {
  switch (type) {
    case "NEW_POLICY":
      return "Apólice nova";
    case "REVERSAL":
      return "Estorno";
    case "COMMISSION":
      return "Comissão";
    default:
      return type;
  }
}

function MetricCard({
  label,
  value,
  helper,
  tone = "default",
}: {
  label: string;
  value: string;
  helper?: string;
  tone?: "default" | "orange" | "success" | "warning";
}) {
  const valueClass =
    tone === "orange"
      ? "text-[#ff4b0a]"
      : tone === "success"
        ? "text-emerald-700"
        : tone === "warning"
          ? "text-amber-700"
          : "text-[#1f2329]";

  return (
    <div className="rounded-2xl border border-[#e7e9ec] bg-white p-4 shadow-[0_2px_8px_rgba(20,25,35,0.03)]">
      <p className="text-xs font-medium text-[#858c96]">{label}</p>
      <p className={`mt-1.5 text-xl font-semibold tracking-tight ${valueClass}`}>
        {value}
      </p>
      {helper ? <p className="mt-1 text-xs text-[#a0a6ae]">{helper}</p> : null}
    </div>
  );
}

export function ComissoesBoard({
  stores,
  canAccessAll: _canAccessAll,
  initialMonth,
}: Props) {
  const [month, setMonth] = useState(initialMonth);
  const [activeTab, setActiveTab] = useState<Tab>("summary");

  const [summary, setSummary] = useState<StoreCommissionSummary[]>([]);
  const [official, setOfficial] = useState<OfficialClosing | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommissionReceiptRow[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadedDetailKey, setLoadedDetailKey] = useState<string | null>(null);

  const [officialMovements, setOfficialMovements] = useState<
    OfficialCommissionMovement[]
  >([]);
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [loadedMovementsMonth, setLoadedMovementsMonth] = useState<string | null>(
    null,
  );

  const [editingOfficial, setEditingOfficial] = useState(false);
  const [savingOfficial, setSavingOfficial] = useState(false);
  const [officialError, setOfficialError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedMovements, setParsedMovements] = useState<
    ParsedCommissionMovement[]
  >([]);

  const [formVida, setFormVida] = useState("");
  const [formApBruto, setFormApBruto] = useState("");
  const [formApRetencao, setFormApRetencao] = useState("");
  const [formApLiquido, setFormApLiquido] = useState("");
  const [formSaude, setFormSaude] = useState("");
  const [formFechoDate, setFormFechoDate] = useState("");

  function fillOfficialForm(value: OfficialClosing | null) {
    if (!value) {
      setFormVida("");
      setFormApBruto("");
      setFormApRetencao("");
      setFormApLiquido("");
      setFormSaude("0");
      setFormFechoDate("");
      return;
    }

    setFormVida(String(value.vidaLiquido));
    setFormApBruto(String(value.apBruto));
    setFormApRetencao(String(value.apRetencao));
    setFormApLiquido(String(value.apLiquido));
    setFormSaude(String(value.saudeLiquido));
    setFormFechoDate(value.fechoDate);
  }

  // Carrega apenas o essencial quando o mês muda.
  // Detalhe de loja e movimentos oficiais ficam lazy-loaded nas respetivas tabs.
  useEffect(() => {
    let cancelled = false;

    async function loadOverview() {
      setLoadingOverview(true);
      setOverviewError(null);
      setEditingOfficial(false);
      setParseError(null);
      setParsedMovements([]);
      setLoadedDetailKey(null);
      setDetail([]);
      setLoadedMovementsMonth(null);
      setOfficialMovements([]);

      try {
        const [summaryResult, officialResult] = await Promise.all([
          getCommissionsSummaryByStore(month),
          getOfficialClosing(month),
        ]);

        if (cancelled) return;

        setSummary(summaryResult);
        setOfficial(officialResult);
        fillOfficialForm(officialResult);

        setSelectedStoreId((current) => {
          if (current && summaryResult.some((item) => item.storeId === current)) {
            return current;
          }
          return summaryResult[0]?.storeId ?? null;
        });
      } catch (error) {
        if (!cancelled) {
          setOverviewError(
            error instanceof Error
              ? error.message
              : "Não foi possível carregar as comissões.",
          );
        }
      } finally {
        if (!cancelled) setLoadingOverview(false);
      }
    }

    void loadOverview();

    return () => {
      cancelled = true;
    };
  }, [month]);

  // Só vai buscar detalhe quando o utilizador abre "Por loja".
  useEffect(() => {
    if (activeTab !== "stores" || !selectedStoreId) return;

    const key = `${month}:${selectedStoreId}`;
    if (loadedDetailKey === key) return;

    let cancelled = false;

    async function loadDetail() {
      setLoadingDetail(true);

      try {
        const result = await getCommissionsDetail(selectedStoreId!, month);
        if (cancelled) return;

        setDetail(result);
        setLoadedDetailKey(key);
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    }

    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [activeTab, loadedDetailKey, month, selectedStoreId]);

  // Só vai buscar movimentos quando o utilizador abre "Movimentos".
  useEffect(() => {
    if (activeTab !== "movements" || !official) return;
    if (loadedMovementsMonth === month) return;

    let cancelled = false;

    async function loadMovements() {
      setLoadingMovements(true);

      try {
        const result = await getOfficialCommissionMovements(month);
        if (cancelled) return;

        setOfficialMovements(result);
        setLoadedMovementsMonth(month);
      } finally {
        if (!cancelled) setLoadingMovements(false);
      }
    }

    void loadMovements();

    return () => {
      cancelled = true;
    };
  }, [activeTab, loadedMovementsMonth, month, official]);

  const totalMonth = useMemo(
    () => summary.reduce((sum, store) => sum + store.totalLiquido, 0),
    [summary],
  );

  const selectedStore = useMemo(
    () => summary.find((store) => store.storeId === selectedStoreId) ?? null,
    [selectedStoreId, summary],
  );

  const officialTotal = official
    ? official.vidaLiquido + official.apLiquido + official.saudeLiquido
    : null;

  const difference = officialTotal === null ? null : totalMonth - officialTotal;

  const officialGrossFromMovements = useMemo(
    () =>
      officialMovements.reduce(
        (sum, movement) => sum + movement.grossAmount,
        0,
      ),
    [officialMovements],
  );

  const parsedGross = useMemo(
    () => parsedMovements.reduce((sum, movement) => sum + movement.grossAmount, 0),
    [parsedMovements],
  );

  async function handlePdfUpload(file: File) {
    setParsing(true);
    setParseError(null);

    try {
      const data = new FormData();
      data.set("file", file);

      const parsed = await parseOfficialClosingPdf(data);

      if (parsed.fechoDate) setFormFechoDate(parsed.fechoDate);
      if (parsed.vidaLiquido !== null) setFormVida(String(parsed.vidaLiquido));
      if (parsed.apBruto !== null) setFormApBruto(String(parsed.apBruto));
      if (parsed.apRetencao !== null)
        setFormApRetencao(String(parsed.apRetencao));
      if (parsed.apLiquido !== null) setFormApLiquido(String(parsed.apLiquido));
      if (parsed.saudeLiquido !== null)
        setFormSaude(String(parsed.saudeLiquido));

      setParsedMovements(parsed.movements);

      if (parsed.vidaLiquido === null && parsed.apLiquido === null) {
        setParseError(
          "Não consegui ler os totais automaticamente. Confirma os campos antes de guardar.",
        );
      } else if (parsed.movements.length === 0) {
        setParseError(
          "Os totais foram lidos, mas não encontrei movimentos detalhados no PDF.",
        );
      }
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Erro ao ler o PDF.");
    } finally {
      setParsing(false);
    }
  }

  async function handleSaveOfficial() {
    setSavingOfficial(true);
    setOfficialError(null);

    try {
      await saveOfficialClosing({
        month,
        fechoDate: formFechoDate || `${month}-01`,
        vidaLiquido: Number(formVida) || 0,
        apBruto: Number(formApBruto) || 0,
        apRetencao: Number(formApRetencao) || 0,
        apLiquido: Number(formApLiquido) || 0,
        saudeLiquido: Number(formSaude) || 0,
        notes: null,
        movements: parsedMovements.length > 0 ? parsedMovements : undefined,
      });

      const closingResult = await getOfficialClosing(month);
      setOfficial(closingResult);
      fillOfficialForm(closingResult);
      setEditingOfficial(false);
      setParsedMovements([]);
      setLoadedMovementsMonth(null);
      setOfficialMovements([]);
    } catch (error) {
      setOfficialError(
        error instanceof Error ? error.message : "Não foi possível guardar.",
      );
    } finally {
      setSavingOfficial(false);
    }
  }

  if (stores.length === 0) {
    return (
      <div className="rounded-2xl border border-[#e5e8ec] bg-white p-8 text-center text-sm text-[#7d848e]">
        Não tens nenhuma loja associada.
      </div>
    );
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "summary", label: "Resumo" },
    { id: "stores", label: "Por loja" },
    { id: "movements", label: "Movimentos oficiais" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-[#e7e9ec] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-[#a0a6ae]">
            Período
          </p>
          <p className="mt-1 text-lg font-semibold capitalize text-[#20242a]">
            {monthLabel(month)}
          </p>
        </div>

        <input
          type="month"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
          className="h-10 rounded-xl border border-[#e1e4e8] bg-white px-3 text-sm outline-none focus:border-[#ff4b0a]"
        />
      </div>

      {overviewError ? (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <CircleAlert className="h-4 w-4 shrink-0" />
          {overviewError}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          label="Estimativa automática"
          value={loadingOverview ? "—" : formatCurrency(totalMonth)}
          helper="Calculada pelos movimentos disponíveis"
        />
        <MetricCard
          label="Fecho oficial"
          value={officialTotal === null ? "—" : formatCurrency(officialTotal)}
          helper={official ? `Fechado em ${formatDate(official.fechoDate)}` : "Ainda não importado"}
          tone={official ? "orange" : "default"}
        />
        <MetricCard
          label="Diferença"
          value={difference === null ? "—" : formatCurrency(difference)}
          helper={
            difference === null
              ? "Disponível após o fecho"
              : Math.abs(difference) < 0.005
                ? "Sem diferença"
                : "Estimativa vs. oficial"
          }
          tone={
            difference === null
              ? "default"
              : Math.abs(difference) < 0.005
                ? "success"
                : "warning"
          }
        />
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-[#e5e8ec] bg-[#f7f8f9] p-1">
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={[
                "whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition",
                active
                  ? "bg-white text-[#20242a] shadow-sm"
                  : "text-[#7d848e] hover:text-[#34383f]",
              ].join(" ")}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "summary" ? (
        <section className="overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.03)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0f2] px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#fff3ed] text-[#ff4b0a]">
                <FileText className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#20242a]">Fecho oficial</p>
                <p className="text-xs text-[#8a9099]">
                  {official ? "Valores confirmados pela Prévoir" : "Importa o PDF quando o receberes"}
                </p>
              </div>
            </div>

            {!editingOfficial ? (
              <button
                type="button"
                onClick={() => setEditingOfficial(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e8ec] bg-white px-3 py-2 text-xs font-semibold text-[#555d68] transition hover:border-[#ffb28d] hover:text-[#ff4b0a]"
              >
                {official ? <Pencil className="h-3.5 w-3.5" /> : <FileUp className="h-3.5 w-3.5" />}
                {official ? "Editar fecho" : "Importar fecho"}
              </button>
            ) : null}
          </div>

          <div className="p-5">
            {loadingOverview ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-[#8a9099]">
                <Loader2 className="h-4 w-4 animate-spin" />
                A carregar...
              </div>
            ) : editingOfficial ? (
              <div className="space-y-4">
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-[#ffb489] bg-[#fff8f5] p-4 transition hover:bg-[#fff2eb]">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-[#ff4b0a] shadow-sm">
                    {parsing ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileUp className="h-5 w-5" />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#ff4b0a]">
                      {parsing ? "A ler PDF..." : "Selecionar PDF da Prévoir"}
                    </p>
                    <p className="mt-0.5 text-xs text-[#8a9099]">
                      Preenche automaticamente os valores e movimentos.
                    </p>
                  </div>
                  <input
                    type="file"
                    accept="application/pdf"
                    disabled={parsing}
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void handlePdfUpload(file);
                    }}
                  />
                </label>

                {parsedMovements.length > 0 ? (
                  <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
                    <span className="font-medium text-emerald-800">
                      {parsedMovements.length} movimentos encontrados
                    </span>
                    <span className="font-semibold text-emerald-800">
                      {formatCurrency(parsedGross)}
                    </span>
                  </div>
                ) : null}

                {parseError ? <p className="text-xs text-amber-700">{parseError}</p> : null}

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    ["Data do fecho", formFechoDate, setFormFechoDate, "date"],
                    ["Vida líquido", formVida, setFormVida, "number"],
                    ["AP bruto", formApBruto, setFormApBruto, "number"],
                    ["AP retenção", formApRetencao, setFormApRetencao, "number"],
                    ["AP líquido", formApLiquido, setFormApLiquido, "number"],
                    ["Saúde líquido", formSaude, setFormSaude, "number"],
                  ].map(([label, value, setter, type]) => (
                    <label key={String(label)} className="block">
                      <span className="text-xs text-[#8a9099]">{String(label)}</span>
                      <input
                        type={String(type)}
                        step={type === "number" ? "0.01" : undefined}
                        value={String(value)}
                        onChange={(event) =>
                          (setter as (value: string) => void)(event.target.value)
                        }
                        className="mt-1 h-10 w-full rounded-lg border border-[#e1e4e8] px-3 text-sm outline-none focus:border-[#ff4b0a]"
                      />
                    </label>
                  ))}
                </div>

                {officialError ? <p className="text-xs text-red-600">{officialError}</p> : null}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingOfficial(false);
                      setParsedMovements([]);
                      setParseError(null);
                      fillOfficialForm(official);
                    }}
                    className="rounded-lg border border-[#e1e4e8] px-4 py-2 text-sm font-medium text-[#59616d]"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={savingOfficial}
                    onClick={handleSaveOfficial}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#ff4b0a] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {savingOfficial ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {savingOfficial ? "A guardar..." : "Guardar fecho"}
                  </button>
                </div>
              </div>
            ) : official ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl bg-[#fafbfc] p-4">
                  <p className="text-xs text-[#8a9099]">Vida líquido</p>
                  <p className="mt-1 text-lg font-semibold text-[#20242a]">
                    {formatCurrency(official.vidaLiquido)}
                  </p>
                </div>
                <div className="rounded-xl bg-[#fafbfc] p-4">
                  <p className="text-xs text-[#8a9099]">AP líquido</p>
                  <p className="mt-1 text-lg font-semibold text-[#20242a]">
                    {formatCurrency(official.apLiquido)}
                  </p>
                </div>
                <div className="rounded-xl bg-[#fafbfc] p-4">
                  <p className="text-xs text-[#8a9099]">Retenção AP</p>
                  <p className="mt-1 text-lg font-semibold text-[#20242a]">
                    {formatCurrency(official.apRetencao)}
                  </p>
                </div>
                <div className="rounded-xl bg-[#fff5f0] p-4">
                  <p className="text-xs font-medium text-[#c7582a]">Total oficial</p>
                  <p className="mt-1 text-lg font-semibold text-[#ff4b0a]">
                    {formatCurrency(officialTotal ?? 0)}
                  </p>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEditingOfficial(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#ffd4b8] bg-[#fff8f5] px-4 py-8 text-sm font-semibold text-[#ff4b0a] transition hover:bg-[#fff2eb]"
              >
                <FileUp className="h-4 w-4" />
                Importar fecho deste mês
              </button>
            )}
          </div>
        </section>
      ) : null}

      {activeTab === "stores" ? (
        <section className="space-y-4">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {summary.map((store) => {
              const active = store.storeId === selectedStoreId;
              return (
                <button
                  key={store.storeId}
                  type="button"
                  onClick={() => {
                    setSelectedStoreId(store.storeId);
                    setLoadedDetailKey(null);
                  }}
                  className={[
                    "inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition",
                    active
                      ? "bg-[#20242a] text-white"
                      : "border border-[#e5e8ec] bg-white text-[#59616d] hover:bg-[#f7f8f9]",
                  ].join(" ")}
                >
                  <Building2 className="h-4 w-4" />
                  {store.storeName}
                  <span className={active ? "text-white/70" : "text-[#a0a6ae]"}>
                    {formatCurrency(store.totalLiquido)}
                  </span>
                </button>
              );
            })}
          </div>

          {selectedStore ? (
            <div className="overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white">
              <div className="grid gap-3 border-b border-[#edf0f2] p-4 sm:grid-cols-3">
                <MetricCard
                  label="Vida"
                  value={formatCurrency(selectedStore.vidaBruto)}
                />
                <MetricCard
                  label="Não Vida líquido"
                  value={formatCurrency(selectedStore.naoVidaLiquido)}
                  helper={`Retenção: ${formatCurrency(selectedStore.naoVidaRetencao)}`}
                />
                <MetricCard
                  label="Total da loja"
                  value={formatCurrency(selectedStore.totalLiquido)}
                  tone="orange"
                />
              </div>

              <div className="overflow-x-auto">
                {loadingDetail ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-sm text-[#8a9099]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    A carregar detalhe da loja...
                  </div>
                ) : detail.length === 0 ? (
                  <p className="px-5 py-10 text-center text-sm text-[#8a9099]">
                    Sem recibos com comissão neste mês.
                  </p>
                ) : (
                  <table className="w-full min-w-[820px] text-left">
                    <thead>
                      <tr className="border-b border-[#e8eaed] bg-[#fafafa]">
                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">Cliente</th>
                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">Apólice</th>
                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">Recibo</th>
                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">Ramo</th>
                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">Data</th>
                        <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#7a818c]">Líquido</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#eef0f2]">
                      {detail.map((row) => (
                        <tr key={row.receiptId} className="hover:bg-[#fafafa]">
                          <td className="px-5 py-3 text-sm font-medium text-[#24272d]">{row.clientName}</td>
                          <td className="px-5 py-3 text-sm text-[#555d68]">{row.policyNumber}</td>
                          <td className="px-5 py-3 text-sm text-[#555d68]">{row.receiptNumber ?? "—"}</td>
                          <td className="px-5 py-3 text-sm text-[#555d68]">{planTypeLabel(row.planType)}</td>
                          <td className="px-5 py-3 text-sm text-[#555d68]">{formatDate(row.situationDate)}</td>
                          <td className="px-5 py-3 text-right text-sm font-semibold text-[#24272d]">{formatCurrency(row.commissionLiquido)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeTab === "movements" ? (
        <section className="overflow-hidden rounded-2xl border border-[#e5e8ec] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0f2] px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#f4f5f7] text-[#666e78]">
                <ReceiptText className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#20242a]">Movimentos oficiais</p>
                <p className="text-xs text-[#8a9099]">Só são carregados quando abres esta área.</p>
              </div>
            </div>

            {!loadingMovements && loadedMovementsMonth === month ? (
              <div className="text-right">
                <p className="text-xs text-[#8a9099]">{officialMovements.length} movimentos</p>
                <p className="text-sm font-semibold text-[#20242a]">{formatCurrency(officialGrossFromMovements)}</p>
              </div>
            ) : null}
          </div>

          {!official ? (
            <div className="px-5 py-12 text-center">
              <FileText className="mx-auto h-6 w-6 text-[#b1b6bd]" />
              <p className="mt-3 text-sm font-medium text-[#59616d]">Ainda não existe fecho oficial</p>
              <p className="mt-1 text-xs text-[#9aa0a8]">Importa primeiro o PDF no separador Resumo.</p>
            </div>
          ) : loadingMovements ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-[#8a9099]">
              <Loader2 className="h-4 w-4 animate-spin" />
              A carregar movimentos...
            </div>
          ) : officialMovements.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-[#8a9099]">Sem movimentos oficiais importados.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left">
                <thead>
                  <tr className="border-b border-[#e8eaed] bg-[#fafafa]">
                    <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">Agente</th>
                    <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">Apólice</th>
                    <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#7a818c]">Tipo</th>
                    <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#7a818c]">Comissão</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef0f2]">
                  {officialMovements.map((movement) => (
                    <tr key={movement.id} className="hover:bg-[#fafafa]">
                      <td className="px-5 py-3 text-sm text-[#555d68]">{movement.agentCode}</td>
                      <td className="px-5 py-3 text-sm font-medium text-[#24272d]">
                        {movement.policyPrefix}/{movement.policyNumber.padStart(8, "0")}
                      </td>
                      <td className="px-5 py-3 text-sm text-[#555d68]">{movementTypeLabel(movement.movementType)}</td>
                      <td className={`px-5 py-3 text-right text-sm font-semibold ${movement.grossAmount < 0 ? "text-red-600" : "text-[#24272d]"}`}>
                        {formatCurrency(movement.grossAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {!loadingOverview ? (
        <div className="flex items-start gap-2 rounded-xl bg-[#f7f8f9] px-4 py-3 text-xs leading-5 text-[#7d848e]">
          {official ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          ) : (
            <Coins className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          {official
            ? "O fecho oficial está registado. Usa a estimativa apenas como apoio e reconciliação."
            : "Enquanto não houver fecho oficial, o valor apresentado é uma estimativa automática baseada nos movimentos disponíveis."}
        </div>
      ) : null}
    </div>
  );
}
