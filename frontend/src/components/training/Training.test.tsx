import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Program, ProgramExercise, TodayWorkout } from "../../lib/types";
import { addSet, initialRows, toLogged } from "./workoutRows";

const ex = (id: string, extra: Partial<ProgramExercise> = {}): ProgramExercise => ({
  id,
  position: 0,
  name: id,
  kind: "reps",
  sets: 2,
  reps_low: 8,
  reps_high: 12,
  seconds: null,
  rest_seconds: 60,
  uses_weight: true,
  notes: "",
  alternatives: [],
  ...extra,
});
const SQUAT = ex("Goblet squat", { alternatives: ["Split squat"] });
const PLANK = ex("Plank", { kind: "time", sets: 1, reps_low: null, reps_high: null, seconds: 40, uses_weight: false });
const DAY = {
  id: "day-a",
  position: 0,
  name: "Full body A",
  focus: "Squat, push",
  location_id: "home",
  location_name: "Home",
  cardio: "10 min walk",
  exercises: [SQUAT, PLANK],
};
const TODAY: TodayWorkout = {
  day: DAY,
  week: 2,
  session: null,
  exercises: [
    {
      exercise: SQUAT,
      suggestion: { weight_kg: 13, reps: 8, seconds: null, note: "Hit the top of the range: add weight" },
      last: [{ exercise_id: "x", exercise_name: "Goblet squat", set_number: 1, weight_kg: 12, reps: 12, seconds: null }],
    },
    { exercise: PLANK, suggestion: { weight_kg: null, reps: null, seconds: 40, note: "" }, last: [] },
  ],
  sessions_done: 3,
};
const PROGRAM: Program = {
  id: "p1",
  name: "Full body, 3 days",
  summary: "Three sessions a week.",
  weeks: 6,
  daily_steps: 9000,
  started_on: "2026-03-01",
  days: [DAY],
  created_at: "2026-03-01T10:00:00Z",
};

const m = vi.hoisted(() => ({
  today: vi.fn(),
  start: vi.fn(),
  saveSets: vi.fn(),
  complete: vi.fn(),
  profile: vi.fn(),
  locations: vi.fn(),
  program: vi.fn(),
  generate: vi.fn(),
  swap: vi.fn(),
  move: vi.fn(),
  settings: vi.fn(),
  saveSettings: vi.fn(),
}));
const mutation = (fn: ReturnType<typeof vi.fn>) => ({ mutateAsync: fn, mutate: fn, isPending: false });
vi.mock("../../lib/queries", () => ({
  qk: { today: ["training-today"] },
  useTodayWorkout: () => ({ data: m.today(), isPending: false, isError: false }),
  useStartSession: () => mutation(m.start),
  useSaveSets: () => mutation(m.saveSets),
  useCompleteSession: () => mutation(m.complete),
  useTrainingProfile: () => ({ data: m.profile(), isPending: false, isError: false }),
  useLocations: () => ({ data: m.locations(), isPending: false, isError: false }),
  useProgram: () => ({ data: m.program(), isPending: false, isError: false }),
  useGenerateProgram: () => mutation(m.generate),
  useSwapExercise: () => mutation(m.swap),
  useMoveDay: () => mutation(m.move),
  useEndProgram: () => mutation(vi.fn()),
  useSessions: () => ({ data: [] }),
  useAiStatus: () => ({ data: { enabled: true, configured: true, provider: "google" } }),
  useAiSettings: () => ({ data: m.settings() }),
  useSaveAiSettings: () => mutation(m.saveSettings),
}));

import { Training } from "../../pages/Training";
import { WorkoutToday } from "../../pages/WorkoutToday";

function renderPage(page: ReactNode) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{page}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  m.today.mockReturnValue(TODAY);
  m.start.mockResolvedValue({ id: "s1" });
  m.saveSets.mockResolvedValue({});
  m.complete.mockImplementation(async () => ({
    sets: [
      { exercise_name: "Goblet squat", set_number: 1, weight_kg: 13, reps: 8, seconds: null },
      { exercise_name: "Plank", set_number: 1, weight_kg: null, reps: null, seconds: 40 },
    ],
  }));
  m.profile.mockReturnValue({ configured: true, experience: "some", limitations: "", days_per_week: 3, session_minutes: 45, cardio: "light" });
  m.locations.mockReturnValue([{ id: "home", name: "Home", equipment: ["dumbbells"], notes: "" }, { id: "gym", name: "Gym", equipment: [], notes: "" }]);
  m.program.mockReturnValue(PROGRAM);
  m.settings.mockReturnValue({ enabled: true, acknowledged: ["workout_plan"] });
});

