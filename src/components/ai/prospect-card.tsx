"use client";

import { Check, ExternalLink, Handshake, Loader2, MapPin, Phone, Plus, Star, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { saveProspectAsLead } from "@/app/(dashboard)/leads/prospecting-actions";
import { PROSPECT_GRADE_LABELS, type Prospect, type ProspectGrade } from "@/lib/prospecting/types";

const GRADE_CLASSES: Record<ProspectGrade, string> = {
  boa: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  media: "bg-amber-50 text-amber-700 ring-amber-200",
  ma: "bg-[#f3f4f6] text-[#6f7680] ring-[#e1e4e8]",
};

type SaveState = "idle" | "saving" | "saved" | "duplicate";

export function ProspectCard({ prospect }: { prospect: Prospect }) {
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setState("saving");
    setError(null);

    try {
      const result = await saveProspectAsLead(prospect);

      if (!result.success) {
        setError(result.message);
        setState("idle");
        return;
      }

      setState(result.duplicate ? "duplicate" : "saved");
    } catch {
      setError("Não foi possível guardar a lead.");
      setState("idle");
    }
  }

  return (
    <div className="rounded-xl border border-[#e5e8ec] bg-white p-3 text-[#25292f]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{prospect.name}</p>

          <p className="mt-0.5 truncate text-xs text-[#7d848e]">
            {prospect.activity}
            {prospect.locality ? ` · ${prospect.locality}` : ""}
          </p>
        </div>

        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${GRADE_CLASSES[prospect.grade]}`}
        >
          {PROSPECT_GRADE_LABELS[prospect.grade]}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#59616d]">
        <a href={`tel:${prospect.phone.replace(/\s/g, "")}`} className="flex items-center gap-1 font-medium hover:text-[#ff4b0a]">
          <Phone className="h-3.5 w-3.5" />
          {prospect.phone}
        </a>

        {prospect.rating !== null && (
          <span className="flex items-center gap-1">
            <Star className="h-3.5 w-3.5" />
            {prospect.rating.toLocaleString("pt-PT")} ({prospect.reviews})
          </span>
        )}

        {prospect.mapsUrl && (
          <a
            href={prospect.mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-[#ff4b0a]"
          >
            {prospect.source === "google" ? (
              <MapPin className="h-3.5 w-3.5" />
            ) : (
              <ExternalLink className="h-3.5 w-3.5" />
            )}
            {prospect.source === "google" ? "Mapa" : "Fonte"}
          </a>
        )}
      </div>

      {!prospect.phoneVerified && (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-amber-700">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          Telefone por confirmar: verifica na fonte antes de ligar.
        </p>
      )}

      <p className="mt-2 text-xs leading-5 text-[#59616d]">{prospect.reason}</p>

      <div className="mt-2 flex flex-wrap gap-1">
        {prospect.products.map((product) => (
          <span key={product} className="rounded-md bg-orange-50 px-1.5 py-0.5 text-[11px] font-medium text-[#c2410c]">
            {product}
          </span>
        ))}
      </div>

      {prospect.partnerHint && (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-[#59616d]">
          <Handshake className="h-3.5 w-3.5" />
          Pode valer mais como parceiro que referencia clientes.
        </p>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={state !== "idle"}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#17191d] px-3 py-2 text-xs font-semibold text-white disabled:cursor-default disabled:bg-[#f3f4f6] disabled:text-[#59616d]"
      >
        {state === "idle" && (
          <>
            <Plus className="h-3.5 w-3.5" />
            Guardar como lead
          </>
        )}

        {state === "saving" && (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            A preparar o guião...
          </>
        )}

        {state === "saved" && (
          <>
            <Check className="h-3.5 w-3.5" />
            Guardada nas leads
          </>
        )}

        {state === "duplicate" && (
          <>
            <Check className="h-3.5 w-3.5" />
            Já estava nas leads
          </>
        )}
      </button>

      {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
