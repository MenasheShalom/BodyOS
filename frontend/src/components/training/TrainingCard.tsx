import { ChevronRight, Dumbbell } from "lucide-react";
import { Link } from "react-router";
import { useTodayWorkout } from "../../lib/queries";

/** Home: the next workout in the program, or nothing until there is a program. */
export function TrainingCard() {
  const today = useTodayWorkout();
  const t = today.data;
  if (!t) return null;
  const started = t.session !== null;
  return (
    <Link
      to="/training/today"
      className="flex items-center justify-between gap-3 rounded-2xl bg-surface p-4"
    >
      <span className="flex items-center gap-3">
        <Dumbbell size={20} className="text-accent" />
        <span>
          <span className="block font-medium">
            {started ? "Continue" : "Next workout"}: {t.day.name}
          </span>
          <span className="block text-sm text-muted">
            {t.exercises.length} exercises{t.day.location_name ? ` · ${t.day.location_name}` : ""}
          </span>
        </span>
      </span>
      <ChevronRight size={18} className="text-muted" />
    </Link>
  );
}
