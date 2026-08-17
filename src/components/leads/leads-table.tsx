import { Eye, Mail, Phone } from "lucide-react";

import type { Lead } from "@/types/lead";
import { LeadPriorityBadge } from "@/components/leads/lead-priority-badge";
import { LeadStatusBadge } from "@/components/leads/lead-status-badge";

type LeadsTableProps = {
  leads: Lead[];
  onSelectLead: (lead: Lead) => void;
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function LeadsTable({
  leads,
  onSelectLead,
}: LeadsTableProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#e7e9ec] bg-white shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
      <div className="flex items-center justify-between border-b border-[#eceef1] px-5 py-4">
        <div>
          <h3 className="font-semibold text-[#20242a]">
            Lista de leads
          </h3>
          <p className="mt-1 text-xs text-[#7d848e]">
            {leads.length} resultado
            {leads.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[1050px]">
          <thead className="border-b border-[#eceef1] bg-[#fafbfc]">
            <tr>
              {[
                "Cliente",
                "Contacto",
                "Seguro",
                "Estado",
                "Prioridade",
                "Loja",
                "Responsável",
                "Entrada",
                "",
              ].map((column) => (
                <th
                  key={column}
                  className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-wide text-[#7b828d]"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {leads.map((lead) => (
              <tr
                key={lead.id}
                onClick={() => onSelectLead(lead)}
                className="cursor-pointer border-b border-[#f0f1f3] transition hover:bg-[#fff8f5] last:border-b-0"
              >
                <td className="px-5 py-4">
                  <p className="text-sm font-semibold text-[#20242a]">
                    {lead.name}
                  </p>
                  <p className="mt-1 text-xs capitalize text-[#7d848e]">
                    {lead.source}
                  </p>
                </td>

                <td className="px-5 py-4">
                  <p className="flex items-center gap-1.5 text-sm text-[#333842]">
                    <Phone className="h-3.5 w-3.5 text-[#89909a]" />
                    {lead.phone}
                  </p>

                  <p className="mt-1 flex items-center gap-1.5 text-xs text-[#7d848e]">
                    <Mail className="h-3.5 w-3.5" />
                    {lead.email ?? "Sem email"}
                  </p>
                </td>

                <td className="px-5 py-4 text-sm text-[#333842]">
                  {lead.insuranceType}
                </td>

                <td className="px-5 py-4">
                  <LeadStatusBadge status={lead.status} />
                </td>

                <td className="px-5 py-4">
                  <LeadPriorityBadge priority={lead.priority} />
                </td>

                <td className="px-5 py-4 text-sm text-[#333842]">
                  {lead.store}
                </td>

                <td className="px-5 py-4 text-sm text-[#333842]">
                  {lead.assignedTo ?? "Por atribuir"}
                </td>

                <td className="px-5 py-4 text-sm text-[#6f7680]">
                  {formatDate(lead.createdAt)}
                </td>

                <td className="px-5 py-4">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectLead(lead);
                    }}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#e1e4e8] text-[#4d5560] transition hover:border-[#ff4b0a] hover:text-[#ff4b0a]"
                    aria-label={`Abrir lead de ${lead.name}`}
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-[#edf0f2] lg:hidden">
        {leads.map((lead) => (
          <button
            key={lead.id}
            type="button"
            onClick={() => onSelectLead(lead)}
            className="block w-full p-4 text-left transition hover:bg-[#fff8f5]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold text-[#20242a]">
                  {lead.name}
                </p>
                <p className="mt-1 text-sm text-[#6f7680]">
                  {lead.insuranceType}
                </p>
              </div>

              <LeadStatusBadge status={lead.status} />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-[#9298a1]">Contacto</p>
                <p className="mt-1 font-medium text-[#424852]">
                  {lead.phone}
                </p>
              </div>

              <div>
                <p className="text-[#9298a1]">Loja</p>
                <p className="mt-1 font-medium text-[#424852]">
                  {lead.store}
                </p>
              </div>

              <div>
                <p className="text-[#9298a1]">Responsável</p>
                <p className="mt-1 font-medium text-[#424852]">
                  {lead.assignedTo ?? "Por atribuir"}
                </p>
              </div>

              <div>
                <p className="text-[#9298a1]">Prioridade</p>
                <div className="mt-1">
                  <LeadPriorityBadge priority={lead.priority} />
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {leads.length === 0 && (
        <div className="px-5 py-16 text-center">
          <p className="font-medium text-[#4d5560]">
            Nenhuma lead encontrada
          </p>
          <p className="mt-1 text-sm text-[#89909a]">
            Experimenta alterar ou limpar os filtros.
          </p>
        </div>
      )}
    </div>
  );
}