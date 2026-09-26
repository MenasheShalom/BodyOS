import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { applyServerErrors, optionalNumber, requiredNumber } from "./forms";

describe("number schemas", () => {
  it("parses dot and comma decimals", () => {
    expect(requiredNumber(20, 400).parse("82.4")).toBe(82.4);
    expect(requiredNumber(20, 400).parse(" 82,4 ")).toBe(82.4);
  });
  it("rejects empty required values and out-of-range values", () => {
    expect(requiredNumber(20, 400).safeParse("").success).toBe(false);
    const res = requiredNumber(20, 400).safeParse("805");
    expect(res.success).toBe(false);
    expect(res.error?.issues[0].message).toBe("Must be between 20 and 400");
    expect(requiredNumber(20, 400).safeParse("abc").error?.issues[0].message).toBe(
      "Enter a number",
    );
  });
  it("treats empty optional values as undefined", () => {
    expect(optionalNumber(2, 70).parse("")).toBeUndefined();
    expect(optionalNumber(2, 70).parse("18.5")).toBe(18.5);
    expect(optionalNumber(2, 70).safeParse("95").success).toBe(false);
  });
});

describe("applyServerErrors", () => {
  it("maps known fields and returns the general message", () => {
    const setError = vi.fn();
    const msg = applyServerErrors(
      new ApiError(422, "Please fix the highlighted fields.", { weight_kg: "too big", other: "x" }),
      setError,
      ["weight_kg"],
    );
    expect(setError).toHaveBeenCalledWith("weight_kg", { message: "too big" });
    expect(setError).toHaveBeenCalledTimes(1);
    expect(msg).toBe("Please fix the highlighted fields.");
  });
  it("returns a friendly message for unknown errors", () => {
    expect(applyServerErrors(new Error("boom"), vi.fn(), [])).toBe(
      "Couldn't save. Your entry is still here, so try again.",
    );
  });
});
