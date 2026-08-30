import { describe, expect, it } from "vitest";
import { createTrainingPreviewData } from "../lib/demo-data";
import { seoulDateParts } from "../lib/date-time";

describe("training preview data", () => {
  it("stays aligned with the current Seoul date and year", () => {
    const data = createTrainingPreviewData(
      new Date("2027-01-01T00:30:00.000Z"),
    );

    expect(data.currentYear).toBe(2027);
    expect(data.years).toEqual([2027, 2026, 2025]);
    expect(data.albums[0].title).toBe("2027");
    expect(seoulDateParts(data.memories[0].takenAt)).toMatchObject({
      year: 2025,
      month: 1,
      day: 1,
    });
  });
});
