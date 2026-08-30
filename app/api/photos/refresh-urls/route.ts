import { handle, readJson } from "@/lib/api/handler";
import { uuidList } from "@/lib/api/validation";
import { getPhotosByIds } from "@/lib/data/queries";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handle(async () => {
    const body = await readJson<{ photoIds: string[] }>(request);
    const photoIds = uuidList(body.photoIds);
    const sb = await createSupabaseServer();
    return getPhotosByIds(sb, photoIds);
  });
}
