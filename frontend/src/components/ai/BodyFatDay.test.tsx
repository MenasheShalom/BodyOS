import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BodyFatEstimate, Photo } from "../../lib/types";

const { create, remove, settings, status } = vi.hoisted(() => ({
  create: vi.fn(),
  remove: vi.fn(),
  settings: vi.fn(),
  status: vi.fn(),
}));
vi.mock("../../lib/queries", () => ({
  useAiStatus: () => status(),
  useEstimateBodyFat: () => ({ mutate: create, isPending: false }),
  useDeleteBodyFat: () => ({ mutate: remove, isPending: false }),
  useAiSettings: () => settings(),
  useSaveAiSettings: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
}));

import { BodyFatDay } from "./BodyFatDay";
import { photosForEstimate } from "./bodyFat";

const photo = (id: string, pose: Photo["pose"], taken_at: string): Photo => ({
  id,
  pose,
  taken_at,
  note: null,
  url: `https://x/${id}`,
});
const PHOTOS = [
  photo("side1", "side", "2026-10-04T07:00:00Z"),
  photo("front1", "front", "2026-10-04T07:00:00Z"),
  photo("front2", "front", "2026-10-04T07:05:00Z"),
];
const ESTIMATE: BodyFatEstimate = {
  id: "e1",
  taken_on: "2026-10-04",
  photo_ids: ["front2", "side1"],
  low_pct: 17,
  estimate_pct: 19,
  high_pct: 21,
  notes: "Visible upper abdominal outline.",
  created_at: "2026-10-04T08:00:00Z",
};

describe("BodyFatDay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    status.mockReturnValue({ data: { enabled: true, provider: "google" } });
    settings.mockReturnValue({ data: { enabled: true, acknowledged: ["body_fat"] } });
  });

  it("uses the latest photo of each pose, front first", () => {
    expect(photosForEstimate(PHOTOS).map((p) => p.id)).toEqual(["front2", "side1"]);
  });

  it("estimates on tap", async () => {
    render(<BodyFatDay photos={PHOTOS} estimate={undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Estimate body fat (AI)" }));
    expect(create).toHaveBeenCalledWith(["front2", "side1"], expect.anything());
  });

  it("asks before the first estimate", async () => {
    settings.mockReturnValue({ data: { enabled: true, acknowledged: [] } });
    render(<BodyFatDay photos={PHOTOS} estimate={undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Estimate body fat (AI)" }));
    expect(screen.getByRole("dialog", { name: "Before you use AI" })).toHaveTextContent(
      "these progress photos",
    );
    expect(create).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(create).toHaveBeenCalled();
  });

  it("shows an estimate as a rough range, with its reasons and a delete", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<BodyFatDay photos={PHOTOS} estimate={ESTIMATE} />);
    expect(screen.getByText(/AI estimate/)).toHaveTextContent("AI estimate: 17–21% (rough)");
    await userEvent.click(screen.getByText(/AI estimate/));
    expect(screen.getByText("Visible upper abdominal outline.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete AI estimate" }));
    expect(remove).toHaveBeenCalledWith("e1");
  });

  it("offers nothing without AI", () => {
    status.mockReturnValue({ data: { enabled: false } });
    const { container } = render(<BodyFatDay photos={PHOTOS} estimate={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
