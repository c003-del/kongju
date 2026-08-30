import { handle, readJson } from "@/lib/api/handler";
import { uuidList } from "@/lib/api/validation";
import { softDeletePhotos } from "@/lib/data/mutations";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handle(async () => {
    const sb = await createSupabaseServer();
    const body = await readJson<{ photoIds: string[] }>(request);
    const deleted = await softDeletePhotos(sb, uuidList(body.photoIds));
    return { deleted };
  });
}
