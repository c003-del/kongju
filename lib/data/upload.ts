import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Photo } from "@/lib/contracts";
import { ApiError, requireMember } from "@/lib/data/member";
import { mapPhotos } from "@/lib/data/mappers";
import { PHOTO_SELECT, type PhotoRow } from "@/lib/data/types";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

const ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);
const MAX_ORIGINAL_BYTES = 50 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type UploadTicketRequest = {
  fileName: string;
  mime: string;
  bytes: number;
  hash: string;
  takenAt: string;
};

export type UploadTicket =
  | { duplicate: true; photoId: string }
  | {
      duplicate: false;
      photoId: string;
      storagePath: string;
      thumbPath: string;
      originalToken: string;
      thumbToken: string;
    };

function assertValidHash(hash: string): void {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new ApiError(400, "invalid_hash");
}

export async function createUploadTicket(
  sb: SupabaseClient,
  request: UploadTicketRequest,
): Promise<UploadTicket> {
  const member = await requireMember(sb);
  if (
    typeof request.mime !== "string" ||
    typeof request.hash !== "string" ||
    typeof request.takenAt !== "string"
  ) {
    throw new ApiError(400, "invalid_upload_request");
  }
  const mime = request.mime.toLowerCase();
  if (!ALLOWED_MIMES.has(mime)) {
    throw new ApiError(400, "unsupported_mime");
  }
  if (!Number.isSafeInteger(request.bytes) || request.bytes < 1 || request.bytes > MAX_ORIGINAL_BYTES) {
    throw new ApiError(400, "invalid_file_size");
  }
  assertValidHash(request.hash);

  const { data: existing, error: existingError } = await sb
    .from("photos")
    .select("id")
    .eq("hash", request.hash)
    .maybeSingle();
  if (existingError) throw new ApiError(500, existingError.message);
  if (existing) return { duplicate: true, photoId: existing.id };

  const takenAt = new Date(request.takenAt);
  if (
    Number.isNaN(takenAt.getTime()) ||
    takenAt.getUTCFullYear() < 1 ||
    takenAt.getUTCFullYear() > 9999
  ) {
    throw new ApiError(400, "invalid_taken_at");
  }

  const requestedPhotoId = crypto.randomUUID();
  const admin = createSupabaseAdmin();
  const { data: reservationRows, error: reservationError } = await admin.rpc(
    "create_photo_upload_reservation",
    {
      p_family_id: member.familyId,
      p_member_id: member.memberId,
      p_photo_id: requestedPhotoId,
      p_mime: mime,
      p_bytes: request.bytes,
      p_hash: request.hash,
      p_taken_at: takenAt.toISOString(),
    },
  );
  if (reservationError || !reservationRows?.[0]) {
    throw new ApiError(500, "upload_reservation_failed");
  }
  const reservation = reservationRows[0] as {
    is_duplicate: boolean;
    photo_id: string;
    storage_path: string | null;
    thumb_path: string | null;
  };
  if (reservation.is_duplicate) {
    return { duplicate: true, photoId: reservation.photo_id };
  }
  if (!reservation.storage_path || !reservation.thumb_path) {
    throw new ApiError(500, "upload_reservation_failed");
  }
  const photoId = reservation.photo_id;
  const storagePath = reservation.storage_path;
  const thumbPath = reservation.thumb_path;

  const [original, thumb] = await Promise.all([
    admin.storage.from("photos").createSignedUploadUrl(storagePath),
    admin.storage.from("thumbs").createSignedUploadUrl(thumbPath),
  ]);
  if (original.error || !original.data) {
    throw new ApiError(500, original.error?.message ?? "signed_upload_failed");
  }
  if (thumb.error || !thumb.data) {
    throw new ApiError(500, thumb.error?.message ?? "signed_upload_failed");
  }

  return {
    duplicate: false,
    photoId,
    storagePath,
    thumbPath,
    originalToken: original.data.token,
    thumbToken: thumb.data.token,
  };
}

export type PhotoRecordRequest = {
  photoId: string;
  storagePath: string;
  thumbPath: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  blurhash: string | null;
  hash: string;
  takenAt: string;
  caption?: string | null;
};