describe("workout rows", () => {
  it("prefills targets, keeps logged sets and adds sets", () => {
    const rows = initialRows(TODAY);
    expect(rows.map((r) => [r.name, r.setNumber, r.weight, r.reps, r.seconds])).toEqual([
      ["Goblet squat", 1, "13", "8", ""],
      ["Goblet squat", 2, "13", "8", ""],
      ["Plank", 1, "", "", "40"],
    ]);
    const resumed = initialRows({
      ...TODAY,
      session: {
        id: "s1", program_day_id: "day-a", day_name: "A", performed_on: "2026-03-01", completed_at: null, notes: "",
        sets: [{ exercise_id: "Goblet squat", exercise_name: "Goblet squat", set_number: 3, weight_kg: 14, reps: 7, seconds: null }],
      },
    });
    expect(resumed.filter((r) => r.name === "Goblet squat").map((r) => [r.setNumber, r.done, r.weight])).toEqual([
      [1, false, "13"],
      [2, false, "13"],
      [3, true, "14"],
    ]);
    const more = addSet(rows, "Goblet squat");
    expect(more.map((r) => r.key)).toEqual(["Goblet squat-1", "Goblet squat-2", "Goblet squat-3", "Plank-1"]);
    expect(toLogged(rows)).toEqual([]);
    expect(toLogged([{ ...rows[0], done: true, weight: "12,5" }])).toEqual([
      { exercise_id: "Goblet squat", exercise_name: "Goblet squat", set_number: 1, weight_kg: 12.5, reps: 8, seconds: null },
    ]);
  });
});

describe("WorkoutToday", () => {
  it("starts, logs sets with a rest timer and finishes", async () => {
    renderPage(<WorkoutToday />);
    expect(screen.getByText("Week 2 · Home")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start workout" }));
    expect(m.start).toHaveBeenCalledWith("day-a");

    const squat = screen.getByRole("region", { name: "Goblet squat" });
    expect(squat).toHaveTextContent("Hit the top of the range: add weight. Last time: 12 kg × 12");
    await userEvent.click(within(squat).getByRole("button", { name: "Log Goblet squat set 1" }));
    expect(m.saveSets).toHaveBeenLastCalledWith(
      { id: "s1", notes: "", sets: [expect.objectContaining({ exercise_name: "Goblet squat", weight_kg: 13, reps: 8 })] },
      expect.anything(),
    );
    expect(screen.getByRole("timer", { name: "Rest" })).toHaveTextContent("1:00");
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();

    // editing a logged set saves it
    const reps = within(squat).getByRole("textbox", { name: "Goblet squat set 1 reps" });
    await userEvent.clear(reps);
    await userEvent.type(reps, "9");
    expect(m.saveSets.mock.lastCall![0].sets[0].reps).toBe(9);

    await userEvent.click(screen.getByRole("button", { name: "Log Plank set 1" }));
    expect(screen.getByText("Then cardio: 10 min walk")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Finish workout (2 sets)" }));
    expect(m.complete).toHaveBeenCalledWith("s1");
    expect(await screen.findByText("Workout done")).toBeInTheDocument();
    expect(screen.getByText("2 sets · 104 kg lifted")).toBeInTheDocument();
  });

  it("points to the program page when there's no program", () => {
    m.today.mockReturnValue(null);
    renderPage(<WorkoutToday />);
    expect(screen.getByRole("link", { name: "Build one" })).toHaveAttribute("href", "/training");
  });
});

describe("Training page", () => {
  it("asks for setup first", () => {
    m.profile.mockReturnValue({ configured: false });
    renderPage(<Training />);
    expect(screen.getByRole("button", { name: "Set up training" })).toBeInTheDocument();
  });

  it("builds a program from the chosen locations, after the privacy notice", async () => {
    m.program.mockReturnValue(null);
    m.settings.mockReturnValue({ enabled: true, acknowledged: [] });
    m.generate.mockResolvedValue(PROGRAM);
    renderPage(<Training />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Gym" }));
    await userEvent.click(screen.getByRole("button", { name: "Build my program" }));
    const notice = screen.getByRole("dialog", { name: "Before you use AI" });
    expect(notice).toHaveTextContent("the injuries you noted");
    await userEvent.click(within(notice).getByRole("button", { name: "Continue" }));
    expect(m.saveSettings).toHaveBeenCalled();
    expect(m.generate).toHaveBeenCalledWith(["home"]);
  });

  it("shows the program, moves a day and swaps an exercise", async () => {
    renderPage(<Training />);
    expect(screen.getByRole("heading", { name: "Full body, 3 days" })).toBeInTheDocument();
    expect(screen.getByText(/9,000 steps a day/)).toBeInTheDocument();
    const day = screen.getByRole("region", { name: "Full body A" });
    expect(day).toHaveTextContent("2 × 8–12");
    expect(day).toHaveTextContent("1 × 40 s");
    await userEvent.selectOptions(within(day).getByRole("combobox"), "gym");
    expect(m.move).toHaveBeenCalledWith({ dayId: "day-a", locationId: "gym" });
    await userEvent.click(within(day).getByRole("button", { name: "Swap Goblet squat" }));
    m.swap.mockResolvedValue(PROGRAM);
    await userEvent.click(within(day).getByRole("button", { name: "Swap to Split squat" }));
    expect(m.swap).toHaveBeenCalledWith({ exerciseId: "Goblet squat", name: "Split squat" });
    expect(screen.getByRole("link", { name: /Today's workout/ })).toHaveAttribute("href", "/training/today");
  });
});
