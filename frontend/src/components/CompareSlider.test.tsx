import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CompareSlider } from "./CompareSlider";

describe("CompareSlider", () => {
  it("reveals the before photo up to the slider position", () => {
    render(
      <CompareSlider beforeUrl="b.jpg" afterUrl="a.jpg" beforeLabel="1 Feb" afterLabel="28 Feb" />,
    );
    const before = screen.getByAltText("Before: 1 Feb");
    expect(before.style.clipPath).toBe("inset(0 50% 0 0)");
    fireEvent.change(screen.getByLabelText("Compare position"), { target: { value: "30" } });
    expect(before.style.clipPath).toBe("inset(0 70% 0 0)");
  });
});
