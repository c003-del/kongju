import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Album, Comment, Person, Reaction } from "@/lib/contracts";
import { ApiError, requireMember } from "@/lib/data/member";
import { mapComment, mapReaction } from "@/lib/data/mappers";
import type { CommentRow, ReactionRow } from "@/lib/data/types";
import { signPaths } from "@/lib/data/signing";

const MEMBER_EMBED = "member:family_members!%FK% ( id, display_name, avatar_url )";

// 즐겨찾기 토글 — 새 값을 반환
export async function toggleFavorite(
  sb: SupabaseClient,
  photoId: string,
): Promise<boolean> {
  const { data, error } = await sb
    .from("photos")
    .select("favorite")
    .eq("id", photoId)
    .maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, "photo_not_found");

  const next = !data.favorite;
  const { error: updateError } = await sb
    .from("photos")
    .update({ favorite: next })
    .eq("id", photoId);
  if (updateError) throw new ApiError(500, updateError.message);
  return next;
}

export async function updateCaption(
  sb: SupabaseClient,
  photoId: string,
  caption: string | null,
): Promise<void> {
  const { error } = await sb
    .from("photos")
    .update({ caption })
    .eq("id", photoId);
  if (error) throw new ApiError(500, error.message);
}

// soft delete — 업로더 본인이거나 owner인 사진만 처리하고, 처리한 id를 반환
export async function softDeletePhotos(
  sb: SupabaseClient,
  photoIds: string[],
): Promise<string[]> {
  if (photoIds.length === 0) return [];
  const member = await requireMember(sb);

  let query = sb
    .from("photos")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", photoIds)
    .is("deleted_at", null);
  if (member.role !== "owner") {
    query = query.eq("uploaded_by", member.memberId);
  }
  const { data, error } = await query.select("id");
  if (error) throw new ApiError(500, error.message);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

export async function addComment(
  sb: SupabaseClient,
  photoId: string,
  body: string,
): Promise<Comment> {
  const member = await requireMember(sb);
  const trimmed = body.trim();
  if (!trimmed) throw new ApiError(400, "empty_comment");

  const { data, error } = await sb
    .from("comments")
    .insert({ photo_id: photoId, member_id: member.memberId, body: trimmed })
    .select(
      `id, body, created_at, ${MEMBER_EMBED.replace("%FK%", "comments_member_id_fkey")}`,
    )
    .single();
  if (error) throw new ApiError(500, error.message);
  return mapComment(data as unknown as CommentRow);
}

export async function addReaction(
  sb: SupabaseClient,
  photoId: string,
  emoji: string,
): Promise<Reaction> {
  const member = await requireMember(sb);
  const select = `id, emoji, created_at, ${MEMBER_EMBED.replace("%FK%", "reactions_member_id_fkey")}`;

  const { data, error } = await sb
    .from("reactions")
    .insert({ photo_id: photoId, member_id: member.memberId, emoji })
    .select(select)
    .single();
  if (!error) return mapReaction(data as unknown as ReactionRow);

  // 23505: 동일 (photo, member, emoji) 반응이 이미 존재 — 기존 행을 반환
  if (error.code === "23505") {
    const { data: existing, error: findError } = await sb
      .from("reactions")
      .select(select)
      .eq("photo_id", photoId)
      .eq("member_id", member.memberId)
      .eq("emoji", emoji)
      .single();
    if (findError) throw new ApiError(500, findError.message);
    return mapReaction(existing as unknown as ReactionRow);
  }
  throw new ApiError(500, error.message);
}

export async function removeReaction(
  sb: SupabaseClient,
  photoId: string,
  emoji: string,
): Promise<void> {
  const member = await requireMember(sb);
  const { error } = await sb
    .from("reactions")
    .delete()
    .eq("photo_id", photoId)
    .eq("member_id", member.memberId)
    .eq("emoji", emoji);
  if (error) throw new ApiError(500, error.message);
}

// Automatic albums are maintained by the database trigger.
export async function createAlbum(
  sb: SupabaseClient,
  title: string,
  photoIds: string[] = [],
): Promise<Album> {
  const member = await requireMember(sb);
  const trimmed = title.trim();
  if (!trimmed) throw new ApiError(400, "empty_title");

  const { data, error } = await sb
    .from("albums")
    .insert({
      family_id: member.familyId,
      title: trimmed,
      kind: "manual",
    })
    .select("id, title, kind, start_date, end_date")
    .single();
  if (error) throw new ApiError(500, error.message);

  let result: AddPhotosResult | null = null;
  try {
    result =
      photoIds.length > 0 ? await addPhotosToAlbum(sb, data.id, photoIds) : null;
  } catch (addError) {
    // Album creation and the append RPC are separate PostgREST transactions.
    // Avoid leaving a newly-created empty shell when validation/append fails.
    await sb.from("albums").delete().eq("id", data.id);
    throw addError;
  }

  return {
    id: data.id,
    title: data.title,
    kind: data.kind,
    coverUrl: null,
    photoCount: result?.photoCount ?? 0,
    startDate: result?.startDate ?? null,
    endDate: result?.endDate ?? null,
  };
}

type AddPhotosResult = {
  addedCount: number;
  photoCount: number;
  startDate: string | null;
  endDate: string | null;
  coverPhotoId: string | null;
};

export async function addPhotosToAlbum(
  sb: SupabaseClient,
  albumId: string,
  photoIds: string[],
): Promise<AddPhotosResult | null> {
  if (photoIds.length === 0) return null;

  const { data, error } = await sb.rpc("add_photos_to_album", {
    p_album_id: albumId,
    p_photo_ids: photoIds,
  });
  if (error) {
    if (error.message.includes("album_not_found")) {
      throw new ApiError(404, "album_not_found");
    }
    if (error.message.includes("auto_album_readonly")) {
      throw new ApiError(400, "auto_album_readonly");
    }
    if (error.message.includes("invalid_photo_ids")) {
      throw new ApiError(400, "invalid_photo_ids");
    }
    throw new ApiError(500, "album_photo_update_failed");
  }

  const row = (data as Array<{
    added_count: number;
    photo_count: number | string;
    start_date: string | null;
    end_date: string | null;
    cover_photo_id: string | null;
  }> | null)?.[0];
  if (!row) throw new ApiError(500, "album_photo_update_failed");

  return {
    addedCount: row.added_count,
    photoCount: Number(row.photo_count),
    startDate: row.start_date,
    endDate: row.end_date,
    coverPhotoId: row.cover_photo_id,
  };
}

// 인물 태깅 — personId 또는 name(찾거나 생성) 중 하나로 지정
export async function tagPerson(
  sb: SupabaseClient,
  photoId: string,
  input: { personId?: string; name?: string },
): Promise<Person> {
  const member = await requireMember(sb);

  let personId: string;
  let personName: string;

  if (!input.personId) {
    const name = (input.name ?? "").trim();
    if (!name) throw new ApiError(400, "person_required");
    const { data: existing, error: findError } = await sb
      .from("people")
      .select("id, name")
      .eq("name", name)
      .maybeSingle();
    if (findError) throw new ApiError(500, findError.message);
    if (existing) {
      personId = existing.id;
      personName = existing.name;
    } else {
      const { data: created, error: createError } = await sb
        .from("people")
        .insert({ family_id: member.familyId, name })
        .select("id, name")
        .single();
      if (createError) throw new ApiError(500, createError.message);
      personId = created.id;
      personName = created.name;
    }
  } else {
    const { data: person, error: personError } = await sb
      .from("people")
      .select("id, name")
      .eq("id", input.personId)
      .maybeSingle();
    if (personError) throw new ApiError(500, personError.message);
    if (!person) throw new ApiError(404, "person_not_found");
    personId = person.id;
    personName = person.name;
  }

  const { error } = await sb
    .from("photo_people")
    .upsert(
      { photo_id: photoId, person_id: personId },
      { onConflict: "photo_id,person_id", ignoreDuplicates: true },
    );
  if (error) throw new ApiError(500, error.message);

  // 커버가 없으면 이 사진을 커버로
  await sb
    .from("people")
    .update({ cover_photo_id: photoId })
    .eq("id", personId)
    .is("cover_photo_id", null);

  const { data: coverRow } = await sb
    .from("people")
    .select("cover:photos!people_cover_photo_id_fkey ( thumb_path )")
    .eq("id", personId)
    .maybeSingle();
  const coverPath = (
    coverRow as unknown as { cover: { thumb_path: string } | null } | null
  )?.cover?.thumb_path;
  const thumbUrls = coverPath
    ? await signPaths(sb, "thumbs", [coverPath])
    : new Map<string, string>();

  return {
    id: personId,
    name: personName,
    coverUrl: coverPath ? (thumbUrls.get(coverPath) ?? null) : null,
  };
}
