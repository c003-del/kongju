"use client";
import exifr from "exifr";
import { encode as encodeBlurhash } from "blurhash";
import type { Photo } from "@/lib/contracts";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

const THUMB_LONG_EDGE = 512;
const THUMB_QUALITY = 0.82;
const BLURHASH_MAX_EDGE = 32;
const MIME_BY_EXTENSION: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export type UploadOutcome =
  | { status: "created"; photo: Photo; previewUrl: string }
  | { status: "duplicate"; photoId: string; previewUrl: string };

type TicketResponse =
  | { duplicate: true; photoId: string }
  | {
      duplicate: false;
      photoId: string;
      storagePath: string;
      thumbPath: string;
      originalToken: string;
      thumbToken: string;
    };

type RecordResponse = { duplicate: boolean; photo: Photo };

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `http_${res.status}`);
  return json;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function extractTakenAt(file: File): Promise<string> {
  try {
    const exif = (await exifr.parse(file, [
      "DateTimeOriginal",
      "CreateDate",
    ])) as { DateTimeOriginal?: Date; CreateDate?: Date } | undefined;
    const dt = exif?.DateTimeOriginal ?? exif?.CreateDate;
    if (dt instanceof Date && !Number.isNaN(dt.getTime())) {
      return dt.toISOString();
    }
  } catch {
    // EXIF 파싱 실패 시 lastModified 사용
  }
  return new Date(file.lastModified).toISOString();
}

function mimeFor(file: File): string {
  if (Object.values(MIME_BY_EXTENSION).includes(file.type)) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME_BY_EXTENSION[extension];
  if (!mime) throw new Error("unsupported_image");
  return mime;
}

async function decodeImage(file: File): Promise<ImageBitmap> {
  try {
    // EXIF 회전을 반영해 디코드한다
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("unsupported_image");
  }
}

function drawToCanvas(
  bitmap: ImageBitmap,
  maxLongEdge: number,
): HTMLCanvasElement {
  const scale = Math.min(1, maxLongEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("thumbnail_failed"))),
      type,
      quality,
    );
  });
}

function blurhashFrom(canvas: HTMLCanvasElement): string | null {
  try {
    const scale = Math.min(
      1,
      BLURHASH_MAX_EDGE / Math.max(canvas.width, canvas.height),
    );
    const width = Math.max(1, Math.round(canvas.width * scale));
    const height = Math.max(1, Math.round(canvas.height * scale));
    const small = document.createElement("canvas");
    small.width = width;
    small.height = height;
    const ctx = small.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    return encodeBlurhash(imageData.data, width, height, 4, 3);
  } catch {
    return null;
  }
}

export async function uploadPhotoFile(
  file: File,
  onProgress: (pct: number) => void,
): Promise<UploadOutcome> {
  const mime = mimeFor(file);
  onProgress(4);
  const buffer = await file.arrayBuffer();
  const hash = await sha256Hex(buffer);
  onProgress(12);

  const takenAt = await extractTakenAt(file);
  onProgress(20);

  const bitmap = await decodeImage(file);
  const width = bitmap.width;
  const height = bitmap.height;
  let thumbBlob: Blob;
  let blurhash: string | null;
  try {
    const thumbCanvas = drawToCanvas(bitmap, THUMB_LONG_EDGE);
    thumbBlob = await canvasToBlob(thumbCanvas, "image/webp", THUMB_QUALITY);
    onProgress(34);
    blurhash = blurhashFrom(thumbCanvas);
  } finally {
    bitmap.close();
  }
  onProgress(42);

  const previewUrl = URL.createObjectURL(thumbBlob);
  try {
    const ticket = await postJson<TicketResponse>("/api/photos/upload-url", {
      fileName: file.name,
      mime,
      bytes: file.size,
      hash,
      takenAt,
    });
    onProgress(52);

    if (ticket.duplicate) {
      onProgress(100);
      return { status: "duplicate", photoId: ticket.photoId, previewUrl };
    }

    const sb = createSupabaseBrowser();
    const original = await sb.storage
      .from("photos")
      .uploadToSignedUrl(ticket.storagePath, ticket.originalToken, file, {
        contentType: mime,
      });
    if (original.error) throw new Error(original.error.message);
    onProgress(80);

    const thumb = await sb.storage
      .from("thumbs")
      .uploadToSignedUrl(ticket.thumbPath, ticket.thumbToken, thumbBlob, {
        contentType: "image/webp",
      });
    if (thumb.error) throw new Error(thumb.error.message);
    onProgress(90);

    const record = await postJson<RecordResponse>("/api/photos", {
      photoId: ticket.photoId,
      storagePath: ticket.storagePath,
      thumbPath: ticket.thumbPath,
      mime,
      bytes: file.size,
      width,
      height,
      blurhash,
      hash,
      takenAt,
    });
    onProgress(100);

    if (record.duplicate) {
      return { status: "duplicate", photoId: record.photo.id, previewUrl };
    }
    return { status: "created", photo: record.photo, previewUrl };
  } catch (error) {
    URL.revokeObjectURL(previewUrl);
    throw error;
  }
}
