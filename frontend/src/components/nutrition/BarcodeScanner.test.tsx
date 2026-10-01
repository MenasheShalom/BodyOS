import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/barcode", async (orig) => ({
  ...(await orig<typeof import("../../lib/barcode")>()),
  pickDetector: vi.fn(),
}));

import { BarcodeScanner } from "./BarcodeScanner";

describe("BarcodeScanner", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("falls back to typing when camera access is blocked", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(new DOMException("no", "NotAllowedError")),
      },
    });
    render(<BarcodeScanner onCode={vi.fn()} />);
    expect(await screen.findByText(/Camera access is blocked/)).toBeInTheDocument();
  });

  it("looks up a typed barcode and rejects a short one", async () => {
    vi.stubGlobal("navigator", { ...navigator, mediaDevices: undefined });
    const onCode = vi.fn();
    render(<BarcodeScanner onCode={onCode} />);
    const input = screen.getByLabelText("Or type the barcode");
    await userEvent.type(input, "123");
    await userEvent.click(screen.getByRole("button", { name: "Look up" }));
    expect(screen.getByText("Barcodes are 6 to 14 digits")).toBeInTheDocument();
    await userEvent.type(input, "4567890");
    await userEvent.click(screen.getByRole("button", { name: "Look up" }));
    expect(onCode).toHaveBeenCalledWith("1234567890");
  });
});
