import { handle, readJson } from "@/lib/api/handler";
import { boundedString, uuid } from "@/lib/api/validation";
import { addComment } from "@/lib/data/mutations";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const id = uuid((await params).id, "invalid_photo_id");
    const sb = await createSupabaseServer();
    const body = await readJson<{ body: string }>(request);
    const comment = boundedString(body.body, {
      min: 1,
      max: 5000,
      error: "invalid_comment",
      trim: true,
    });
    return addComment(sb, id, comment);
  });
}
