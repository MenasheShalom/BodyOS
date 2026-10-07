import type { Experience, CardioPref, ProgramExercise, TrainingLocationInput } from "../../lib/types";

export const EXPERIENCE: { key: Experience; label: string; body: string }[] = [
  { key: "new", label: "New", body: "Under 6 months of regular lifting" },
  { key: "some", label: "Some", body: "Lifted on and off, knows the main lifts" },
  { key: "experienced", label: "Experienced", body: "Years of consistent training" },
];

export const CARDIO: { key: CardioPref; label: string; body: string }[] = [
  { key: "none", label: "None", body: "Just a daily step target" },
  { key: "light", label: "Light", body: "Short easy cardio after some sessions" },
  { key: "moderate", label: "Moderate", body: "15–25 min of conditioning 2–3 days a week" },
];

export const PRESETS: TrainingLocationInput[] = [
  {
    name: "Gym",
    equipment: [
      "barbell",
      "squat_rack",
      "bench",
      "dumbbells",
      "kettlebells",
      "cable_machine",
      "machines",
      "pull_up_bar",
      "dip_bars",
      "cardio_machines",
    ],
    notes: "",
  },
  { name: "Home", equipment: ["dumbbells", "bands"], notes: "" },
  { name: "Outdoors", equipment: ["pull_up_bar", "dip_bars", "open_space"], notes: "" },
];

/** "3 × 8–12" or "2 × 40 s". */
export function target(ex: Pick<ProgramExercise, "kind" | "sets" | "reps_low" | "reps_high" | "seconds">) {
  if (ex.kind === "time") return `${ex.sets} × ${ex.seconds} s`;
  const reps = ex.reps_low === ex.reps_high ? `${ex.reps_low}` : `${ex.reps_low}–${ex.reps_high}`;
  return `${ex.sets} × ${reps}`;
}

export const howToUrl = (name: string) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name} exercise form`)}`;
