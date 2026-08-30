import { handle } from "@/lib/api/handler";
import {
  clearSupabaseAuthCookies,
  createSupabaseServer,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return handle(async () => {
    const sb = await createSupabaseServer();
    try {
      const { error } = await sb.auth.signOut({ scope: "local" });
      // auth-js clears local state on most remote sign-out failures. Log the
      // server-side failure, then guarantee cookie removal below.
      if (error) console.error("[auth/logout] remote sign-out failed");
    } catch {
      console.error("[auth/logout] session decode/sign-out failed");
    }
    await clearSupabaseAuthCookies();
    return { ok: true };
  });
}
