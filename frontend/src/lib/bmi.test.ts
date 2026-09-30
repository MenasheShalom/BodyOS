import { describe, expect, it } from "vitest";
import { bmiBands, bmiBoundariesAround, bmiZone, healthyWeightRange } from "./bmi";

describe("bmiZone", () => {
  it("uses the WHO cut-offs", () => {
    expect(bmiZone(17.9)).toBe("Underweight");
    expect(bmiZone(18.5)).toBe("Healthy");
    expect(bmiZone(24.9)).toBe("Healthy");
    expect(bmiZone(25)).toBe("Overweight");
    expect(bmiZone(29.9)).toBe("Overweight");
    expect(bmiZone(30)).toBe("Obese");
  });
});

describe("healthyWeightRange", () => {
  it("converts the healthy BMI range to kilograms for a height", () => {
    expect(healthyWeightRange(168)).toEqual([52.2, 70.3]);
  });
});

describe("bmiBoundariesAround", () => {
  it("returns the zone boundaries just below and above the readings", () => {
    expect(bmiBoundariesAround([26.1, 26.4])).toEqual([25, 30]);
    expect(bmiBoundariesAround([23])).toEqual([18.5, 25]);
    expect(bmiBoundariesAround([24.5, 25.5])).toEqual([18.5, 25, 30]);
    expect(bmiBoundariesAround([31])).toEqual([30]);
    expect(bmiBoundariesAround([])).toEqual([]);
  });
});

describe("bmiBands", () => {
  it("clips the zones to the visible range", () => {
    expect(bmiBands([24, 31])).toEqual([
      { label: "Healthy", y1: 24, y2: 25 },
      { label: "Overweight", y1: 25, y2: 30 },
      { label: "Obese", y1: 30, y2: 31 },
    ]);
  });
});
