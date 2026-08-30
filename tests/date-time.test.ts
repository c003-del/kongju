import { describe, expect, it } from "vitest";
import { seoulDateParts } from "../lib/date-time";

describe("seoulDateParts", () => {
  it("uses one fixed timezone on the server and in the browser", () => {
    expect(seoulDateParts("2026-08-30T15:30:45.000Z")).toEqual({
      year: 2026,
      month: 8,
      day: 31,
      hour: 0,
      minute: 30,
      second: 45,
    });
  });

  it("rejects invalid timestamps", () => {
    expect(() => seoulDateParts("not-a-date")).toThrow(RangeError);
  });
});
