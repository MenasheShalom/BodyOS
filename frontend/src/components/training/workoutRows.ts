import type { LoggedSet, TodayWorkout } from "../../lib/types";

/** One set as it's being logged. Inputs are kept as typed; `done` marks it logged. */
export type SetRow = {
  key: string;
  exerciseId: string | null;
  name: string;
  setNumber: number;
  weight: string;
  reps: string;
  seconds: string;
  done: boolean;
};

const str = (n: number | null | undefined) => (n == null ? "" : String(n));

/** Rows for every planned set: what's already logged today, else the suggested targets. */
export function initialRows(today: TodayWorkout): SetRow[] {
  const logged = today.session?.sets ?? [];
  return today.exercises.flatMap(({ exercise, suggestion, last }) => {
    const mine = logged.filter((s) => s.exercise_name === exercise.name);
    const count = Math.max(exercise.sets, ...mine.map((s) => s.set_number));
    const lastWeight = last.find((s) => s.weight_kg != null)?.weight_kg ?? null;
    return Array.from({ length: count }, (_, i) => {
      const done = mine.find((s) => s.set_number === i + 1);
      return {
        key: `${exercise.id}-${i + 1}`,
        exerciseId: exercise.id,
        name: exercise.name,
        setNumber: i + 1,
        weight: str(done ? done.weight_kg : exercise.uses_weight ? (suggestion.weight_kg ?? lastWeight) : null),
        reps: str(done ? done.reps : suggestion.reps),
        seconds: str(done ? done.seconds : suggestion.seconds),
        done: !!done,
      };
    });
  });
}

const num = (raw: string): number | null => {
  const n = Number(raw.replace(",", "."));
  return raw.trim() === "" || !Number.isFinite(n) || n < 0 ? null : n;
};

/** The logged sets to save: only rows marked done. */
export function toLogged(rows: SetRow[]): LoggedSet[] {
  return rows
    .filter((r) => r.done)
    .map((r) => ({
      exercise_id: r.exerciseId,
      exercise_name: r.name,
      set_number: r.setNumber,
      weight_kg: num(r.weight),
      reps: num(r.reps) === null ? null : Math.round(num(r.reps)!),
      seconds: num(r.seconds) === null ? null : Math.round(num(r.seconds)!),
    }));
}

/** Another set after the last one of this exercise, copying its numbers. */
export function addSet(rows: SetRow[], exerciseId: string): SetRow[] {
  const mine = rows.filter((r) => r.exerciseId === exerciseId);
  const last = mine[mine.length - 1];
  if (!last || mine.length >= 20) return rows;
  const next: SetRow = {
    ...last,
    key: `${exerciseId}-${last.setNumber + 1}`,
    setNumber: last.setNumber + 1,
    done: false,
  };
  const at = rows.indexOf(last) + 1;
  return [...rows.slice(0, at), next, ...rows.slice(at)];
}

export function volume(sets: LoggedSet[]): number {
  return sets.reduce((sum, s) => sum + (s.weight_kg ?? 0) * (s.reps ?? 0), 0);
}
