import { describe, expect, it, vi } from "vitest";

const signOut = vi.fn().mockResolvedValue({ error: null });
vi.mock("./supabase", () => ({ supabase: { auth: { signOut: (...a: unknown[]) => signOut(...a) } } }));

import { handleUnauthorized } from "./session";

describe("handleUnauthorized", () => {
  it("signs out on this device only and returns to the current page after sign-in", async () => {
    const assign = vi.fn();
    await handleUnauthorized({ pathname: "/trends", search: "?metric=bmi", assign });
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(assign).toHaveBeenCalledWith(`/sign-in?next=${encodeURIComponent("/trends?metric=bmi")}`);
  });

  it("does nothing on the sign-in page", async () => {
    signOut.mockClear();
    const assign = vi.fn();
    await handleUnauthorized({ pathname: "/sign-in", search: "", assign });
    expect(signOut).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});
