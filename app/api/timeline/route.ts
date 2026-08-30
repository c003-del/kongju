import type { NextRequest } from "next/server";
import { handle } from "@/lib/api/handler";
import { boundedInteger, optionalUuid } from "@/lib/api/validation";
import type { TimelineFilters } from "@/lib/contracts";
import { getTimeline } from "@/lib/data/queries";
import {
  decodeTimelineCursor,
  MAX_TIMELINE_CURSOR_LENGTH,
} from "@/lib/data/timeline-cursor";
import { ApiError } from "@/lib/data/member";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handle(async () => {
    const params = request.nextUrl.searchParams;
    const year = boundedInteger(params.get("year"), {
      min: 1,
      max: 9999,
      error: "invalid_year",
    });
    const limit = boundedInteger(params.get("limit"), {
      min: 1,
      max: 200,
      error: "invalid_limit",
    });
    const cursor = params.get("cursor");
    if (
      cursor !== null &&
      (cursor.length > MAX_TIMELINE_CURSOR_LENGTH || !decodeTimelineCursor(cursor))
    ) {
      throw new ApiError(400, "invalid_cursor");
    }
    const favorite = params.get("favorite");
    if (favorite !== null && favorite !== "true" && favorite !== "false") {
      throw new ApiError(400, "invalid_favorite");
    }

    const filters: TimelineFilters = {
      year,
      personId: optionalUuid(params.get("personId"), "invalid_person_id"),
      tagId: optionalUuid(params.get("tagId"), "invalid_tag_id"),
      albumId: optionalUuid(params.get("albumId"), "invalid_album_id"),
      favorite: favorite === "true",
    };

    const sb = await createSupabaseServer();
    return getTimeline(sb, cursor, limit ?? undefined, filters);
  });
}
