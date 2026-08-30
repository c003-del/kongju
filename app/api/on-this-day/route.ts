import { handle } from "@/lib/api/handler";
import { getOnThisDay } from "@/lib/data/queries";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const sb = await createSupabaseServer();
    return getOnThisDay(sb);
  });
}
