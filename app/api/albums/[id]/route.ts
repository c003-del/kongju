import { handle } from "@/lib/api/handler";
import { uuid } from "@/lib/api/validation";
import { getAlbum } from "@/lib/data/queries";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const id = uuid((await params).id, "invalid_album_id");
    const sb = await createSupabaseServer();
    return getAlbum(sb, id);
  });
}
