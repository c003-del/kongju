import { handle, readJson } from "@/lib/api/handler";
import { ApiError, requireMember } from "@/lib/data/member";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function POST(request: Request) {
  return handle(async () => {
    const sb = await createSupabaseServer();
    const member = await requireMember(sb);
    if (member.role !== "owner") throw new ApiError(403, "owner_only");

    const body = await readJson<{
      email: string;
      displayName: string;
      birthDate?: string | null;
    }>(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw new ApiError(400, "invalid_email");
    }
    if (!displayName || displayName.length > 120) {
      throw new ApiError(400, "invalid_display_name");
    }
    if (
      body.birthDate != null &&
      !isDateOnly(body.birthDate)
    ) {
      throw new ApiError(400, "invalid_birth_date");
    }

    const { data, error } = await sb
      .from("family_members")
      .insert({
        family_id: member.familyId,
        invited_email: email,
        display_name: displayName,
        birth_date: body.birthDate ?? null,
        role: "member",
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") throw new ApiError(409, "already_invited");
      throw new ApiError(500, error.message);
    }
    return { id: data.id };
  });
}

// Access is revoked instead of deleting the attribution row. All membership
// helpers check is_active, so existing access tokens lose data access at once.
export async function DELETE(request: Request) {
  return handle(async () => {
    const sb = await createSupabaseServer();
    const member = await requireMember(sb);
    if (member.role !== "owner") throw new ApiError(403, "owner_only");

    const body = await readJson<{ memberId: string }>(request);
    if (
      typeof body.memberId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        body.memberId,
      )
    ) {
      throw new ApiError(400, "invalid_member_id");
    }
    if (body.memberId === member.memberId) {
      throw new ApiError(400, "owner_cannot_revoke_self");
    }

    const { data, error } = await sb
      .from("family_members")
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq("id", body.memberId)
      .eq("family_id", member.familyId)
      .select("id")
      .maybeSingle();
    if (error) throw new ApiError(500, "membership_revoke_failed");
    if (!data) throw new ApiError(404, "member_not_found");
    return { id: data.id, revoked: true };
  });
}
