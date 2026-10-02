import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  EMPLOYEE_HOME,
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

    url.pathname = "/dashboard";

    return NextResponse.redirect(url);
  }

  // =====================================================
  // PERMISSÕES POR FUNÇÃO
  // =====================================================
  //
  // - Páginas: funcionários só entram em Tarefas, Oportunidades,
  //   Simulador e Conversas (lib/auth/permissions.ts). O resto vai
  //   para /tarefas. OWNER/ADMIN entram em tudo.
  // - /api/dev/*: só OWNER/ADMIN (chamam a Zurich com o token
  //   partilhado ou escrevem na BD).
  //
  // Só se consulta o perfil nestes casos (páginas e /api/dev), não
  // nas restantes APIs nem nos ficheiros estáticos.

  const isDevApi = pathname.startsWith("/api/dev/");
  const isPage =
    request.method === "GET" && !pathname.startsWith("/api/");

  if (user && (isDevApi || isPage)) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, active")
      .eq("id", user.sub)
      .maybeSingle();

    const role = profile?.active === true ? profile.role : null;

    if (isDevApi && !hasFullAccess(role)) {
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