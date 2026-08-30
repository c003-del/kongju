import { handle } from "@/lib/api/handler";
import { uuid } from "@/lib/api/validation";
import { toggleFavorite } from "@/lib/data/mutations";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const id = uuid((await params).id, "invalid_photo_id");
    const sb = await createSupabaseServer();
    const favorite = await toggleFavorite(sb, id);
    return { favorite };
  });
}
