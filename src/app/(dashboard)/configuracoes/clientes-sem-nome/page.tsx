import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { requireAdmin } from "@/lib/auth/access";

import { RecoverNames } from "./recover-names";

/*
 * Recuperar os nomes dos clientes Zurich com nome provisório
 * ("Cliente NIF …"). Ver lib/insurance/providers/zurich/recover-client-names.ts.
 */
export default async function ClientesSemNomePage() {
  await requireAdmin();

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          href="/configuracoes"
          className="inline-flex items-center gap-1 text-sm font-medium text-[#ff4b0a]"
        >
          <ChevronLeft className="h-4 w-4" />
          Configurações
        </Link>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
          Clientes sem nome
        </h1>

        <p className="mt-1 text-sm text-[#737a84]">
          Clientes Zurich que ficaram como &quot;Cliente NIF …&quot; porque a
          Zurich não devolveu a ficha quando a apólice entrou no CRM. Só se
          substitui o nome provisório — nomes verdadeiros nunca são tocados.
        </p>
      </div>

      <RecoverNames />
    </div>
  );
}
