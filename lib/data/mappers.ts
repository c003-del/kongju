import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Comment,
  Member,
  Person,
  Photo,
  Reaction,
  Tag,
  TimelineMonth,
} from "@/lib/contracts";
import type {
  CommentRow,
  MemberRow,
  PhotoRow,
  ReactionRow,
} from "@/lib/data/types";
import { signPaths, type SignedUrlMap } from "@/lib/data/signing";
import { seoulDateParts } from "@/lib/date-time";

const FALLBACK_MEMBER: Member = { id: "", displayName: "—", avatarUrl: null };

export function mapMember(row: MemberRow | null): Member {
  if (!row) return FALLBACK_MEMBER;
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
  };
}

function mapPerson(
  row: { id: string; name: string; cover: { thumb_path: string } | null },
  thumbUrls: SignedUrlMap,
): Person {
  return {
    id: row.id,
    name: row.name,
    coverUrl: row.cover ? (thumbUrls.get(row.cover.thumb_path) ?? null) : null,
  };
}

export function mapPhoto(
  row: PhotoRow,
  originalUrls: SignedUrlMap,
  thumbUrls: SignedUrlMap,
): Photo {
  const people: Person[] = (row.photo_people ?? [])
    .map((pp) => pp.person)
    .filter((p): p is NonNullable<typeof p> => p != null)
    .map((p) => mapPerson(p, thumbUrls));

  const tags: Tag[] = (row.photo_tags ?? [])
    .map((pt) => pt.tag)
    .filter((t): t is NonNullable<typeof t> => t != null)
    .map((t) => ({ id: t.id, label: t.label }));

  return {
    id: row.id,
    url: originalUrls.get(row.storage_path) ?? "",
    thumbUrl: thumbUrls.get(row.thumb_path) ?? "",
    blurhash: row.blurhash,
    width: row.width,
    height: row.height,
    takenAt: row.taken_at,
    caption: row.caption,
    favorite: row.favorite,
    people,
    tags,
    uploadedBy: mapMember(row.uploader),
  };
}

// 사진 행 목록 전체의 서명 URL을 버킷별로 한 번에 발급한 뒤 매핑한다.
export async function mapPhotos(
  sb: SupabaseClient,
  rows: PhotoRow[],
): Promise<Photo[]> {
  const originalPaths = rows.map((r) => r.storage_path);
  const thumbPaths: string[] = [];
  for (const r of rows) {
    thumbPaths.push(r.thumb_path);
    for (const pp of r.photo_people ?? []) {
      if (pp.person?.cover) thumbPaths.push(pp.person.cover.thumb_path);
    }
  }

  const [originalUrls, thumbUrls] = await Promise.all([
    signPaths(sb, "photos", originalPaths),
    signPaths(sb, "thumbs", thumbPaths),
  ]);

  return rows.map((r) => mapPhoto(r, originalUrls, thumbUrls));
}

export function mapReaction(row: ReactionRow): Reaction {
  return {
    id: row.id,
    emoji: row.emoji,
    member: mapMember(row.member),
    createdAt: row.created_at,
  };
}

export function mapComment(row: CommentRow): Comment {
  return {
    id: row.id,
    body: row.body,
    member: mapMember(row.member),
    createdAt: row.created_at,
  };
}

// 월 단위(YYYY-MM) 그룹화 — taken_at 내림차순 입력을 그대로 유지한다.
export function groupByMonth(photos: Photo[]): TimelineMonth[] {
  const months: TimelineMonth[] = [];
  const index = new Map<string, TimelineMonth>();
  for (const photo of photos) {
    const taken = seoulDateParts(photo.takenAt);
    const key = `${taken.year}-${String(taken.month).padStart(2, "0")}`;
    let month = index.get(key);
    if (!month) {
      month = { key, photos: [] };
      index.set(key, month);
      months.push(month);
    }
    month.photos.push(photo);
  }
  return months;
}
