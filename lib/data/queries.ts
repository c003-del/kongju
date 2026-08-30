import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Album,
  AlbumDetail,
  InitialData,
  PersonWithCount,
  Photo,
  PhotoDetail,
  Tag,
  TimelineFilters,
  TimelinePage,
} from "@/lib/contracts";
import { ApiError, requireMember } from "@/lib/data/member";
import {
  groupByMonth,
  mapComment,
  mapPhotos,
  mapReaction,
} from "@/lib/data/mappers";
import { signPaths } from "@/lib/data/signing";
import {
  decodeTimelineCursor,
  encodeTimelineCursor,
} from "@/lib/data/timeline-cursor";
import { currentSeoulDateParts, seoulDateParts } from "@/lib/date-time";
import {
  PHOTO_SELECT,
  type CommentRow,
  type PhotoRow,
  type ReactionRow,
} from "@/lib/data/types";

const DEFAULT_PAGE_SIZE = 60;
const MAX_PAGE_SIZE = 200;

function yearRange(year: number): { from: string; to: string } {
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new ApiError(400, "invalid_year");
  }
  const boundary = (boundaryYear: number) => {
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(boundaryYear, 0, 1);
    date.setUTCHours(-9, 0, 0, 0);
    return date;
  };
  const minimum = new Date("0001-01-01T00:00:00.000Z");
  const from = boundary(year);
  return {
    from: new Date(Math.max(from.getTime(), minimum.getTime())).toISOString(),
    to: boundary(year + 1).toISOString(),
  };
}

// Keyset pagination avoids offset drift while new photos are added.
export async function getTimeline(
  sb: SupabaseClient,
  cursor: string | null,
  limit: number = DEFAULT_PAGE_SIZE,
  filters: TimelineFilters = {},
): Promise<TimelinePage> {
  const pageSize = Number.isInteger(limit)
    ? Math.min(Math.max(limit, 1), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;

  let select = PHOTO_SELECT;
  if (filters.personId) select += ", pp_filter:photo_people!inner(person_id)";
  if (filters.tagId) select += ", pt_filter:photo_tags!inner(tag_id)";
  if (filters.albumId) select += ", ap_filter:album_photos!inner(album_id)";

  let query = sb
    .from("photos")
    .select(select, { count: "exact" })
    .is("deleted_at", null);

  if (filters.favorite) query = query.eq("favorite", true);
  if (filters.year) {
    const { from, to } = yearRange(filters.year);
    query = query.gte("taken_at", from).lt("taken_at", to);
  }
  if (filters.personId) query = query.eq("pp_filter.person_id", filters.personId);
  if (filters.tagId) query = query.eq("pt_filter.tag_id", filters.tagId);
  if (filters.albumId) query = query.eq("ap_filter.album_id", filters.albumId);

  const decoded = decodeTimelineCursor(cursor);
  if (decoded) {
    query = query.or(
      `taken_at.lt.${decoded.t},and(taken_at.eq.${decoded.t},id.lt.${decoded.id})`,
    );
  }

  const { data, error, count } = await query
    .order("taken_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize);
  if (error) throw new ApiError(500, error.message);

  const rows = (data ?? []) as unknown as PhotoRow[];
  const photos = await mapPhotos(sb, rows);
  const last = rows.at(-1);
  const nextCursor =
    rows.length === pageSize && last
      ? encodeTimelineCursor({ t: last.taken_at, id: last.id })
      : null;

  return {
    months: groupByMonth(photos),
    photos,
    nextCursor,
    total: count ?? photos.length,
  };
}

// 사진 상세 + 반응 + 코멘트
export async function getPhoto(
  sb: SupabaseClient,
  id: string,
): Promise<PhotoDetail> {
  const select = `${PHOTO_SELECT},
    reactions ( id, emoji, created_at, member:family_members!reactions_member_id_fkey ( id, display_name, avatar_url ) ),
    comments ( id, body, created_at, member:family_members!comments_member_id_fkey ( id, display_name, avatar_url ) )`;

  const { data, error } = await sb
    .from("photos")
    .select(select)
    .eq("id", id)
    .is("deleted_at", null)
    .order("created_at", { referencedTable: "comments", ascending: true })
    .order("created_at", { referencedTable: "reactions", ascending: true })
    .maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, "photo_not_found");

  const row = data as unknown as PhotoRow & {
    reactions: ReactionRow[] | null;
    comments: CommentRow[] | null;
  };
  const [photo] = await mapPhotos(sb, [row]);
  return {
    ...photo,
    reactions: (row.reactions ?? []).map(mapReaction),
    comments: (row.comments ?? []).map(mapComment),
  };
}

export async function getPhotosByIds(
  sb: SupabaseClient,
  ids: string[],
): Promise<Photo[]> {
  if (ids.length === 0) return [];
  const { data, error } = await sb
    .from("photos")
    .select(PHOTO_SELECT)
    .in("id", ids)
    .is("deleted_at", null)
    .limit(200);
  if (error) throw new ApiError(500, error.message);
  return mapPhotos(sb, (data ?? []) as unknown as PhotoRow[]);
}

type AlbumRow = {
  id: string;
  title: string;
  kind: "auto" | "manual";
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  cover: { thumb_path: string } | null;
};

function mapAlbum(
  row: AlbumRow,
  counts: Map<string, number>,
  thumbUrls: Map<string, string>,
): Album {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    coverUrl: row.cover ? (thumbUrls.get(row.cover.thumb_path) ?? null) : null,
    photoCount: counts.get(row.id) ?? 0,
    startDate: row.start_date,
    endDate: row.end_date,
  };
}

