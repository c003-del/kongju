import { handle, readJson } from "@/lib/api/handler";
import { insertPhotoRecord, type PhotoRecordRequest } from "@/lib/data/upload";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handle(async () => {
    const sb = await createSupabaseServer();
    const body = await readJson<PhotoRecordRequest>(request);
    return insertPhotoRecord(sb, body);
  });
}
