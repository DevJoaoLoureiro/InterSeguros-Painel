import Link from "next/link";
import { Cable, ChevronRight } from "lucide-react";

export default function ConfiguracoesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Configurações
        </h1>

        <p className="mt-1 text-sm text-gray-500">
          Gere as configurações e integrações do painel.
        </p>
      </div>

      <div className="max-w-2xl">
        <Link
          href="/configuracoes/libax"
          className="flex items-center justify-between rounded-xl border bg-white p-5 transition hover:bg-gray-50"
        >
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50">
              <Cable className="h-5 w-5 text-orange-600" />
            </div>

            <div>
              <p className="font-medium">
                Integração Libax
              </p>

              <p className="text-sm text-gray-500">
                Gere a associação entre responsáveis Libax e utilizadores do painel.
              </p>
            </div>
          </div>

          <ChevronRight className="h-5 w-5 text-gray-400" />
        </Link>
      </div>
    </div>
  );
}