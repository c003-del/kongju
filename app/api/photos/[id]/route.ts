import { handle, readJson } from "@/lib/api/handler";
import { nullableBoundedString, uuid } from "@/lib/api/validation";
import { updateCaption } from "@/lib/data/mutations";
import { getPhoto } from "@/lib/data/queries";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const id = uuid((await params).id, "invalid_photo_id");
    const sb = await createSupabaseServer();
    return getPhoto(sb, id);
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const id = uuid((await params).id, "invalid_photo_id");
    const sb = await createSupabaseServer();
    const body = await readJson<{ caption: string | null }>(request);
    const caption = nullableBoundedString(body.caption, {
      max: 5000,
      error: "invalid_caption",
    });
    await updateCaption(sb, id, caption);
    return { ok: true };
  });
}
