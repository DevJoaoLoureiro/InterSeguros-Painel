import { ShieldCheck } from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <main className="app-canvas min-h-dvh p-4 sm:p-6">
      <div className="mx-auto grid min-h-[calc(100dvh-2rem)] max-w-6xl animate-pop-in overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-[0_30px_90px_rgba(20,22,27,0.14)] lg:grid-cols-[1.05fr_0.95fr]">
        {/* Lado da marca */}
        <section className="relative hidden overflow-hidden bg-[#14161b] p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="float-slow absolute -right-32 -top-32 h-96 w-96 rounded-full bg-[#ff4b0a]/30 blur-3xl" />
          <div
            className="float-slow absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-[#ff4b0a]/15 blur-3xl"
            style={{ animationDelay: "-7s" }}
          />

          {/* Logótipo em cartão branco: tem partes escuras. */}
          <div className="relative z-10">
            <div className="inline-flex h-[68px] items-center overflow-hidden rounded-2xl bg-white px-6 shadow-[0_12px_30px_rgba(0,0,0,0.3)]">
              <img
                src="/interseguroslogo.png"
                alt="Inter Seguros"
                className="h-[64px] w-auto scale-[1.5] object-contain"
              />
            </div>
          </div>

          <div className="relative z-10 max-w-md">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/80 backdrop-blur">
              <ShieldCheck className="h-4 w-4 text-[#ff6a2b]" />
              Plataforma comercial
            </div>

            <h1 className="text-4xl font-semibold leading-tight tracking-tight">
              Toda a atividade comercial num só lugar.
            </h1>

            <p className="mt-5 max-w-sm text-base leading-7 text-white/65">
              Gere leads, clientes, vencimentos, oportunidades e desempenho
              da tua loja.
            </p>

            <ul className="mt-7 space-y-2.5 text-sm text-white/75">
              {[
                "Carteira sincronizada com as companhias",
                "Renovações e recibos sem surpresas",
                "Tarefas e processos da equipa num só sítio",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#ff4b0a]/20 text-[#ff8a5c]">
                    <ShieldCheck className="h-3 w-3" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <p className="relative z-10 text-xs text-white/40">
            Inter Seguros · Painel Administrativo
          </p>
        </section>

        {/* Formulário */}
        <section className="flex items-center justify-center p-6 sm:p-10 lg:p-14">
          <div className="w-full max-w-md">
            <div className="mb-8 lg:hidden">
              <img
                src="/interseguroslogo.png"
                alt="Inter Seguros"
                className="h-14 w-auto object-contain"
              />
            </div>

            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-[#17191d]">
                Bem-vindo
              </h2>

              <p className="mt-2 text-sm leading-6 text-[#717985]">
                Introduz os teus dados para entrar no painel.
              </p>
            </div>

            <LoginForm />

            <div className="mt-8 border-t border-[#edf0f2] pt-6 text-center">
              <p className="text-xs text-[#9298a1]">
                Acesso reservado a colaboradores autorizados.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
