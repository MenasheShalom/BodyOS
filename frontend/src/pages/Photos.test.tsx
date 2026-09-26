import { describe, expect, it } from "vitest";
import { groupByDay } from "./Photos";

describe("groupByDay", () => {
  it("groups by local day, newest first", () => {
    const photos = [
      { id: "1", taken_at: new Date(2026, 1, 20, 7).toISOString() },
      { id: "2", taken_at: new Date(2026, 1, 27, 7).toISOString() },
      { id: "3", taken_at: new Date(2026, 1, 27, 8).toISOString() },
    ] as never;
    const groups = groupByDay(photos);
    expect(groups.map((g) => g.day)).toEqual(["2026-02-27", "2026-02-20"]);
    expect(groups[0].photos.map((p) => p.id).sort()).toEqual(["2", "3"]);
  });
});
