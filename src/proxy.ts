import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  EMPLOYEE_HOME,
  HOME_PAGE,
  canAccessPage,
  hasFullAccess,
} from "@/lib/auth/permissions";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // =====================================================
  // ROTAS PÚBLICAS
  // =====================================================

  if (pathname.startsWith("/api/public/leads")) {
    return NextResponse.next();
  }

  // Formulário dos parceiros (/parceiro/<token>): sem sessão, o token
  // é validado na página e em cada server action.
  if (pathname.startsWith("/parceiro/")) {
    return NextResponse.next();
  }

  // WhatsApp webhook - chamado diretamente pela Meta
if (pathname === "/api/whatsapp/webhook") {
  return NextResponse.next();
}

if (pathname === "/api/zurich/login-code") {
  return NextResponse.next();
}

    // =====================================================
  // CRON
  // =====================================================
  //
  // Qualquer rota debaixo de /api/cron/ é protegida
  // exclusivamente por CRON_SECRET, nunca por sessão.
  //
  // Usada por crons externos (ex: sync de seguradoras).
  // =====================================================

  const isCronRoute =
    pathname.startsWith("/api/cron/");

  if (isCronRoute) {
    const authorization =
      request.headers.get("authorization");

    const cronSecret =
      process.env.CRON_SECRET;

    if (
      cronSecret &&
      authorization === `Bearer ${cronSecret}`
    ) {
      return NextResponse.next();
    }

    return NextResponse.json(
      {
        success: false,
        error: "Unauthorized",
      },
      {
        status: 401,
      },
    );
  }

  // =====================================================
  // SUPABASE AUTH
  // =====================================================

  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(
            ({ name, value, options }) => {
              response.cookies.set(
                name,
                value,
                options,
              );
            },
          );
        },
      },
    },
  );

  // getClaims() valida o JWT localmente (chaves ES256, JWKS em cache)
  // e renova a sessão quando está a expirar — sem ida ao servidor de
  // Auth em cada pedido, como fazia o getUser().
  const { data: claimsData } = await supabase.auth.getClaims();

  const user = claimsData?.claims?.sub ? claimsData.claims : null;

  // =====================================================
  // LOGIN
  // =====================================================

  const isLoginPage =
    pathname === "/login";

  if (!user && !isLoginPage) {
    const url =
      request.nextUrl.clone();

    url.pathname = "/login";

    return NextResponse.redirect(url);
  }

  if (user && isLoginPage) {
    const url =
      request.nextUrl.clone();

    url.pathname = HOME_PAGE;

    return NextResponse.redirect(url);
  }

  // =====================================================
  // PERMISSÕES POR FUNÇÃO
  // =====================================================
  //
  // - Páginas: funcionários só entram em Tarefas, Oportunidades,
  //   Simulador e Conversas (lib/auth/permissions.ts). O resto vai
  //   para /tarefas. OWNER/ADMIN entram em tudo.
  // - /api/dev/*, /api/zurich/*, /api/prevoir/*, /api/generali/*:
  //   só OWNER/ADMIN (chamam as companhias — a Zurich com o token
  //   partilhado — ou correm syncs/escrevem na BD). Nenhuma página
  //   do CRM as chama.
  // - Restantes APIs (Conversas, assistente de IA): qualquer
  //   utilizador ATIVO. Sem isto, uma conta desativada com a sessão
  //   ainda aberta continuava a enviar WhatsApps, por exemplo.
  //
  // As APIs públicas e os crons já saíram mais acima. Só se consulta
  // o perfil nas páginas e nas APIs, não nos ficheiros estáticos.

  const isApi = pathname.startsWith("/api/");
  const isAdminApi =
    pathname.startsWith("/api/dev/") ||
    pathname.startsWith("/api/zurich/") ||
    pathname.startsWith("/api/prevoir/") ||
    pathname.startsWith("/api/generali/");
  const isPage = request.method === "GET" && !isApi;

  if (user && (isApi || isPage)) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, active")
      .eq("id", user.sub)
      .maybeSingle();

    const role = profile?.active === true ? profile.role : null;

    if (isApi && !role) {
      return NextResponse.json(
        { success: false, error: "Conta inativa." },
        { status: 403 },
      );
    }

    if (isAdminApi && !hasFullAccess(role)) {
      return NextResponse.json(
        { success: false, error: "Sem permissões." },
        { status: 403 },
      );
    }

    if (isPage && !canAccessPage(role, pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = EMPLOYEE_HOME;
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};