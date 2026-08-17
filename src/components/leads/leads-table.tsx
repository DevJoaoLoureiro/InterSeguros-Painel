"use client";

import {
  ChevronRight,
  Inbox,
  Phone,
} from "lucide-react";

import type {
  Lead,
  LeadPriority,
  LeadStatus,
} from "@/types/lead";

type LeadsTableProps = {
  leads: Lead[];
  onSelectLead: (lead: Lead) => void;
};

const statusLabels: Record<LeadStatus, string> = {
  nova: "Nova",
  em_contacto: "Em contacto",
  proposta: "Proposta",
  ganha: "Ganha",
  perdida: "Perdida",
};

const priorityLabels: Record<LeadPriority, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
};

function formatDate(
  date: string | null | undefined,
) {
  if (!date) {
    return "—";
  }

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsedDate);
}

function getStatusClasses(status: LeadStatus) {
  switch (status) {
    case "nova":
      return "bg-blue-50 text-blue-700 ring-blue-600/10";

    case "em_contacto":
      return "bg-amber-50 text-amber-700 ring-amber-600/10";

    case "proposta":
      return "bg-violet-50 text-violet-700 ring-violet-600/10";

    case "ganha":
      return "bg-emerald-50 text-emerald-700 ring-emerald-600/10";

    case "perdida":
      return "bg-red-50 text-red-700 ring-red-600/10";
  }
}

function getPriorityClasses(
  priority: LeadPriority,
) {
  switch (priority) {
    case "alta":
      return "bg-red-50 text-red-700";

    case "media":
      return "bg-orange-50 text-orange-700";

    case "baixa":
      return "bg-slate-100 text-slate-600";
  }
}

export function LeadsTable({
  leads,
  onSelectLead,
}: LeadsTableProps) {
  if (leads.length === 0) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-[#e8eaed] bg-white px-6 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#f4f5f7]">
          <Inbox className="h-5 w-5 text-[#69717d]" />
        </div>

        <h3 className="text-base font-semibold text-[#24272d]">
          Nenhuma lead encontrada
        </h3>

        <p className="mt-1 max-w-sm text-sm text-[#7a818c]">
          As leads recebidas através do chatbot
          vão aparecer aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[#e8eaed] bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px]">
          <thead>
            <tr className="border-b border-[#e8eaed] bg-[#fafafa]">
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
                Lead
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
                Seguro
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
                Estado
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
                Prioridade
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
                Origem
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#7a818c]">
                Recebida
              </th>

              <th className="w-12" />
            </tr>
          </thead>

          <tbody className="divide-y divide-[#eef0f2]">
            {leads.map((lead) => (
              <tr
                key={lead.id}
                onClick={() => onSelectLead(lead)}
                className="cursor-pointer transition-colors hover:bg-[#fafafa]"
              >
                <td className="px-5 py-4">
                  <div>
                    <p className="font-semibold text-[#24272d]">
                      {lead.name}
                    </p>

                    <div className="mt-1 flex items-center gap-1.5 text-xs text-[#7a818c]">
                      <Phone className="h-3.5 w-3.5" />

                      <span>{lead.phone}</span>
                    </div>
                  </div>
                </td>

                <td className="px-5 py-4">
                  <p className="text-sm font-medium text-[#343941]">
                    {lead.insurance_type}
                  </p>

                  {lead.answers?.registration && (
                    <p className="mt-1 text-xs text-[#7a818c]">
                      Matrícula:{" "}
                      {lead.answers.registration}
                    </p>
                  )}
                </td>

                <td className="px-5 py-4">
                  <span
                    className={[
                      "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
                      getStatusClasses(lead.status),
                    ].join(" ")}
                  >
                    {statusLabels[lead.status]}
                  </span>
                </td>

                <td className="px-5 py-4">
                  <span
                    className={[
                      "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                      getPriorityClasses(
                        lead.priority,
                      ),
                    ].join(" ")}
                  >
                    {
                      priorityLabels[
                        lead.priority
                      ]
                    }
                  </span>
                </td>

                <td className="px-5 py-4">
                  <span className="text-sm text-[#555d68]">
                    {lead.source ?? "—"}
                  </span>
                </td>

                <td className="px-5 py-4">
                  <span className="whitespace-nowrap text-sm text-[#555d68]">
                    {formatDate(lead.created_at)}
                  </span>
                </td>

                <td className="px-3 py-4">
                  <ChevronRight className="h-4 w-4 text-[#9aa0a8]" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}