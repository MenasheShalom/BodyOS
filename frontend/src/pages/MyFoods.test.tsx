import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

const remove = vi.fn();
vi.mock("../lib/queries", () => ({
  useMyFoods: () => ({
    isPending: false,
    isError: false,
    data: [
      {
        id: "f1",
        name: "Protein shake",
        brand: null,
        nutrients_per_100g: { energy_kcal: 400 },
        is_liquid: false,
      },
    ],
  }),
  useDeleteCustomFood: () => ({ mutate: remove }),
}));

import { MyFoods } from "./MyFoods";

describe("MyFoods", () => {
  it("lists foods and confirms before deleting", async () => {
    render(
      <MemoryRouter>
        <MyFoods />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /Protein shake/ })).toHaveAttribute(
      "href",
      "/nutrition/foods/f1",
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete Protein shake" }));
    expect(screen.getByText(/Past days keep this food/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(remove).toHaveBeenCalledWith("f1", expect.anything());
  });
});
