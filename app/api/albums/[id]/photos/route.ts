import { handle, readJson } from "@/lib/api/handler";
import { uuid, uuidList } from "@/lib/api/validation";
import { addPhotosToAlbum } from "@/lib/data/mutations";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const id = uuid((await params).id, "invalid_album_id");
    const sb = await createSupabaseServer();
    const body = await readJson<{ photoIds: string[] }>(request);
    await addPhotosToAlbum(sb, id, uuidList(body.photoIds));
    return { ok: true };
  });
}
