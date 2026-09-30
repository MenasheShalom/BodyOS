import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./api", async (orig) => ({
  ...(await orig<typeof import("./api")>()),
  api: vi.fn().mockResolvedValue({ id: "1" }),
}));

import { api } from "./api";
import { bodyEntries, qk, useLogFood } from "./queries";

describe("mutations", () => {
  it("creating a body entry invalidates list, series, dashboard and goals", async () => {
    const qc = new QueryClient();
    const keys = [qk.bodyEntries, qk.series("weight_kg", "3M"), qk.dashboard, qk.goals];
    for (const key of keys) qc.setQueryData(key, { cached: true });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => bodyEntries.useCreate(), { wrapper });
    await act(() => result.current.mutateAsync({ weight_kg: 80 } as never));

    expect(api).toHaveBeenCalledWith("/body-entries", { method: "POST", json: { weight_kg: 80 } });
    for (const key of keys) {
      expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it("logging food invalidates the food day and the dashboard", async () => {
    const qc = new QueryClient();
    const keys = [qk.foodDay("2026-09-30"), qk.dashboard];
    for (const key of keys) qc.setQueryData(key, { cached: true });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useLogFood(), { wrapper });
    const body = {
      food_id: "f1",
      grams: 60,
      serving_label: null,
      serving_count: null,
      meal: "lunch" as const,
      eaten_at: "2026-09-30T10:00:00.000Z",
    };
    await act(() => result.current.mutateAsync(body));

    expect(api).toHaveBeenCalledWith("/food-log", { method: "POST", json: body });
    for (const key of keys) {
      expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });
});
