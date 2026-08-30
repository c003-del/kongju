import { describe, expect, it } from "vitest";
import { timelineQuery } from "../lib/api-client";

describe("timelineQuery", () => {
  it("serializes every supported filter, cursor, and limit", () => {
    const query = timelineQuery(
      {
        year: 2026,
        personId: "person/one",
        tagId: "family trip",
        albumId: "album-1",
        favorite: true,
      },
      "cursor+next",
      24,
    );
    const params = new URLSearchParams(query);

    expect(Object.fromEntries(params)).toEqual({
      year: "2026",
      personId: "person/one",
      tagId: "family trip",
      albumId: "album-1",
      favorite: "true",
      cursor: "cursor+next",
      limit: "24",
    });
  });

  it("omits inactive optional values", () => {
    expect(
      timelineQuery(
        {
          year: null,
          personId: "",
          tagId: null,
          albumId: null,
          favorite: false,
        },
        null,
      ),
    ).toBe("");
  });
});
