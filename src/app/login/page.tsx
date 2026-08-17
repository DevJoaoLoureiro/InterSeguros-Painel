import { LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <main className="min-h-dvh bg-[#f7f8fc] p-4 sm:p-6">
      <div className="mx-auto grid min-h-[calc(100dvh-2rem)] max-w-6xl overflow-hidden rounded-[28px] border border-[#e7e9ec] bg-white shadow-[0_20px_70px_rgba(20,25,35,0.08)] lg:grid-cols-[1.05fr_0.95fr]">
        {/* Lado da marca */}
        <section className="relative hidden overflow-hidden bg-[#17191d] p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="absolute -right-32 -top-32 h-80 w-80 rounded-full bg-[#ff4b0a]/20 blur-3xl" />
          <div className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-[#ff4b0a]/10 blur-3xl" />

          <div className="relative z-10">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#ff4b0a] text-lg font-bold">
                IS
              </div>

              <div className="leading-tight">
                <p className="text-xl font-semibold tracking-wide text-[#ff6a2b]">
                  INTER
                </p>
                <p className="text-base font-medium text-white">
                  SEGUROS
                </p>
              </div>
            </div>
          </div>

          <div className="relative z-10 max-w-md">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/80">
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
          </div>

          <p className="relative z-10 text-xs text-white/40">
            Inter Seguros · Painel Administrativo
          </p>
        </section>

        {/* Formulário */}
        <section className="flex items-center justify-center p-6 sm:p-10 lg:p-14">
          <div className="w-full max-w-md">
            <div className="mb-8 lg:hidden">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#ff4b0a] font-bold text-white">
                  IS
                </div>

                <div className="leading-tight">
                  <p className="text-lg font-semibold text-[#e7430a]">
                    INTER
                  </p>
                  <p className="text-sm font-medium text-[#292929]">
                    SEGUROS
                  </p>
                </div>
              </div>
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