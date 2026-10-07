import { Dumbbell, ExternalLink, Footprints, RefreshCw, Repeat } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { aiErrorMessage } from "../components/ai/aiErrors";
import { PrivacyNotice } from "../components/ai/PrivacyNotice";
import { usePrivacyGate } from "../components/ai/privacy";
import { ErrorState, Spinner } from "../components/EmptyState";
import { howToUrl, target } from "../components/training/trainingMeta";
import {
  useAiStatus,
  useEndProgram,
  useGenerateProgram,
  useLocations,
  useMoveDay,
  useProgram,
  useSessions,
  useSwapExercise,
  useTrainingProfile,
} from "../lib/queries";
import type { Program, ProgramDay, ProgramExercise, TrainingLocation } from "../lib/types";

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const shortDate = (day: string) => dateFmt.format(new Date(`${day}T00:00:00`));

function BuildProgram({ locations, rebuild }: { locations: TrainingLocation[]; rebuild: boolean }) {
  const gate = usePrivacyGate("workout_plan");
  const status = useAiStatus();
  const generate = useGenerateProgram();
  const [chosen, setChosen] = useState<string[]>(locations.map((l) => l.id));
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const build = async () => {
    setError(null);
    try {
      await generate.mutateAsync(locations.filter((l) => chosen.includes(l.id)).map((l) => l.id));
    } catch (e) {
      setError(aiErrorMessage(e, "text"));
    }
  };

  if (status.data && !status.data.enabled) {
    return (
      <p className="rounded-2xl bg-surface p-4 text-sm">
        Programs are built with AI, which is switched off.{" "}
        {status.data.configured && (
          <Link to="/settings" className="text-accent">
            Turn it on in Settings
          </Link>
        )}
      </p>
    );
  }
  if (generate.isPending) {
    return (
      <p role="status" className="rounded-2xl bg-surface p-6 text-center text-sm text-muted">
        Building your program from your body data, goals and equipment… This can take up to a
        minute.
      </p>
    );
  }
  return (
    <section aria-label="Build a program" className="space-y-3 rounded-2xl bg-surface p-4">
      <h2 className="font-medium">{rebuild ? "Build a new program" : "Build my program"}</h2>
      <fieldset>
        <legend className="mb-1 text-sm text-muted">Train at</legend>
        <div className="flex flex-wrap gap-2">
          {locations.map((l) => (
            <label
              key={l.id}
              className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/10"
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={chosen.includes(l.id)}
                onChange={() =>
                  setChosen((c) => (c.includes(l.id) ? c.filter((x) => x !== l.id) : [...c, l.id]))
                }
              />
              {l.name}
            </label>
          ))}
        </div>
      </fieldset>
      {rebuild && (
        <p className="text-xs text-muted">
          The current program is replaced. Your logged workouts stay, and progression carries over
          for exercises with the same name.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={chosen.length === 0 || !gate.ready || gate.saving}
        onClick={() => (gate.needed ? setAsking(true) : void build())}
        className="w-full rounded-xl bg-accent py-2.5 font-medium text-bg disabled:opacity-60"
      >
        {rebuild ? "Build new program" : "Build my program"}
      </button>
      {asking && (
        <PrivacyNotice
          what="your profile, body trends, nutrition phase, goals, training setup and the injuries you noted"
          detail="The program is a suggestion: check the exercises suit you, and stop anything that hurts."
          onContinue={async () => {
            await gate.accept();
            setAsking(false);
            await build();
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </section>
  );
}

function ExerciseRow({ ex }: { ex: ProgramExercise }) {
  const swap = useSwapExercise();
  const [open, setOpen] = useState(false);
  return (
    <li className="py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p>{ex.name}</p>
          <p className="tabular text-xs text-muted">
            {target(ex)} · rest {ex.rest_seconds} s{ex.uses_weight ? "" : " · bodyweight"}
            {ex.notes ? ` · ${ex.notes}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <a
            href={howToUrl(ex.name)}
            target="_blank"
            rel="noreferrer"
            aria-label={`How to do ${ex.name}`}
            className="rounded-full p-1.5 text-muted"
          >
            <ExternalLink size={16} />
          </a>
          {ex.alternatives.length > 0 && (
            <button
              type="button"
              aria-label={`Swap ${ex.name}`}
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className="rounded-full p-1.5 text-muted"
            >
              <Repeat size={16} />
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap gap-2">
          {ex.alternatives.map((alt) => (
            <button
              key={alt}
              type="button"
              disabled={swap.isPending}
              onClick={() =>
                void swap.mutateAsync({ exerciseId: ex.id, name: alt }).then(() => setOpen(false))
              }
              className="rounded-full bg-surface-2 px-3 py-1 text-sm"
            >
              Swap to {alt}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

function DayCard({ day, locations }: { day: ProgramDay; locations: TrainingLocation[] }) {
  const move = useMoveDay();
  return (
    <section aria-label={day.name} className="rounded-2xl bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">{day.name}</h3>
          {day.focus && <p className="text-sm text-muted">{day.focus}</p>}
        </div>
        <select
          aria-label={`Where to train ${day.name}`}
          value={day.location_id ?? ""}
          onChange={(e) =>
            move.mutate({ dayId: day.id, locationId: e.target.value || null })
          }
          className="rounded-lg border border-border bg-surface px-2 py-1 text-sm"
        >
          {!day.location_id && <option value="">No location</option>}
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <ul className="mt-2 divide-y divide-border">
        {day.exercises.map((ex) => (
          <ExerciseRow key={ex.id} ex={ex} />
        ))}
      </ul>
      {day.cardio && <p className="mt-2 text-sm">Cardio: {day.cardio}</p>}
    </section>
  );
}

function RecentSessions() {
  const sessions = useSessions(5);
  if (!sessions.data?.length) return null;
  return (
    <section aria-label="Recent workouts">
      <h2 className="mb-2 font-medium">Recent workouts</h2>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-surface">
        {sessions.data.map((s) => (
          <li key={s.id} className="flex justify-between px-4 py-2.5 text-sm">
            <span>
              {s.day_name} <span className="text-muted">· {shortDate(s.performed_on)}</span>
            </span>
            <span className="tabular text-muted">
              {s.sets_done} sets
              {s.volume_kg > 0 ? ` · ${Math.round(s.volume_kg).toLocaleString("en-GB")} kg` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProgramView({ program, locations }: { program: Program; locations: TrainingLocation[] }) {
  const end = useEndProgram();
  const [rebuilding, setRebuilding] = useState(false);
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted">
          {program.weeks} weeks from {shortDate(program.started_on)} · {program.days.length} days a
          week
        </p>
        <h2 className="readout text-xl">{program.name}</h2>
        <p className="mt-1 text-sm text-muted">{program.summary}</p>
      </div>
      <Link
        to="/training/today"
        className="flex items-center justify-center gap-2 rounded-2xl bg-accent py-3 font-medium text-bg"
      >
        <Dumbbell size={20} /> Today's workout
      </Link>
      {program.daily_steps ? (
        <p className="flex items-center gap-2 rounded-2xl bg-surface px-4 py-3 text-sm">
          <Footprints size={18} className="text-accent" /> Aim for{" "}
          {program.daily_steps.toLocaleString("en-GB")} steps a day
        </p>
      ) : null}
      {program.days.map((d) => (
        <DayCard key={d.id} day={d} locations={locations} />
      ))}
      <RecentSessions />
      {rebuilding ? (
        <BuildProgram locations={locations} rebuild />
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setRebuilding(true)}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-surface-2 py-2.5 text-sm"
          >
            <RefreshCw size={16} /> New program
          </button>
          <Link
            to="/training/setup"
            className="flex flex-1 items-center justify-center rounded-xl bg-surface-2 py-2.5 text-sm"
          >
            Edit setup
          </Link>
        </div>
      )}
      <button
        type="button"
        onClick={() => end.mutate()}
        className="w-full py-2 text-sm text-muted"
      >
        End this program
      </button>
    </div>
  );
}

/** /training: set up, build a program with AI, and see it. */
export function Training() {
  const navigate = useNavigate();
  const profile = useTrainingProfile();
  const locations = useLocations();
  const program = useProgram();

  if (profile.isPending || locations.isPending || program.isPending) return <Spinner />;
  if (profile.isError || locations.isError || program.isError) {
    return <ErrorState message="Couldn't load your training. Try again." />;
  }
  const ready = profile.data.configured && locations.data.length > 0;

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Training</h1>
      {!ready ? (
        <div className="space-y-3 rounded-2xl bg-surface p-4">
          <p>
            Get a training program built around your body, your goals and the equipment you
            have.
          </p>
          <p className="text-sm text-muted">
            First, tell BodyOS where you train and how much time you have.
          </p>
          <button
            type="button"
            onClick={() => void navigate("/training/setup")}
            className="w-full rounded-xl bg-accent py-2.5 font-medium text-bg"
          >
            Set up training
          </button>
        </div>
      ) : program.data ? (
        <ProgramView program={program.data} locations={locations.data} />
      ) : (
        <>
          <BuildProgram locations={locations.data} rebuild={false} />
          <Link to="/training/setup" className="block text-center text-sm text-accent">
            Edit setup
          </Link>
        </>
      )}
    </section>
  );
}
