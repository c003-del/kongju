import { handle, readJson } from "@/lib/api/handler";
import { boundedString, uuid } from "@/lib/api/validation";
import { addReaction, removeReaction } from "@/lib/data/mutations";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const id = uuid((await params).id, "invalid_photo_id");
    const sb = await createSupabaseServer();
    const body = await readJson<{ emoji: string }>(request);
    const emoji = boundedString(body.emoji, {
      min: 1,
      max: 32,
      error: "invalid_emoji",
      trim: true,
    });
    return addReaction(sb, id, emoji);
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return handle(async () => {
    const id = uuid((await params).id, "invalid_photo_id");
    const sb = await createSupabaseServer();
    const body = await readJson<{ emoji: string }>(request);
    const emoji = boundedString(body.emoji, {
      min: 1,
      max: 32,
      error: "invalid_emoji",
      trim: true,
    });
    await removeReaction(sb, id, emoji);
    return { ok: true };
  });
}
