import { useState } from "react";
import { TargetsForm } from "../../forms/TargetsForm";
import { ApiError } from "../../lib/api";
import { isoDay } from "../../lib/meals";
import { useDismissSuggestion, useSaveTargets } from "../../lib/queries";
import type { MacroTargets, Suggestion } from "../../lib/types";
import { Modal } from "../Modal";

const fmt = (n: number) => n.toLocaleString("en-GB");

function TargetLine({ t }: { t: MacroTargets }) {
  return (
    <span className="tabular">
      {fmt(t.energy_kcal)} kcal · P {t.protein_g} · C {t.carbs_g} · F {t.fat_g}
    </span>
  );
}

/** The weekly check-in: suggested targets from the adaptive TDEE, which only change on Accept. */
export function CheckInCard({ suggestion }: { suggestion: Suggestion }) {
  const save = useSaveTargets();
  const dismiss = useDismissSuggestion();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveTargets = async (targets: MacroTargets, origin: "suggested" | "manual") => {
    setError(null);
    try {
      await save.mutateAsync({
        ...targets,
        effective_from: isoDay(new Date()),
        origin,
        tdee_at_creation: suggestion.tdee,
      });
      setEditing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save. Try again.");
    }
  };

  const { tdee, confidence, targets, current } = suggestion;
  return (
    <section
      aria-label="Weekly check-in"
      className="space-y-3 rounded-2xl border border-accent/40 bg-surface p-4"
    >
      <div>
        <h2 className="font-medium">Weekly check-in</h2>
        <p className="mt-1 text-sm">
          Your burn is about <strong className="tabular">{fmt(tdee)} kcal</strong> a day
          {confidence != null && <span className="text-muted"> (±{confidence})</span>}.
        </p>
      </div>
      <dl className="space-y-1 text-sm">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted">Suggested</dt>
          <dd>
            <TargetLine t={targets} />
          </dd>
        </div>
        {current && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted">Now</dt>
            <dd className="text-muted">
              <TargetLine t={current} />
            </dd>
          </div>
        )}
      </dl>
      {suggestion.capped && (
        <p className="text-xs text-muted">
          Calories move at most 150 a week, so this is part of the way there.
        </p>
      )}
      {suggestion.warning && (
        <p role="note" className="rounded-xl bg-bad/10 px-3 py-2 text-xs">
          {suggestion.warning}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => void saveTargets(targets, "suggested")}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-bg disabled:opacity-60"
        >
          Accept
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-xl bg-surface-2 px-4 py-2 text-sm"
        >
          Edit
        </button>
        <button
          type="button"
          disabled={dismiss.isPending}
          onClick={() => dismiss.mutate()}
          className="px-2 py-2 text-sm text-muted"
        >
          Not this week
        </button>
      </div>
      {editing && (
        <Modal title="Edit targets" onClose={() => setEditing(false)}>
          <TargetsForm
            initial={targets}
            submitLabel="Save targets"
            onSubmit={(t) => saveTargets(t, "manual")}
          />
        </Modal>
      )}
    </section>
  );
}
