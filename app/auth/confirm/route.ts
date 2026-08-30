import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// 매직 링크 랜딩 — token_hash(권장 템플릿) 또는 code(PKCE) 둘 다 처리한다.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const code = params.get("code");

  const redirect = (path: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    return NextResponse.redirect(url);
  };

  const sb = await createSupabaseServer();

  if (tokenHash && type) {
    const { error } = await sb.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return redirect("/auth/mfa");
  } else if (code) {
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return redirect("/auth/mfa");
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "?error=auth";
  return NextResponse.redirect(url);
}
