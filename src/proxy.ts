import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
  // ROTAS DE DEV — SÓ OWNER/ADMIN
  // =====================================================
  //
  // Vários endpoints /api/dev/* chamam a Zurich (token
  // partilhado) ou escrevem na BD, e nem todos verificam a
  // função do utilizador. Bloqueamos aqui, num só sítio, para
  // cobrir também os que forem criados no futuro.

  // Páginas da secção GESTÃO (a sidebar já as esconde a não-admins;
  // aqui impede-se o acesso direto pelo URL).
  const adminOnlyPage =
    pathname.startsWith("/lojas") ||
    pathname.startsWith("/utilizadores") ||
    pathname.startsWith("/configuracoes");

  if (user && adminOnlyPage && request.method === "GET") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, active")
      .eq("id", user.sub)
      .maybeSingle();

    const allowed =
      profile?.active === true &&
      (profile.role === "OWNER" || profile.role === "ADMIN");

    if (!allowed) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  if (user && pathname.startsWith("/api/dev/")) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, active")
      .eq("id", user.sub)
      .maybeSingle();

    const allowed =
      profile?.active === true &&
      (profile.role === "OWNER" || profile.role === "ADMIN");

    if (!allowed) {
      return NextResponse.json(
        { success: false, error: "Sem permissões." },
        { status: 403 },
      );
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};