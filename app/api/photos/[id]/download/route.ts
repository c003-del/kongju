import { NextResponse } from "next/server";
import { uuid } from "@/lib/api/validation";
import { ApiError } from "@/lib/data/member";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/avif": "avif",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function GET(_request: Request, { params }: Params) {
  try {
    const id = uuid((await params).id, "invalid_photo_id");
    const sb = await createSupabaseServer();
    const { data: photo, error: photoError } = await sb
      .from("photos")
      .select("storage_path, mime")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (photoError) throw photoError;
    if (!photo) {
      return NextResponse.json(
        { error: "photo_not_found" },
        { status: 404, headers: { "cache-control": "private, no-store" } },
      );
    }

    const extension = EXTENSION_BY_MIME[photo.mime] ?? "bin";
    const { data: signed, error: signError } = await sb.storage
      .from("photos")
      .createSignedUrl(photo.storage_path, 60, {
        download: `family-photo-${id}.${extension}`,
      });
    if (signError || !signed?.signedUrl) throw signError ?? new Error("sign_failed");

    const response = NextResponse.redirect(signed.signedUrl, 303);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: { "cache-control": "private, no-store" } },
      );
    }
    console.error("[api/photos/download]", error);
    return NextResponse.json(
      { error: "download_failed" },
      { status: 500, headers: { "cache-control": "private, no-store" } },
    );
  }
}
