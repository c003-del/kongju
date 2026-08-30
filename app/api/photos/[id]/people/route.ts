import { handle, readJson } from "@/lib/api/handler";
import { boundedString, uuid } from "@/lib/api/validation";
import { tagPerson } from "@/lib/data/mutations";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const id = uuid((await params).id, "invalid_photo_id");
    const sb = await createSupabaseServer();
    const body = await readJson<{ personId?: string; name?: string }>(request);
    const name =
      body.name === undefined
        ? undefined
        : boundedString(body.name, {
            min: 1,
            max: 120,
            error: "invalid_person_name",
            trim: true,
          });
    return tagPerson(sb, id, {
      name,
      personId:
        body.personId === undefined
          ? undefined
          : uuid(body.personId, "invalid_person_id"),
    });
  });
}
