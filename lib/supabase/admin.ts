import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseServiceRoleKey, supabaseUrl } from "@/lib/env";

// service role 클라이언트 — 서버 전용. 클라이언트 번들에 절대 포함되지 않는다.
// RLS를 우회하므로 초대 검사, cron 정리 등 명시적으로 필요한 곳에서만 사용한다.
export function createSupabaseAdmin() {
  return createClient(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
