import "server-only";

// Supabase 조회 결과 내부 행 타입 (조인 포함). 계약 타입과 분리한다.
export type MemberRow = {
  id: string;
  display_name: string;
  avatar_url: string | null;
};

export type PersonRow = {
  id: string;
  name: string;
  cover: { thumb_path: string } | null;
};

export type TagRow = { id: string; label: string };

export type PhotoRow = {
  id: string;
  storage_path: string;
  thumb_path: string;
  blurhash: string | null;
  width: number;
  height: number;
  taken_at: string;
  caption: string | null;
  favorite: boolean;
  photo_people: { person: PersonRow | null }[] | null;
  photo_tags: { tag: TagRow | null }[] | null;
  uploader: MemberRow | null;
};

export type ReactionRow = {
  id: string;
  emoji: string;
  created_at: string;
  member: MemberRow | null;
};

export type CommentRow = {
  id: string;
  body: string;
  created_at: string;
  member: MemberRow | null;
};

// 사진 1장을 계약 shape으로 매핑하는 데 필요한 select 절.
// FK 이름을 명시해 PostgREST 임베딩 모호성을 제거한다.
export const PHOTO_SELECT = `
  id, storage_path, thumb_path, blurhash, width, height, taken_at, caption, favorite,
  photo_people ( person:people!photo_people_person_id_fkey ( id, name, cover:photos!people_cover_photo_id_fkey ( thumb_path ) ) ),
  photo_tags ( tag:tags!photo_tags_tag_id_fkey ( id, label ) ),
  uploader:family_members!photos_uploaded_by_fkey ( id, display_name, avatar_url )
`.trim();

export type CurrentMember = {
  userId: string;
  memberId: string;
  familyId: string;
  displayName: string;
  avatarUrl: string | null;
  role: "owner" | "member";
};
