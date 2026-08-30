import { handle, readJson } from "@/lib/api/handler";
import { boundedString, uuidList } from "@/lib/api/validation";
import { createAlbum } from "@/lib/data/mutations";
import { getAlbums } from "@/lib/data/queries";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const sb = await createSupabaseServer();
    return getAlbums(sb);
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const sb = await createSupabaseServer();
    const body = await readJson<{ title: string; photoIds?: string[] }>(request);
    const title = boundedString(body.title, {
      min: 1,
      max: 200,
      error: "invalid_title",
      trim: true,
    });
    return createAlbum(sb, title, uuidList(body.photoIds ?? []));
  });
}
