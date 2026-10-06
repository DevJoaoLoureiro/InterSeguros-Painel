"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CheckCircle2, Loader2, RefreshCw, Smartphone, XCircle } from "lucide-react";

import {
  completeWhatsappOnboarding,
  getWhatsappStatus,
  type WhatsappNumberStatus,
} from "./action";

/*
 * Botão "Ligar número": abre o assistente oficial da Meta (Embedded
 * Signup) no modo de COEXISTÊNCIA — o número passa a funcionar na API
 * (mensagens no CRM) e continua na aplicação WhatsApp Business do
 * telemóvel. A meio, a Meta mostra um código QR para ler com esse
 * telemóvel.
 *
 * Precisa de HTTPS (não funciona em http://localhost) e do domínio
 * autorizado na app da Meta.
 */

type FbLoginResponse = { authResponse?: { code?: string } | null; status?: string };

declare global {
  interface Window {
    FB?: {
      init: (options: Record<string, unknown>) => void;
      login: (
        callback: (response: FbLoginResponse) => void,
        options: Record<string, unknown>,
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

type SignupEvent = {
  type?: string;
  event?: string;
  data?: {
    phone_number_id?: string;
    waba_id?: string;
    current_step?: string;
    error_message?: string;
  };
};

export function ConnectWhatsapp({
  appId,
  configId,
  initialStatus,
}: {
  appId: string;
  configId: string;
  initialStatus: WhatsappNumberStatus[];
}) {
  const [status, setStatus] = useState(initialStatus);
  // Se o SDK já foi carregado nesta sessão (navegação), está pronto.
  const [sdkReady, setSdkReady] = useState(
    () => typeof window !== "undefined" && Boolean(window.FB),
  );
  const [log, setLog] = useState<string[]>([]);
  const [isBusy, startBusy] = useTransition();

  // O assistente comunica o resultado por postMessage; guardamo-lo
  // aqui até a janela fechar.
  const lastEvent = useRef<SignupEvent | null>(null);

  const configured = Boolean(appId && configId);

  // SDK de JavaScript da Meta.
  useEffect(() => {
    if (!configured) return;

    window.fbAsyncInit = () => {
      window.FB?.init({
        appId,
        autoLogAppEvents: true,
        xfbml: false,
        version: "v23.0",
      });
      setSdkReady(true);
    };

    if (document.getElementById("facebook-jssdk")) return;

    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    document.body.appendChild(script);
  }, [appId, configured]);

  // Eventos do assistente (só de domínios da Meta).
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!/^https:\/\/([a-z0-9-]+\.)*facebook\.com$/.test(event.origin)) return;

      try {
        const data: SignupEvent =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;

        if (data?.type === "WA_EMBEDDED_SIGNUP") lastEvent.current = data;
      } catch {
        // mensagens que não são do assistente
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function refresh() {
    startBusy(async () => {
      try {
        setStatus(await getWhatsappStatus());
      } catch (error) {
        setLog((prev) => [
          ...prev,
          error instanceof Error ? error.message : "Erro ao ler o estado.",
        ]);
      }
    });
  }

  function launch() {
    if (!window.FB) return;

    lastEvent.current = null;
    setLog(["Assistente da Meta aberto…"]);

    window.FB.login(
      () => {
        const result = lastEvent.current;
        const finished =
          result?.event === "FINISH" ||
          result?.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" ||
          result?.event === "FINISH_ONLY_WABA";

        if (!finished || !result?.data?.waba_id || !result.data.phone_number_id) {
          setLog((prev) => [
            ...prev,
            result?.event === "ERROR"
              ? `A Meta devolveu um erro: ${result.data?.error_message ?? "sem detalhe"}`
              : result?.event === "CANCEL"
                ? `Assistente fechado antes do fim${result.data?.current_step ? ` (passo: ${result.data.current_step})` : ""}.`
                : "O assistente fechou sem concluir a ligação.",
          ]);
          return;
        }

        const { waba_id: wabaId, phone_number_id: phoneNumberId } = result.data;

        startBusy(async () => {
          try {
            const done = await completeWhatsappOnboarding({
              wabaId,
              phoneNumberId,
            });

            setLog((prev) => [...prev, "Número ligado pela Meta.", ...done.steps]);
            setStatus(await getWhatsappStatus());
          } catch (error) {
            setLog((prev) => [
              ...prev,
              error instanceof Error ? error.message : "Erro ao concluir.",
            ]);
          }
        });
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          // Manter a aplicação WhatsApp Business no telemóvel.
          featureType: "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
        },
      },
    );
  }

  return (
    <div className="space-y-5">
      {/* ESTADO DOS NÚMEROS */}

      <section className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-[#20242a]">Números do CRM</h2>

          <button
            type="button"
            onClick={refresh}
            disabled={isBusy}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#e4e6e9] px-3 text-sm font-medium text-[#59616d] transition hover:border-[#ffb899] disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isBusy ? "animate-spin" : ""}`} />
            Verificar estado
          </button>
        </div>

        <div className="mt-4 divide-y divide-[#eef0f2]">
          {status.map((number) => (
            <div
              key={number.accountId}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#20242a]">
                  {number.displayName}
                </p>
                <p className="text-xs text-[#8a9099]">
                  {number.phoneNumber ?? "—"}
                  {number.error ? ` · ${number.error}` : ""}
                </p>
              </div>

              {number.ready ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Pronto: as mensagens chegam ao CRM
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                  <XCircle className="h-3.5 w-3.5" />
                  {number.error
                    ? "Sem acesso"
                    : number.platform !== "CLOUD_API"
                      ? "Só no telemóvel — falta ligar à API"
                      : "Conta não subscrita à app"}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* LIGAR */}

      <section className="rounded-2xl border border-[#e5e8ec] bg-white p-5 shadow-[0_2px_10px_rgba(20,25,35,0.04)]">
        <h2 className="font-semibold text-[#20242a]">Ligar um número</h2>

        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-[#59616d]">
          <li>
            Tem o telemóvel da loja à mão, com a aplicação WhatsApp Business
            aberta e com internet.
          </li>
          <li>Carrega no botão e segue o assistente da Meta.</li>
          <li>
            Quando aparecer o código QR, lê-o com esse telemóvel (na
            aplicação: Definições → Dispositivos associados).
          </li>
        </ol>

        {!configured ? (
          <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Falta configurar NEXT_PUBLIC_META_APP_ID e
            NEXT_PUBLIC_META_ES_CONFIG_ID nas variáveis de ambiente.
          </p>
        ) : (
          <button
            type="button"
            onClick={launch}
            disabled={!sdkReady || isBusy}
            className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-[#ff6a2b] to-[#ea5b0c] px-5 text-sm font-semibold text-white shadow-[0_2px_10px_rgba(234,91,12,0.28)] transition hover:shadow-[0_6px_18px_rgba(234,91,12,0.36)] disabled:opacity-50"
          >
            {isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Smartphone className="h-4 w-4" />
            )}
            {sdkReady ? "Ligar número WhatsApp" : "A carregar a Meta…"}
          </button>
        )}

        {log.length > 0 && (
          <ul className="mt-4 space-y-1 rounded-xl bg-[#fafbfc] px-4 py-3 text-xs text-[#40464f]">
            {log.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
