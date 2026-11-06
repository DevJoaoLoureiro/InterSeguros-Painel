import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { requireAdmin } from "@/lib/auth/access";
import { loadMessageTemplates } from "@/lib/tasks/message-templates";

import { TemplatesEditor } from "./templates-editor";

export default async function MensagensPage() {
  await requireAdmin();

  const templates = await loadMessageTemplates();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/configuracoes"
          className="inline-flex items-center gap-1 text-sm font-medium text-[#ff4b0a]"
        >
          <ChevronLeft className="h-4 w-4" />
          Configurações
        </Link>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
          Mensagens ao cliente
        </h1>

        <p className="mt-1 text-sm text-[#737a84]">
          Modelos da mensagem que os colaboradores enviam no início de um
          processo, por ramo, e os planos que aparecem pré-preenchidos.
        </p>
      </div>

      <TemplatesEditor templates={templates} />
    </div>
  );
}
