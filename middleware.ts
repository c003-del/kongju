import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "@/lib/env";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

const PUBLIC_PATHS = [
  "/login",
  "/auth/confirm",
  "/api/auth/login",
  "/api/auth/logout",
];
const AAL1_PATHS = ["/auth/confirm", "/auth/mfa", "/api/auth/logout"];

function matches(pathname: string, paths: string[]): boolean {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function isApi(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function carrySessionCookies(source: NextResponse, target: NextResponse): NextResponse {
  if (source !== target) {
    for (const cookie of source.cookies.getAll()) target.cookies.set(cookie);
  }
  // Auth/session responses must not be shared by a browser or intermediary cache.
  target.headers.set("cache-control", "private, no-store");
  return target;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Training QA is intentionally isolated from Supabase. It is public only
  // under an explicit opt-in flag; disabled environments get a real 404.
  if (pathname === "/training-preview" || pathname.startsWith("/training-preview/")) {
    if (process.env.TRAINING_PREVIEW_ENABLED === "true") {
      const previewResponse = NextResponse.next({ request });
      previewResponse.headers.set("cache-control", "private, no-store");
      return previewResponse;
    }
    return new NextResponse("Not Found", {
      status: 404,
      headers: { "cache-control": "private, no-store" },
    });
  }

  // Vercel Cron is authenticated by a server-held Bearer secret in the route.
  if (pathname === "/api/cron/purge") return NextResponse.next({ request });

  // Never let a corrupt/expired session prevent the idempotent local logout
  // route from clearing its own cookies. Skipping refresh here also avoids a
  // refreshed Set-Cookie racing the route's deletion headers.
  if (pathname === "/api/auth/logout") {
    const logoutResponse = NextResponse.next({ request });
    logoutResponse.headers.set("cache-control", "private, no-store");
    return logoutResponse;
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    if (matches(pathname, PUBLIC_PATHS)) return carrySessionCookies(response, response);
    if (isApi(pathname)) {
      return carrySessionCookies(
        response,
        NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return carrySessionCookies(response, NextResponse.redirect(url));
  }

  const { data: assurance, error: assuranceError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError || !assurance) {
    // Keep recovery endpoints reachable. Redirecting /login to itself creates an
    // infinite loop when an otherwise valid session has an MFA API failure.
    if (matches(pathname, [...PUBLIC_PATHS, "/api/auth/logout"])) {
      return carrySessionCookies(response, response);
    }
    if (isApi(pathname)) {
      return carrySessionCookies(
        response,
        NextResponse.json({ error: "mfa_check_failed" }, { status: 401 }),
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "?error=mfa";
    return carrySessionCookies(response, NextResponse.redirect(url));
  }

  if (assurance.currentLevel !== "aal2") {
    if (matches(pathname, AAL1_PATHS)) return carrySessionCookies(response, response);
    if (isApi(pathname)) {
      return carrySessionCookies(
        response,
        NextResponse.json({ error: "mfa_required" }, { status: 403 }),
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/auth/mfa";
    url.search = "";
    return carrySessionCookies(response, NextResponse.redirect(url));
  }

  if (pathname === "/login" || pathname === "/auth/mfa") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return carrySessionCookies(response, NextResponse.redirect(url));
  }

  return carrySessionCookies(response, response);
}

export const config = {
  matcher: [
    "/training-preview/:path*",
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
