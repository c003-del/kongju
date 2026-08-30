import { describe, expect, it } from "vitest";
import {
  decodeTimelineCursor,
  encodeTimelineCursor,
  MAX_TIMELINE_CURSOR_LENGTH,
} from "../lib/data/timeline-cursor";

const ID = "6b8f4f86-b8da-4c74-9742-ef04f5c8d628";

describe("timeline cursor", () => {
  it("round-trips a canonical timestamp and UUID", () => {
    const cursor = { t: "2026-08-30T15:30:45.000Z", id: ID };
    expect(decodeTimelineCursor(encodeTimelineCursor(cursor))).toEqual(cursor);
  });

  it.each([
    { t: "2026-08-30T15:30:45Z", id: ID },
    { t: "2026-02-31T00:00:00.000Z", id: ID },
    { t: "2026-08-30T15:30:45.000Z,or(id.neq.x)", id: ID },
    { t: "2026-08-30T15:30:45.000Z", id: "not-a-uuid),or(id.neq.x" },
  ])("rejects non-canonical or injectable values", (cursor) => {
    expect(decodeTimelineCursor(encodeTimelineCursor(cursor))).toBeNull();
  });

  it("rejects malformed and oversized encodings", () => {
    expect(decodeTimelineCursor("not+base64")).toBeNull();
    expect(decodeTimelineCursor("a".repeat(MAX_TIMELINE_CURSOR_LENGTH + 1))).toBeNull();
  });
});
