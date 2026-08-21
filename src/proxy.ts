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

  // =====================================================
  // CRON LIBAX
  // =====================================================

  const isCronRoute =
    pathname.startsWith("/api/cron/");

  const isLibaxImport =
    pathname === "/api/libax/import";

  if (isCronRoute || isLibaxImport) {
    const authorization =
      request.headers.get("authorization");

    const cronSecret =
      process.env.CRON_SECRET;

    // Pedido interno autorizado pelo CRON_SECRET
    if (
      cronSecret &&
      authorization === `Bearer ${cronSecret}`
    ) {
      return NextResponse.next();
    }

    // /api/cron nunca pode ser chamada
    // publicamente sem o secret.
    if (isCronRoute) {
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

    // /api/libax/import sem CRON_SECRET
    // continua para a autenticação Supabase.
    // Assim continua possível importar manualmente
    // estando autenticado no painel.
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};