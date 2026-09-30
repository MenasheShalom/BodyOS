import { describe, expect, it } from "vitest";
import { addDays, dayLabel, defaultMeal, eatenAtFor } from "./meals";

const at = (h: number, m = 0) => new Date(2026, 8, 30, h, m);

describe("meals", () => {
  it("picks a meal from the time of day", () => {
    expect(defaultMeal(at(3, 59))).toBe("snack");
    expect(defaultMeal(at(4))).toBe("breakfast");
    expect(defaultMeal(at(10, 59))).toBe("breakfast");
    expect(defaultMeal(at(11))).toBe("lunch");
    expect(defaultMeal(at(16))).toBe("dinner");
    expect(defaultMeal(at(21, 59))).toBe("dinner");
    expect(defaultMeal(at(22))).toBe("snack");
  });

  it("uses now for today and the meal's usual time for past days", () => {
    const now = at(14, 30);
    expect(eatenAtFor("2026-09-30", "dinner", now)).toBe(now.toISOString());
    expect(eatenAtFor("2026-09-29", "dinner", now)).toBe(
      new Date(2026, 8, 29, 19, 0).toISOString(),
    );
  });

  it("moves between days across month ends", () => {
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("labels days", () => {
    const now = at(9);
    expect(dayLabel("2026-09-30", now)).toBe("Today");
    expect(dayLabel("2026-09-29", now)).toBe("Yesterday");
    expect(dayLabel("2026-09-27", now)).toBe("Sun 27 Sept");
  });
});
