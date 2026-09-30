import { useState } from "react";
import { Link } from "react-router";
import { ErrorState, Spinner } from "../components/EmptyState";
import { Field } from "../components/Field";
import { Modal } from "../components/Modal";
import { TargetsForm } from "../forms/TargetsForm";
import { ApiError } from "../lib/api";
import { formatDay } from "../lib/format";
import { isoDay } from "../lib/meals";
import { COUNTRIES, MODES, WEEKDAYS, settingsInput } from "../lib/nutritionSettings";
import {
  useNutritionSettings,
  useSaveNutritionSettings,
  useSaveTargets,
  useTargets,
} from "../lib/queries";
import type { FoodCountry, NutritionMode, NutritionSettings, Targets as T } from "../lib/types";

function TargetRow({ t }: { t: T }) {
  return (
    <p className="tabular text-sm">
      {t.energy_kcal.toLocaleString("en-GB")} kcal · P {t.protein_g} · C {t.carbs_g} · F {t.fat_g} ·
      Fibre {t.fiber_g}
    </p>
  );
}

function SettingsForm({ settings }: { settings: NutritionSettings }) {
  const save = useSaveNutritionSettings();
  const [mode, setMode] = useState<NutritionMode>(settings.mode);
  const [deficit, setDeficit] = useState(
    settings.deficit_pct == null ? "" : String(settings.deficit_pct),
  );
  const [protein, setProtein] = useState(String(settings.protein_g_per_kg));
  const [weekday, setWeekday] = useState(settings.check_in_weekday);
  const [country, setCountry] = useState<FoodCountry>(settings.food_country);
  const [message, setMessage] = useState<string | null>(null);
  const modeDefault = MODES.find((m) => m.key === mode)!.deficit;

  const submit = async () => {
    setMessage(null);
    const d = deficit.trim() === "" ? null : Number(deficit.replace(",", "."));
    const p = Number(protein.replace(",", "."));
    if (d != null && (Number.isNaN(d) || d < -10 || d > 25)) {
      return setMessage("Deficit must be between -10 and 25%.");
    }
    if (Number.isNaN(p) || p < 1.4 || p > 3) {
      return setMessage("Protein must be between 1.4 and 3.0 g per kg.");
    }
    try {
      await save.mutateAsync({
        ...settingsInput(settings),
        mode,
        deficit_pct: d,
        protein_g_per_kg: p,
        check_in_weekday: weekday,
        food_country: country,
      });
      setMessage("Saved.");
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Couldn't save. Try again.");
    }
  };

  const select = "w-full rounded-xl border border-border bg-surface px-3 py-2.5";
  return (
    <div className="space-y-3 rounded-2xl bg-surface p-4">
      <h2 className="font-medium">Settings</h2>
      <label className="block text-sm">
        <span className="mb-1 block text-muted">Goal</span>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as NutritionMode)}
          className={select}
        >
          {MODES.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Deficit"
          unit="%"
          inputMode="decimal"
          placeholder={String(modeDefault)}
          hint={`Blank uses the goal's default (${modeDefault}%)`}
          value={deficit}
          onChange={(e) => setDeficit(e.target.value)}
        />
        <Field
          label="Protein"
          unit="g/kg"
          inputMode="decimal"
          hint="Per kg of body weight"
          value={protein}
          onChange={(e) => setProtein(e.target.value)}
        />
      </div>
      <label className="block text-sm">
        <span className="mb-1 block text-muted">Weekly check-in day</span>
        <select
          value={weekday}
          onChange={(e) => setWeekday(Number(e.target.value))}
          className={select}
        >
          {WEEKDAYS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-muted">
          Weekly target check-ins arrive in a later update.
        </span>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-muted">Rank foods sold in</span>
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value as FoodCountry)}
          className={select}
        >
          {COUNTRIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      {message && (
        <p role="status" className="text-sm text-muted">
          {message}
        </p>
      )}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={save.isPending}
        className="w-full rounded-xl bg-accent py-2.5 font-medium text-bg disabled:opacity-60"
      >
        Save settings
      </button>
    </div>
  );
}

export function Targets() {
  const settings = useNutritionSettings();
  const targets = useTargets();
  const saveTargets = useSaveTargets();
  const [editing, setEditing] = useState(false);
  const today = isoDay(new Date());

  if (settings.isPending || targets.isPending) return <Spinner />;
  if (settings.isError) return <ErrorState message={settings.error.message} />;
  if (targets.isError) return <ErrorState message={targets.error.message} />;

  if (!settings.data.configured) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Targets</h1>
        <Link to="/nutrition/setup" className="block rounded-2xl bg-accent p-4 font-medium text-bg">
          Set up nutrition targets
        </Link>
      </section>
    );
  }

  const current = targets.data.find((t) => t.effective_from <= today) ?? null;
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Targets</h1>
      <div className="space-y-2 rounded-2xl bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Current</h2>
          <button type="button" onClick={() => setEditing(true)} className="text-sm text-accent">
            Edit
          </button>
        </div>
        {current ? (
          <>
            <TargetRow t={current} />
            <p className="text-xs text-muted">
              Since {formatDay(current.effective_from)}
              {current.origin === "suggested" ? ", as suggested" : ", set by you"}
              {current.tdee_at_creation
                ? ` (estimated burn ${current.tdee_at_creation.toLocaleString("en-GB")} kcal)`
                : ""}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">No targets yet.</p>
        )}
      </div>

      {targets.data.length > 1 && (
        <div className="rounded-2xl bg-surface p-4">
          <h2 className="mb-2 font-medium">History</h2>
          <ul className="space-y-2">
            {targets.data.map((t) => (
              <li key={t.effective_from}>
                <p className="text-xs text-muted">From {formatDay(t.effective_from)}</p>
                <TargetRow t={t} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <SettingsForm settings={settings.data} />

      {editing && (
        <Modal title="Edit targets" onClose={() => setEditing(false)}>
          <TargetsForm
            initial={
              current ?? { energy_kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 65, fiber_g: 30 }
            }
            submitLabel="Save targets"
            onSubmit={async (values) => {
              await saveTargets.mutateAsync({ ...values, effective_from: today, origin: "manual" });
              setEditing(false);
            }}
          />
        </Modal>
      )}
    </section>
  );
}
