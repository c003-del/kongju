"use client";
import { createBrowserClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "@/lib/env";

// 브라우저에서는 Auth MFA와 signed upload만 사용한다. 데이터 조회·변경은
// Route Handler 또는 서버 컴포넌트를 거쳐 RLS와 서버 검증을 함께 적용한다.
export function createSupabaseBrowser() {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey());
}
