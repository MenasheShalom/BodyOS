import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Spinner } from "../components/EmptyState";
import { CARDIO, EXPERIENCE, PRESETS } from "../components/training/trainingMeta";
import { ApiError } from "../lib/api";
import {
  useDeleteLocation,
  useEquipment,
  useLocations,
  useSaveLocation,
  useSaveTrainingProfile,
  useTrainingProfile,
} from "../lib/queries";
import type { TrainingLocation, TrainingLocationInput, TrainingProfileInput } from "../lib/types";

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : "Couldn't save. Try again.");

function LocationEditor({
  initial,
  onDone,
}: {
  initial: TrainingLocationInput & { id?: string };
  onDone: () => void;
}) {
  const equipment = useEquipment();
  const save = useSaveLocation();
  const remove = useDeleteLocation();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const toggle = (key: string) =>
    setValue((v) => ({
      ...v,
      equipment: v.equipment.includes(key)
        ? v.equipment.filter((e) => e !== key)
        : [...v.equipment, key],
    }));

  return (
    <div className="space-y-3 rounded-2xl bg-surface p-4">
      <label className="block text-sm">
        <span className="text-muted">Name</span>
        <input
          value={value.name}
          maxLength={40}
          onChange={(e) => setValue({ ...value, name: e.target.value })}
          className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5"
        />
      </label>
      <fieldset>
        <legend className="mb-1 text-sm text-muted">Equipment (bodyweight is always there)</legend>
        <div className="flex flex-wrap gap-2">
          {equipment.data?.map((e) => (
            <label
              key={e.key}
              className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/10"
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={value.equipment.includes(e.key)}
                onChange={() => toggle(e.key)}
              />
              {e.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block text-sm">
        <span className="text-muted">Notes (optional)</span>
        <input
          dir="auto"
          value={value.notes}
          maxLength={300}
          placeholder="e.g. dumbbells up to 20 kg, low ceiling"
          onChange={(e) => setValue({ ...value, notes: e.target.value })}
          className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={save.isPending || !value.name.trim()}
          onClick={() =>
            void save
              .mutateAsync({ id: initial.id, body: value })
              .then(onDone, (e: unknown) => setError(errorText(e)))
          }
          className="flex-1 rounded-xl bg-accent py-2.5 font-medium text-bg disabled:opacity-60"
        >
          Save location
        </button>
        {initial.id && (
          <button
            type="button"
            aria-label={`Delete ${initial.name}`}
            onClick={() => void remove.mutateAsync(initial.id!).then(onDone)}
            className="rounded-xl bg-surface-2 px-3 text-bad"
          >
            <Trash2 size={18} />
          </button>
        )}
        <button type="button" onClick={onDone} className="rounded-xl bg-surface-2 px-4">
          Cancel
        </button>
      </div>
    </div>
  );
}

function Locations() {
  const locations = useLocations();
  const equipment = useEquipment();
  const [editing, setEditing] = useState<(TrainingLocationInput & { id?: string }) | null>(null);
  const labels = Object.fromEntries((equipment.data ?? []).map((e) => [e.key, e.label]));
  const list: TrainingLocation[] = locations.data ?? [];
  const unused = PRESETS.filter((p) => !list.some((l) => l.name === p.name));

  return (
    <section aria-label="Where you train" className="space-y-3">
      <h2 className="text-lg font-semibold">Where you train</h2>
      {list.map((l) =>
        editing?.id === l.id ? (
          <LocationEditor key={l.id} initial={l} onDone={() => setEditing(null)} />
        ) : (
          <button
            key={l.id}
            type="button"
            onClick={() => setEditing(l)}
            className="block w-full rounded-2xl bg-surface p-4 text-left"
          >
            <span className="block font-medium">{l.name}</span>
            <span className="block text-sm text-muted">
              {l.equipment.length
                ? l.equipment.map((k) => labels[k] ?? k).join(", ")
                : "Bodyweight only"}
            </span>
            {l.notes && <span className="block text-xs text-muted">{l.notes}</span>}
          </button>
        ),
      )}
      {editing && !editing.id && <LocationEditor initial={editing} onDone={() => setEditing(null)} />}
      {!editing && (
        <div className="flex flex-wrap gap-2">
          {unused.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => setEditing(p)}
              className="flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1.5 text-sm"
            >
              <Plus size={14} /> {p.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setEditing({ name: "", equipment: [], notes: "" })}
            className="flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1.5 text-sm"
          >
            <Plus size={14} /> Other place
          </button>
        </div>
      )}
    </section>
  );
}

function ProfileForm({ initial, onSaved }: { initial: TrainingProfileInput; onSaved: () => void }) {
  const save = useSaveTrainingProfile();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const choice = <K extends keyof TrainingProfileInput>(key: K, v: TrainingProfileInput[K]) =>
    setValue((p) => ({ ...p, [key]: v }));

  return (
    <section aria-label="About your training" className="space-y-4">
      <h2 className="text-lg font-semibold">About your training</h2>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm text-muted">Experience</legend>
        {EXPERIENCE.map((o) => (
          <label
            key={o.key}
            className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2 has-[:checked]:border-accent"
          >
            <input
              type="radio"
              name="experience"
              checked={value.experience === o.key}
              onChange={() => choice("experience", o.key)}
            />
            <span>
              <span className="block">{o.label}</span>
              <span className="block text-xs text-muted">{o.body}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="text-muted">Days per week</span>
          <select
            value={value.days_per_week}
            onChange={(e) => choice("days_per_week", Number(e.target.value))}
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5"
          >
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">Minutes per session</span>
          <select
            value={value.session_minutes}
            onChange={(e) => choice("session_minutes", Number(e.target.value))}
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5"
          >
            {[30, 45, 60, 75, 90].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="space-y-1">
        <legend className="mb-1 text-sm text-muted">Cardio</legend>
        <div className="flex gap-2">
          {CARDIO.map((o) => (
            <label
              key={o.key}
              title={o.body}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-2 py-2 text-sm has-[:checked]:border-accent"
            >
              <input
                type="radio"
                name="cardio"
                className="sr-only"
                checked={value.cardio === o.key}
                onChange={() => choice("cardio", o.key)}
              />
              {o.label}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted">{CARDIO.find((o) => o.key === value.cardio)?.body}</p>
      </fieldset>
      <label className="block text-sm">
        <span className="text-muted">Injuries or limits (optional)</span>
        <textarea
          dir="auto"
          rows={2}
          maxLength={500}
          value={value.limitations}
          placeholder="e.g. bad left knee, no overhead pressing"
          onChange={(e) => choice("limitations", e.target.value)}
          className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={save.isPending}
        onClick={() =>
          void save.mutateAsync(value).then(onSaved, (e: unknown) => setError(errorText(e)))
        }
        className="w-full rounded-xl bg-accent py-2.5 font-medium text-bg disabled:opacity-60"
      >
        Save and continue
      </button>
    </section>
  );
}

/** /training/setup: the training profile and the places the user trains. */
export function TrainingSetup() {
  const navigate = useNavigate();
  const profile = useTrainingProfile();
  if (profile.isPending) return <Spinner />;
  const { configured: _, ...initial } = profile.data ?? {
    configured: false,
    experience: "some" as const,
    limitations: "",
    days_per_week: 3,
    session_minutes: 60,
    cardio: "light" as const,
  };
  return (
    <section className="space-y-8">
      <h1 className="text-2xl font-semibold">Training setup</h1>
      <Locations />
      <ProfileForm initial={initial} onSaved={() => void navigate("/training")} />
    </section>
  );
}
