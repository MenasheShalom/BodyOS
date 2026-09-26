import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PhotoForm } from "./PhotoForm";

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

describe("PhotoForm", () => {
  it("requires a photo, then submits pose, file and date", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PhotoForm lastByPose={{}} onSubmit={onSubmit} />);
    expect(screen.getByRole("button", { name: "Save photo" })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "Side" }));
    const file = new File(["img"], "me.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByLabelText("Choose from gallery"), file);
    await userEvent.click(screen.getByRole("button", { name: "Save photo" }));
    const arg = onSubmit.mock.calls[0][0];
    expect(arg.pose).toBe("side");
    expect(arg.file).toBe(file);
    expect(arg.takenAt).toMatch(/Z$/);
  });

  it("shows the last photo of the same pose as an alignment guide", async () => {
    render(
      <PhotoForm
        lastByPose={{
          front: {
            id: "1",
            pose: "front",
            taken_at: "2026-02-01T07:00:00Z",
            note: null,
            url: "https://x/front.jpg",
          },
        }}
        onSubmit={vi.fn()}
      />,
    );
    await userEvent.upload(
      screen.getByLabelText("Choose from gallery"),
      new File(["i"], "a.jpg", { type: "image/jpeg" }),
    );
    expect(screen.getByAltText("Previous front photo")).toHaveAttribute(
      "src",
      "https://x/front.jpg",
    );
  });
});
