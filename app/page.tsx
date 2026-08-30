import { redirect } from "next/navigation";
import FamilyArchive from "@/components/design/family-archive";
import { ApiError } from "@/lib/data/member";
import { buildInitialData } from "@/lib/data/queries";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Page() {
  const sb = await createSupabaseServer();
  try {
    const initial = await buildInitialData(sb);
    return <FamilyArchive initial={initial} />;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirect("/login");
    }
    if (error instanceof ApiError && error.status === 403) {
      redirect("/access-denied");
    }
    throw error;
  }
}
