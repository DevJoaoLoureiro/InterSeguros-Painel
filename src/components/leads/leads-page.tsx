"use client";

import { useMemo, useState } from "react";

import type { Lead } from "@/types/lead";

import { LeadDetailsDrawer } from "@/components/leads/lead-details-drawer";
import { LeadsFilters } from "@/components/leads/leads-filters";
import { LeadsHeader } from "@/components/leads/leads-header";
import { LeadsSummary } from "@/components/leads/leads-summary";
import { LeadsTable } from "@/components/leads/leads-table";

type StoreOption = {
  id: string;
  name: string;
};

type CommercialOption = {
  id: string;
  full_name: string;
  store_id: string | null;
};

type LeadsPageProps = {
  leads: Lead[];
  stores: StoreOption[];
  commercials: CommercialOption[];
  currentUserRole: string | null;
};

export function LeadsPage({
  leads,
  stores,
  commercials,
  currentUserRole,
}: LeadsPageProps) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("todos");

  const [insuranceType, setInsuranceType] =
    useState("todos");

  const [store, setStore] = useState("todas");

  const [selectedLead, setSelectedLead] =
    useState<Lead | null>(null);

  const filteredLeads = useMemo(() => {
    const searchValue = search
      .toLocaleLowerCase("pt-PT")
      .trim();

    return leads.filter((lead) => {
      const matchesSearch =
        searchValue === "" ||
        lead.name
          .toLocaleLowerCase("pt-PT")
          .includes(searchValue) ||
        lead.phone.includes(searchValue);

      const matchesStatus =
        status === "todos" ||
        lead.status === status;

      const matchesInsurance =
        insuranceType === "todos" ||
        lead.insurance_type === insuranceType;

      const matchesStore =
        store === "todas" ||
        lead.store_id === store;

      return (
        matchesSearch &&
        matchesStatus &&
        matchesInsurance &&
        matchesStore
      );
    });
  }, [
    leads,
    search,
    status,
    insuranceType,
    store,
  ]);

  function clearFilters() {
    setSearch("");
    setStatus("todos");
    setInsuranceType("todos");
    setStore("todas");
  }

  return (
    <>
      <div className="space-y-6">
        <LeadsHeader total={leads.length} />

        <LeadsSummary
          leads={leads}
          selectedStatus={status}
          onStatusChange={setStatus}
        />

        <LeadsFilters
          search={search}
          status={status}
          insuranceType={insuranceType}
          store={store}
          onSearchChange={setSearch}
          onStatusChange={setStatus}
          onInsuranceTypeChange={
            setInsuranceType
          }
          onStoreChange={setStore}
          onClear={clearFilters}
        />

        <LeadsTable
          leads={filteredLeads}
          onSelectLead={setSelectedLead}
        />
      </div>
    <LeadDetailsDrawer
      lead={selectedLead}
      stores={stores}
      commercials={commercials}
      currentUserRole={currentUserRole}
      open={selectedLead !== null}
      onClose={() => setSelectedLead(null)}
    />
    </>
  );
}