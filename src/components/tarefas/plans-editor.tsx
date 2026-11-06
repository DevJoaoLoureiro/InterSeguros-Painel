"use client";

import { Plus, X } from "lucide-react";

import type { MessagePlan } from "@/lib/tasks/client-message";

const fieldClass =
  "h-9 rounded-lg border border-[#e4e6e9] bg-white px-2.5 text-sm outline-none transition focus:border-[#ff4b0a]";

export function PlansEditor({
  plans,
  onChange,
}: {
  plans: MessagePlan[];
  onChange: (plans: MessagePlan[]) => void;
}) {
  function update(index: number, patch: Partial<MessagePlan>) {
    onChange(plans.map((plan, i) => (i === index ? { ...plan, ...patch } : plan)));
  }

  return (
    <div className="space-y-1.5">
      {plans.map((plan, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <input
            value={plan.name}
            onChange={(e) => update(index, { name: e.target.value })}
            placeholder="Plano"
            className={`${fieldClass} w-28 shrink-0`}
          />
          <input
            value={plan.description}
            onChange={(e) => update(index, { description: e.target.value })}
            placeholder="com ..."
            className={`${fieldClass} min-w-0 flex-1`}
          />
          <button
            type="button"
            onClick={() => onChange(plans.filter((_, i) => i !== index))}
            className="rounded-md p-1.5 text-[#a0a5ac] transition hover:bg-red-50 hover:text-red-600"
            aria-label="Remover plano"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...plans, { name: "", description: "" }])}
        className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-medium text-[#59616d] transition hover:bg-[#f4f5f7]"
      >
        <Plus className="h-3.5 w-3.5" />
        Adicionar plano
      </button>
    </div>
  );
}
