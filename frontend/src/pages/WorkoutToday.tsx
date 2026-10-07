import { useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Plus, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ErrorState, Spinner } from "../components/EmptyState";
import { howToUrl, target } from "../components/training/trainingMeta";
import {
  addSet,
  initialRows,
  type SetRow,
  toLogged,
  volume,
} from "../components/training/workoutRows";
import { ApiError } from "../lib/api";
import {
  qk,
  useCompleteSession,
  useSaveSets,
  useStartSession,
  useTodayWorkout,
} from "../lib/queries";
import type { LoggedSet, TodayWorkout } from "../lib/types";

const fmtSet = (s: LoggedSet) =>
  s.seconds != null
    ? `${s.seconds} s`
    : `${s.weight_kg != null ? `${s.weight_kg} kg × ` : ""}${s.reps ?? 0}`;

function RestTimer({ until, onDone }: { until: number; onDone: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  useEffect(() => {
    if (left === 0) onDone();
  }, [left, onDone]);
  return (
    <div
      role="timer"
      aria-label="Rest"
      className="fixed inset-x-4 bottom-24 z-30 mx-auto flex max-w-md items-center justify-between rounded-2xl bg-text px-4 py-3 text-bg shadow-lg md:bottom-6"
    >
      <span className="flex items-center gap-2">
        <Timer size={18} /> Rest{" "}
        <span className="readout tabular text-lg">
          {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
        </span>
      </span>
      <button type="button" onClick={onDone} className="text-sm underline">
        Skip
      </button>
    </div>
  );
}

function Logger({ today, sessionId }: { today: TodayWorkout; sessionId: string }) {
  const qc = useQueryClient();
  const save = useSaveSets();
  const complete = useCompleteSession();
  const [rows, setRows] = useState<SetRow[]>(() => initialRows(today));
  const [notes, setNotes] = useState(today.session?.notes ?? "");
  const [rest, setRest] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState<LoggedSet[] | null>(null);

  const persist = (next: SetRow[], nextNotes = notes) => {
    setRows(next);
    setError(null);
    save.mutate(
      { id: sessionId, sets: toLogged(next), notes: nextNotes },
      { onError: (e) => setError(e instanceof ApiError ? e.message : "Couldn't save the set.") },
    );
  };
  const edit = (key: string, change: Partial<SetRow>) => {
    const next = rows.map((r) => (r.key === key ? { ...r, ...change } : r));
    // edits to a logged set are saved straight away; others wait for the tick
    if (rows.find((r) => r.key === key)?.done) persist(next);
    else setRows(next);
  };

  if (finished) {
    const kg = volume(finished);
    return (
      <div className="space-y-4 rounded-2xl bg-surface p-6 text-center">
        <p className="readout text-2xl">Workout done</p>
        <p className="text-muted">
          {finished.length} sets{kg > 0 ? ` · ${Math.round(kg).toLocaleString("en-GB")} kg lifted` : ""}
        </p>
        <Link to="/training" className="block rounded-xl bg-accent py-2.5 font-medium text-bg">
          Back to training
        </Link>
      </div>
    );
  }

  const logged = rows.filter((r) => r.done).length;
  return (
    <div className="space-y-4">
      {today.exercises.map(({ exercise: ex, suggestion, last }) => {
        const mine = rows.filter((r) => r.exerciseId === ex.id);
        return (
          <section key={ex.id} aria-label={ex.name} className="space-y-2 rounded-2xl bg-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-medium">{ex.name}</h2>
                <p className="tabular text-xs text-muted">
                  {target(ex)} · rest {ex.rest_seconds} s{ex.notes ? ` · ${ex.notes}` : ""}
                </p>
              </div>
              <a
                href={howToUrl(ex.name)}
                target="_blank"
                rel="noreferrer"
                aria-label={`How to do ${ex.name}`}
                className="rounded-full p-1.5 text-muted"
              >
                <ExternalLink size={16} />
              </a>
            </div>
            {(suggestion.note || last.length > 0) && (
              <p className="text-xs">
                {suggestion.note && <span className="text-accent">{suggestion.note}. </span>}
                {last.length > 0 && (
                  <span className="text-muted">Last time: {last.map(fmtSet).join(", ")}</span>
                )}
              </p>
            )}
            <ul className="space-y-1.5">
              {mine.map((r) => (
                <li key={r.key} className="flex items-center gap-2">
                  <span className="tabular w-6 text-sm text-muted">{r.setNumber}</span>
                  {ex.kind === "time" ? (
                    <label className="flex flex-1 items-center gap-1 text-sm">
                      <input
                        inputMode="numeric"
                        aria-label={`${ex.name} set ${r.setNumber} seconds`}
                        value={r.seconds}
                        onChange={(e) => edit(r.key, { seconds: e.target.value })}
                        className="tabular w-20 rounded-lg border border-border bg-bg px-2 py-1.5"
                      />
                      s
                    </label>
                  ) : (
                    <>
                      {ex.uses_weight && (
                        <label className="flex items-center gap-1 text-sm">
                          <input
                            inputMode="decimal"
                            aria-label={`${ex.name} set ${r.setNumber} weight`}
                            value={r.weight}
                            placeholder="kg"
                            onChange={(e) => edit(r.key, { weight: e.target.value })}
                            className="tabular w-20 rounded-lg border border-border bg-bg px-2 py-1.5"
                          />
                          kg
                        </label>
                      )}
                      <label className="flex flex-1 items-center gap-1 text-sm">
                        <input
                          inputMode="numeric"
                          aria-label={`${ex.name} set ${r.setNumber} reps`}
                          value={r.reps}
                          onChange={(e) => edit(r.key, { reps: e.target.value })}
                          className="tabular w-16 rounded-lg border border-border bg-bg px-2 py-1.5"
                        />
                        reps
                      </label>
                    </>
                  )}
                  <button
                    type="button"
                    aria-label={`${r.done ? "Undo" : "Log"} ${ex.name} set ${r.setNumber}`}
                    aria-pressed={r.done}
                    onClick={() => {
                      const next = rows.map((x) => (x.key === r.key ? { ...x, done: !x.done } : x));
                      persist(next);
                      setRest(r.done ? null : Date.now() + ex.rest_seconds * 1000);
                    }}
                    className={`flex h-9 w-9 items-center justify-center rounded-full ${
                      r.done ? "bg-good text-bg" : "bg-surface-2 text-muted"
                    }`}
                  >
                    <Check size={18} />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setRows(addSet(rows, ex.id))}
              className="flex items-center gap-1 text-xs text-accent"
            >
              <Plus size={14} /> Add a set
            </button>
          </section>
        );
      })}
      {today.day.cardio && (
        <p className="rounded-2xl bg-surface p-4 text-sm">Then cardio: {today.day.cardio}</p>
      )}
      <label className="block text-sm">
        <span className="text-muted">Notes</span>
        <textarea
          dir="auto"
          rows={2}
          maxLength={500}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => persist(rows, notes)}
          className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={logged === 0 || complete.isPending || save.isPending}
        onClick={() =>
          void save
            .mutateAsync({ id: sessionId, sets: toLogged(rows), notes })
            .then(() => complete.mutateAsync(sessionId))
            .then((s) => {
              setFinished(s.sets);
              void qc.invalidateQueries({ queryKey: qk.today });
            })
            .catch((e: unknown) =>
              setError(e instanceof ApiError ? e.message : "Couldn't finish. Try again."),
            )
        }
        className="w-full rounded-xl bg-accent py-3 font-medium text-bg disabled:opacity-60"
      >
        Finish workout ({logged} {logged === 1 ? "set" : "sets"})
      </button>
      {rest !== null && <RestTimer until={rest} onDone={() => setRest(null)} />}
    </div>
  );
}

/** /training/today: the next workout in the program, logged set by set. */
export function WorkoutToday() {
  const today = useTodayWorkout();
  const start = useStartSession();
  const [sessionId, setSessionId] = useState<string | null>(null);

  if (today.isPending) return <Spinner />;
  if (today.isError) return <ErrorState message={today.error.message} />;
  const t = today.data;
  if (!t) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Today's workout</h1>
        <p className="rounded-2xl bg-surface p-4 text-sm">
          No program yet.{" "}
          <Link to="/training" className="text-accent">
            Build one
          </Link>
        </p>
      </section>
    );
  }
  const id = sessionId ?? t.session?.id ?? null;

  return (
    <section className="space-y-4">
      <div>
        <p className="text-sm text-muted">
          Week {t.week} · {t.day.location_name ?? "Anywhere"}
        </p>
        <h1 className="text-2xl font-semibold">{t.day.name}</h1>
        {t.day.focus && <p className="text-sm text-muted">{t.day.focus}</p>}
      </div>
      {id ? (
        <Logger key={id} today={t} sessionId={id} />
      ) : (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-surface">
            {t.exercises.map(({ exercise: ex }) => (
              <li key={ex.id} className="flex justify-between gap-3 px-4 py-2.5">
                <span>{ex.name}</span>
                <span className="tabular shrink-0 text-sm text-muted">{target(ex)}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={start.isPending}
            onClick={() =>
              void start.mutateAsync(t.day.id).then((s) => setSessionId(s.id))
            }
            className="w-full rounded-xl bg-accent py-3 font-medium text-bg disabled:opacity-60"
          >
            Start workout
          </button>
          <Link to="/training" className="block text-center text-sm text-accent">
            See the whole program
          </Link>
        </>
      )}
    </section>
  );
}
