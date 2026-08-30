import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Private-media links are intentionally short-lived. One hour keeps regular
// browsing sessions usable while still limiting the lifetime of a copied URL.
export const SIGNED_URL_TTL = 60 * 60;

export type SignedUrlMap = Map<string, string>;

// 버킷별로 경로를 모아 한 번에 서명한다.
export async function signPaths(
  sb: SupabaseClient,
  bucket: "photos" | "thumbs",
  paths: string[],
): Promise<SignedUrlMap> {
  const map: SignedUrlMap = new Map();
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return map;

  const { data, error } = await sb.storage
    .from(bucket)
    .createSignedUrls(unique, SIGNED_URL_TTL);
  if (error || !data) throw new Error("private_media_signing_failed");

  for (const entry of data) {
    if (entry.path && entry.signedUrl) map.set(entry.path, entry.signedUrl);
  }
  if (unique.some((path) => !map.has(path))) {
    throw new Error("private_media_signing_incomplete");
  }
  return map;
}
