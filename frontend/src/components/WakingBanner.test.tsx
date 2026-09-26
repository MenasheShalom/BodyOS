import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

let emit: (slow: boolean) => void = () => {};
vi.mock("../lib/api", () => ({
  onSlowRequest: (fn: (slow: boolean) => void) => {
    emit = fn;
    return () => {};
  },
}));

import { WakingBanner } from "./WakingBanner";

describe("WakingBanner", () => {
  it("appears while a request is slow", () => {
    render(<WakingBanner />);
    expect(screen.queryByText(/Waking up server/)).not.toBeInTheDocument();
    act(() => emit(true));
    expect(screen.getByText(/Waking up server/)).toBeInTheDocument();
    act(() => emit(false));
    expect(screen.queryByText(/Waking up server/)).not.toBeInTheDocument();
  });
});
