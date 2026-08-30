import type { NextRequest } from "next/server";
import { handle } from "@/lib/api/handler";
import { boundedInteger } from "@/lib/api/validation";
import { getHighlights } from "@/lib/data/queries";
import { createSupabaseServer } from "@/lib/supabase/server";
import { currentSeoulDateParts } from "@/lib/date-time";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handle(async () => {
    const raw = request.nextUrl.searchParams.get("year");
    const year =
      boundedInteger(raw, { min: 1, max: 9999, error: "invalid_year" }) ??
      currentSeoulDateParts().year;
    const sb = await createSupabaseServer();
    return getHighlights(sb, year);
  });
}