const ALBUM_SELECT =
  "id, title, kind, start_date, end_date, created_at, cover:photos!albums_cover_photo_id_fkey ( thumb_path )";

async function albumCounts(sb: SupabaseClient): Promise<Map<string, number>> {
  const { data, error } = await sb.rpc("album_photo_counts");
  if (error) throw new ApiError(500, error.message);
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as { album_id: string; photo_count: number }[]) {
    counts.set(row.album_id, Number(row.photo_count));
  }
  return counts;
}

// 앨범 목록 — auto는 연도 내림차순, manual은 최신 생성 순
export async function getAlbums(sb: SupabaseClient): Promise<Album[]> {
  const { data, error } = await sb
    .from("albums")
    .select(ALBUM_SELECT)
    .order("created_at", { ascending: false });
  if (error) throw new ApiError(500, error.message);

  const rows = (data ?? []) as unknown as AlbumRow[];
  const counts = await albumCounts(sb);
  const thumbUrls = await signPaths(
    sb,
    "thumbs",
    rows.flatMap((r) => (r.cover ? [r.cover.thumb_path] : [])),
  );

  const albums = rows.map((r) => mapAlbum(r, counts, thumbUrls));
  const autos = albums
    .filter((a) => a.kind === "auto")
    .sort((a, b) => b.title.localeCompare(a.title));
  const manuals = albums.filter((a) => a.kind === "manual");
  return [...autos, ...manuals];
}

// 앨범 상세 + 사진 목록 (position 순)
export async function getAlbum(
  sb: SupabaseClient,
  id: string,
): Promise<AlbumDetail> {
  const { data, error } = await sb
    .from("albums")
    .select(ALBUM_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, "album_not_found");
  const albumRow = data as unknown as AlbumRow;

  const { data: linkData, error: linkError } = await sb
    .from("album_photos")
    .select(`position, photo:photos!album_photos_photo_id_fkey ( ${PHOTO_SELECT} )`)
    .eq("album_id", id)
    .order("position", { ascending: true });
  if (linkError) throw new ApiError(500, linkError.message);

  const photoRows = ((linkData ?? []) as unknown as {
    position: number;
    photo: (PhotoRow & { deleted_at?: string | null }) | null;
  }[])
    .map((l) => l.photo)
    .filter((p): p is PhotoRow => p != null);

  const photos = await mapPhotos(sb, photoRows);
  const counts = await albumCounts(sb);
  const thumbUrls = await signPaths(
    sb,
    "thumbs",
    albumRow.cover ? [albumRow.cover.thumb_path] : [],
  );

  return { ...mapAlbum(albumRow, counts, thumbUrls), photos };
}

