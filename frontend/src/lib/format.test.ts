import { describe, expect, it } from "vitest";
import {
  changeTone,
  formatChange,
  formatDay,
  formatValue,
  localInputToIso,
  toLocalInputValue,
} from "./format";

describe("formatValue", () => {
  it("formats numbers with units", () => {
    expect(formatValue(82.44, "kg")).toBe("82.4 kg");
    expect(formatValue(18.25, "%")).toBe("18.3%");
    expect(formatValue(24.7)).toBe("24.7");
    expect(formatValue(1780, "kcal", 0)).toBe("1780 kcal");
  });
  it("uses an em dash for missing values", () => {
    expect(formatValue(null, "kg")).toBe("—");
    expect(formatValue(undefined)).toBe("—");
  });
});

describe("formatChange", () => {
  it("adds a sign", () => {
    expect(formatChange(-0.42, "kg")).toBe("−0.4 kg");
    expect(formatChange(0, "kg")).toBe("±0.0 kg");
  });
  it("reports changes in a percentage as percentage points", () => {
    // 20% → 17.5% is a drop of 2.5 points, not 2.5 percent.
    expect(formatChange(-2.5, "%")).toBe("−2.5 pts");
    expect(formatChange(1.25, "%")).toBe("+1.3 pts");
    expect(formatChange(0, "kg")).toBe("±0.0 kg");
    expect(formatChange(null)).toBe("—");
  });
});

describe("dates", () => {
  it("formats a calendar day", () => {
    expect(formatDay("2026-02-28")).toBe("28 Feb");
  });
  it("round-trips datetime-local values", () => {
    const d = new Date(2026, 1, 28, 7, 5);
    expect(toLocalInputValue(d)).toBe("2026-02-28T07:05");
    expect(new Date(localInputToIso("2026-02-28T07:05")).getTime()).toBe(d.getTime());
  });
});

describe("changeTone", () => {
  it("is good when moving in the goal direction", () => {
    expect(changeTone(-0.5, "down")).toBe("good");
    expect(changeTone(0.3, "up")).toBe("good");
  });
  it("is bad when moving against it", () => {
    expect(changeTone(0.5, "down")).toBe("bad");
  });
  it("is neutral without a direction or change", () => {
    expect(changeTone(0.5, null)).toBe("neutral");
    expect(changeTone(null, "up")).toBe("neutral");
    expect(changeTone(0, "up")).toBe("neutral");
  });
});
