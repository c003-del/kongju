import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrentMember } from "@/lib/data/types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type MemberQueryRow = {
  id: string;
  family_id: string;
  display_name: string;
  avatar_url: string | null;
  role: "owner" | "member";
};

async function fetchMemberRow(
  sb: SupabaseClient,
  userId: string,
): Promise<MemberQueryRow | null> {
  const { data, error } = await sb
    .from("family_members")
    .select("id, family_id, display_name, avatar_url, role")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new ApiError(500, error.message);
  return data as MemberQueryRow | null;
}

// 현재 로그인 사용자의 구성원 정보. 초대 선삽입 행이 아직 연결되지 않았다면
// claim_membership() RPC로 연결을 시도한다(기존 auth 사용자를 초대한 경우 대비).
export async function requireMember(sb: SupabaseClient): Promise<CurrentMember> {
  const {
    data: { user },
    error: userError,
  } = await sb.auth.getUser();
  if (userError || !user) throw new ApiError(401, "unauthenticated");

  let row = await fetchMemberRow(sb, user.id);
  if (!row) {
    await sb.rpc("claim_membership");
    row = await fetchMemberRow(sb, user.id);
  }
  if (!row) throw new ApiError(403, "not_a_family_member");

  return {
    userId: user.id,
    memberId: row.id,
    familyId: row.family_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role,
  };
}