// 인물 목록 (+사진 수)
export async function getPeople(sb: SupabaseClient): Promise<PersonWithCount[]> {
  const { data, error } = await sb
    .from("people")
    .select("id, name, cover:photos!people_cover_photo_id_fkey ( thumb_path )")
    .order("name", { ascending: true });
  if (error) throw new ApiError(500, error.message);

  const rows = (data ?? []) as unknown as {
    id: string;
    name: string;
    cover: { thumb_path: string } | null;
  }[];

  const { data: countData, error: countError } =
    await sb.rpc("person_photo_counts");
  if (countError) throw new ApiError(500, countError.message);
  const counts = new Map<string, number>();
  for (const row of (countData ?? []) as {
    person_id: string;
    photo_count: number;
  }[]) {
    counts.set(row.person_id, Number(row.photo_count));
  }

  const thumbUrls = await signPaths(
    sb,
    "thumbs",
    rows.flatMap((r) => (r.cover ? [r.cover.thumb_path] : [])),
  );

  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      coverUrl: r.cover ? (thumbUrls.get(r.cover.thumb_path) ?? null) : null,
      count: counts.get(r.id) ?? 0,
    }))
    .sort((a, b) => b.count - a.count);
}

export async function getOnThisDay(
  sb: SupabaseClient,
  now: Date = new Date(),
): Promise<Photo[]> {
  const today = seoulDateParts(now);
  const { data, error } = await sb.rpc("photos_on_this_day", {
    p_month: today.month,
    p_day: today.day,
    p_year: today.year,
  });
  if (error) throw new ApiError(500, error.message);

  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return [];

  const { data: rows, error: rowsError } = await sb
    .from("photos")
    .select(PHOTO_SELECT)
    .in("id", ids)
    .order("taken_at", { ascending: false });
  if (rowsError) throw new ApiError(500, rowsError.message);

  return mapPhotos(sb, (rows ?? []) as unknown as PhotoRow[]);
}

export async function getHighlights(
  sb: SupabaseClient,
  year: number,
): Promise<Photo[]> {
  const { from, to } = yearRange(year);
  const { data, error } = await sb
    .from("photos")
    .select(PHOTO_SELECT)
    .is("deleted_at", null)
    .eq("favorite", true)
    .gte("taken_at", from)
    .lt("taken_at", to)
    .order("taken_at", { ascending: false });
  if (error) throw new ApiError(500, error.message);
  return mapPhotos(sb, (data ?? []) as unknown as PhotoRow[]);
}

async function getFavoriteCount(
  sb: SupabaseClient,
  year: number,
): Promise<number> {
  const { from, to } = yearRange(year);
  const { count, error } = await sb
    .from("photos")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .eq("favorite", true)
    .gte("taken_at", from)
    .lt("taken_at", to);
  if (error) throw new ApiError(500, error.message);
  return count ?? 0;
}

async function getTags(sb: SupabaseClient): Promise<Tag[]> {
  const { data, error } = await sb
    .from("tags")
    .select("id, label")
    .order("label", { ascending: true });
  if (error) throw new ApiError(500, error.message);
  return (data ?? []) as Tag[];
}

async function getYears(sb: SupabaseClient): Promise<number[]> {
  const { data, error } = await sb.rpc("photo_years");
  if (error) throw new ApiError(500, error.message);
  return ((data ?? []) as number[]).map(Number);
}

// 첫 화면 주입 데이터 — 서버 컴포넌트와 /api/bootstrap 이 공유한다
export async function buildInitialData(
  sb: SupabaseClient,
): Promise<InitialData> {
  const member = await requireMember(sb);
  const currentYear = currentSeoulDateParts().year;

  const [timeline, albums, people, tags, memories, years, favCount] =
    await Promise.all([
      getTimeline(sb, null, DEFAULT_PAGE_SIZE, {}),
      getAlbums(sb),
      getPeople(sb),
      getTags(sb),
      getOnThisDay(sb),
      getYears(sb),
      getFavoriteCount(sb, currentYear),
    ]);

  return {
    member: {
      id: member.memberId,
      displayName: member.displayName,
      avatarUrl: member.avatarUrl,
    },
    role: member.role,
    timeline,
    albums,
    people,
    tags,
    memories,
    years,
    currentYear,
    favCount,
  };
}