export type PhotoRecordResult = { duplicate: boolean; photo: Photo };

async function fetchPhotoById(sb: SupabaseClient, id: string): Promise<Photo> {
  const { data, error } = await sb
    .from("photos")
    .select(PHOTO_SELECT)
    .eq("id", id)
    .single();
  if (error) throw new ApiError(500, error.message);
  const [photo] = await mapPhotos(sb, [data as unknown as PhotoRow]);
  return photo;
}

// 업로드 완료 후 photos 레코드 삽입. (family_id, hash) 충돌이면 기존 사진을 반환한다.
export async function insertPhotoRecord(
  sb: SupabaseClient,
  request: PhotoRecordRequest,
): Promise<PhotoRecordResult> {
  const member = await requireMember(sb);
  if (
    typeof request.photoId !== "string" ||
    !UUID_PATTERN.test(request.photoId) ||
    typeof request.storagePath !== "string" ||
    typeof request.thumbPath !== "string" ||
    typeof request.mime !== "string" ||
    typeof request.hash !== "string" ||
    typeof request.takenAt !== "string" ||
    (request.blurhash !== null && typeof request.blurhash !== "string") ||
    (request.caption != null && typeof request.caption !== "string")
  ) {
    throw new ApiError(400, "invalid_photo_record");
  }
  if ((request.blurhash?.length ?? 0) > 200 || (request.caption?.length ?? 0) > 5000) {
    throw new ApiError(400, "invalid_photo_record");
  }
  assertValidHash(request.hash);
  const mime = request.mime.toLowerCase();
  if (!ALLOWED_MIMES.has(mime)) throw new ApiError(400, "unsupported_mime");
  if (!Number.isSafeInteger(request.bytes) || request.bytes < 1 || request.bytes > MAX_ORIGINAL_BYTES) {
    throw new ApiError(400, "invalid_file_size");
  }
  if (!Number.isInteger(request.width) || !Number.isInteger(request.height) ||
      request.width < 1 || request.height < 1 || request.width > 100000 || request.height > 100000) {
    throw new ApiError(400, "invalid_dimensions");
  }

  // 경로 위조 방지 — 본인 가족 경로만 허용
  const prefix = `${member.familyId}/`;
  if (
    !request.storagePath.startsWith(prefix) ||
    !request.thumbPath.startsWith(prefix)
  ) {
    throw new ApiError(400, "invalid_storage_path");
  }

  const takenAt = new Date(request.takenAt);
  if (
    Number.isNaN(takenAt.getTime()) ||
    takenAt.getUTCFullYear() < 1 ||
    takenAt.getUTCFullYear() > 9999
  ) {
    throw new ApiError(400, "invalid_taken_at");
  }

  const admin = createSupabaseAdmin();
  const { data: finalizedRows, error } = await admin.rpc("finalize_photo_upload", {
    p_photo_id: request.photoId,
    p_family_id: member.familyId,
    p_member_id: member.memberId,
    p_storage_path: request.storagePath,
    p_thumb_path: request.thumbPath,
    p_mime: mime,
    p_bytes: request.bytes,
    p_width: request.width,
    p_height: request.height,
    p_blurhash: request.blurhash,
    p_hash: request.hash,
    p_taken_at: takenAt.toISOString(),
    p_caption: request.caption?.trim() || null,
  });
  if (error || !finalizedRows?.[0]) {
    throw new ApiError(400, "upload_finalize_failed");
  }
  const finalized = finalizedRows[0] as {
    is_duplicate: boolean;
    photo_id: string;
  };

  if (finalized.is_duplicate) {
    // The client has already received two-hour signed upload tokens. Never
    // cancel this reservation early: a token replay after cancellation would
    // recreate an untracked orphan. Remove best-effort now, then let the expiry
    // cron remove either path again after both tokens have become unusable.
    await Promise.all([
      admin.storage.from("photos").remove([request.storagePath]),
      admin.storage.from("thumbs").remove([request.thumbPath]),
    ]);
    return {
      duplicate: true,
      photo: await fetchPhotoById(sb, finalized.photo_id),
    };
  }

  return { duplicate: false, photo: await fetchPhotoById(sb, finalized.photo_id) };
}
