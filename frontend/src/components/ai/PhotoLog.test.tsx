import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import type { FoodPhotoResult } from "../../lib/types";

const RESULT: FoodPhotoResult = {
  items: [
    {
      name: "Grilled chicken breast",
      grams: 150,
      nutrients: { energy_kcal: 248, protein_g: 46.5, carbs_g: 0, fat_g: 5.4 },
      confidence: "high",
      search_query: "chicken breast grilled",
    },
    {
      name: "White rice",
      grams: 180,
      nutrients: { energy_kcal: 234, protein_g: 4.9, carbs_g: 51, fat_g: 0.5 },
      confidence: "low",
      search_query: "white rice cooked",
    },
  ],
  notes: "The rice is partly hidden.",
  dropped: 0,
};

const { analyse, logBatch, saveSettings, settings } = vi.hoisted(() => ({
  analyse: vi.fn(),
  logBatch: vi.fn(),
  saveSettings: vi.fn(),
  settings: vi.fn(),
}));
vi.mock("../../lib/queries", () => ({
  useFoodPhoto: () => ({ mutateAsync: analyse, isPending: false }),
  useLogBatch: () => ({ mutateAsync: logBatch, isPending: false }),
  useAiSettings: () => settings(),
  useSaveAiSettings: () => ({ mutateAsync: saveSettings, isPending: false }),
  useAiStatus: () => ({ data: { provider: "anthropic" } }),
}));
vi.mock("../../lib/image", () => ({ resizeImage: async (f: Blob) => f }));
vi.mock("../nutrition/IngredientPicker", () => ({
  IngredientPicker: ({
    initialQuery,
    onPick,
  }: {
    initialQuery: string;
    onPick: (f: unknown) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onPick({
          id: "rice-db",
          name: "Rice, white, cooked",
          brand: null,
          nutrients_per_100g: { energy_kcal: 130, protein_g: 2.7, carbs_g: 28, fat_g: 0.3 },
        })
      }
    >
      pick for {initialQuery}
    </button>
  ),
}));

import { PhotoLog } from "./PhotoLog";
import { estimateName } from "./photoItems";

const photo = new File(["jpeg"], "plate.jpg", { type: "image/jpeg" });

function setup() {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  render(<PhotoLog day="2026-03-01" meal="lunch" onDone={onDone} onCancel={onCancel} />);
  return { onDone, onCancel };
}

async function analysed() {
  const s = setup();
  await userEvent.type(screen.getByRole("textbox"), "cooked in oil");
  await userEvent.upload(screen.getByLabelText("Choose from gallery"), photo);
  await screen.findByRole("list", { name: "Foods in the photo" });
  return s;
}

describe("PhotoLog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settings.mockReturnValue({ data: { enabled: true, acknowledged: ["food_photo"] } });
    analyse.mockResolvedValue(RESULT);
    logBatch.mockResolvedValue([]);
  });

  it("asks once before sending anything to the AI provider", async () => {
    settings.mockReturnValue({ data: { enabled: true, acknowledged: [] } });
    const { onCancel } = setup();
    const notice = screen.getByRole("dialog", { name: "Before you use AI" });
    expect(notice).toHaveTextContent("Anthropic (Claude)");
    expect(screen.queryByLabelText("Choose from gallery")).not.toBeInTheDocument();
    await userEvent.click(within(notice).getByRole("button", { name: "Continue" }));
    expect(saveSettings).toHaveBeenCalledWith({ enabled: true, acknowledged: ["food_photo"] });
    await userEvent.click(within(notice).getByRole("button", { name: "Not now" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("sends the photo and hint, then lists editable estimates", async () => {
    await analysed();
    expect(analyse).toHaveBeenCalledWith({ image: photo, hint: "cooked in oil" });
    expect(screen.getByText("The rice is partly hidden.")).toBeInTheDocument();
    expect(screen.getByText("Rough estimate")).toBeInTheDocument();
    expect(screen.getByText("Total 482 kcal · P 51 g")).toBeInTheDocument();

    const grams = screen.getByLabelText("Grams of White rice");
    await userEvent.clear(grams);
    await userEvent.type(grams, "90");
    expect(screen.getByText("Total 365 kcal · P 49 g")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Remove Grilled chicken breast" }));
    expect(screen.getByRole("button", { name: "Log 1 item" })).toBeInTheDocument();
  });

  it("logs estimates as quick adds and database swaps as foods", async () => {
    const { onDone } = await analysed();
    await userEvent.click(screen.getAllByRole("button", { name: "Find in database" })[1]);
    await userEvent.click(screen.getByRole("button", { name: "pick for white rice cooked" }));
    expect(screen.getByText("From the food database")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Log 2 items" }));

    const [entries] = logBatch.mock.calls[0];
    expect(entries[0]).toMatchObject({
      kind: "quick",
      name: "Grilled chicken breast (~150 g)",
      nutrients: { energy_kcal: 248, protein_g: 46.5, carbs_g: 0, fat_g: 5.4 },
      meal: "lunch",
      origin: "ai_photo",
    });
    expect(entries[1]).toMatchObject({
      kind: "food",
      food_id: "rice-db",
      grams: 180,
      meal: "lunch",
    });
    expect(entries[1].origin).toBeUndefined();
    expect(onDone).toHaveBeenCalled();
  });

  it("says when no food was recognised", async () => {
    analyse.mockResolvedValue({ items: [], notes: "No food is visible.", dropped: 0 });
    setup();
    await userEvent.upload(screen.getByLabelText("Choose from gallery"), photo);
    expect(await screen.findByText("Couldn't recognise food in this photo.")).toBeInTheDocument();
    expect(screen.getByText("No food is visible.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try another photo" }));
    expect(screen.getByLabelText("Choose from gallery")).toBeInTheDocument();
  });

  it("offers the camera and the photo library", () => {
    setup();
    expect(screen.getByLabelText("Take photo")).toHaveAttribute("capture", "environment");
    expect(screen.getByLabelText("Choose from gallery")).not.toHaveAttribute("capture");
  });

  it("explains the monthly limit", async () => {
    analyse.mockRejectedValue(
      new ApiError(429, "AI limit reached for this month", {}, "ai_limit", {
        resets_on: "2026-04-01",
      }),
    );
    setup();
    await userEvent.upload(screen.getByLabelText("Choose from gallery"), photo);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You've used this month's AI requests. They reset on 1 April.",
    );
  });

  it("keeps the estimated amount in long logged names", () => {
    expect(estimateName("x".repeat(250), 80).length).toBe(200);
    expect(estimateName("Rice", 179.6)).toBe("Rice (~180 g)");
  });
});
