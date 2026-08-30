import "server-only";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "@/lib/env";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

// 서버 컴포넌트 / Route Handler에서 사용하는 사용자 세션 컨텍스트 클라이언트.
// RLS가 그대로 적용된다.
export async function createSupabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // 서버 컴포넌트에서 호출되면 쿠키를 쓸 수 없다. 미들웨어가 세션을 갱신한다.
        }
      },
    },
  });
}

// Clear every chunk belonging to this project's SSR auth storage. This is a
// recovery fallback for malformed cookies where auth.signOut() cannot decode a
// session well enough to emit its normal SIGNED_OUT cookie changes.
export async function clearSupabaseAuthCookies(): Promise<void> {
  const cookieStore = await cookies();
  const hostname = new URL(supabaseUrl()).hostname;
  const storageKey = `sb-${hostname.split(".")[0]}-auth-token`;
  for (const cookie of cookieStore.getAll()) {
    if (cookie.name === storageKey || cookie.name.startsWith(`${storageKey}.`) ||
        cookie.name.startsWith(`${storageKey}-`)) {
      cookieStore.delete(cookie.name);
    }
  }
}
