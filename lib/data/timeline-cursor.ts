const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANONICAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
export const MAX_TIMELINE_CURSOR_LENGTH = 512;

export type TimelineCursor = { t: string; id: string };

export function encodeTimelineCursor(cursor: TimelineCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeTimelineCursor(raw: string | null | undefined): TimelineCursor | null {
  if (
    !raw ||
    raw.length > MAX_TIMELINE_CURSOR_LENGTH ||
    !BASE64URL.test(raw)
  ) {
    return null;
  }
  try {
    const decoded = Buffer.from(raw, "base64url");
    if (decoded.toString("base64url") !== raw) return null;
    const parsed = JSON.parse(decoded.toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.t !== "string" ||
      typeof candidate.id !== "string" ||
      !CANONICAL_ISO.test(candidate.t) ||
      !UUID.test(candidate.id)
    ) {
      return null;
    }
    const timestamp = new Date(candidate.t);
    if (
      Number.isNaN(timestamp.getTime()) ||
      timestamp.toISOString() !== candidate.t ||
      timestamp.getUTCFullYear() < 1 ||
      timestamp.getUTCFullYear() > 9999
    ) {
      return null;
    }
    return { t: candidate.t, id: candidate.id };
  } catch {
    return null;
  }
}
