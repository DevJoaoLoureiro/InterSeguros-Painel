import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { hasFullAccess } from "@/lib/auth/permissions";

import { getWhatsappStatus } from "./action";
import { ConnectWhatsapp } from "./connect-whatsapp";

export default async function WhatsappSettingsPage() {
  const profile = await getCurrentProfile();

  if (!profile) redirect("/login");
  if (!hasFullAccess(profile.role)) redirect("/dashboard");

  const status = await getWhatsappStatus();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-[#ff4b0a]">Configurações</p>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17191d]">
          WhatsApp
        </h1>

        <p className="mt-1 max-w-2xl text-sm text-[#737a84]">
          Liga os números das lojas à API da Meta para as mensagens
          aparecerem em Conversas. O número continua a funcionar na
          aplicação WhatsApp Business do telemóvel.
        </p>
      </div>

      <ConnectWhatsapp
        appId={process.env.NEXT_PUBLIC_META_APP_ID ?? ""}
        configId={process.env.NEXT_PUBLIC_META_ES_CONFIG_ID ?? ""}
        initialStatus={status}
      />
    </div>
  );
}
