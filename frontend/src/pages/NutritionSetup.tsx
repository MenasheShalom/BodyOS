import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ErrorState, Spinner } from "../components/EmptyState";
import { TargetsForm } from "../forms/TargetsForm";
import { ApiError } from "../lib/api";
import { isoDay } from "../lib/meals";
import { ACTIVITY, MODES, settingsInput } from "../lib/nutritionSettings";
import {
  useEstimate,
  useNutritionSettings,
  useSaveNutritionSettings,
  useSaveTargets,
} from "../lib/queries";
import type { ActivityLevel, MacroTargets, NutritionMode } from "../lib/types";

const same = (a: MacroTargets, b: MacroTargets) =>
  (Object.keys(a) as (keyof MacroTargets)[]).every((k) => a[k] === b[k]);

export function NutritionSetup() {
  const settings = useNutritionSettings();
  const saveSettings = useSaveNutritionSettings();
  const saveTargets = useSaveTargets();
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<NutritionMode | null>(null);
  const [activity, setActivity] = useState<ActivityLevel | null>(null);

  const current = settings.data;
  const chosenMode = mode ?? current?.mode ?? "recomp";
  const chosenActivity = activity ?? current?.activity_level ?? "light";
  const estimate = useEstimate(
    {
      mode: chosenMode,
      activity_level: chosenActivity,
      deficit_pct: current?.deficit_pct ?? null,
      protein_g_per_kg: current?.protein_g_per_kg ?? 2,
    },
    step === 2,
  );

  if (settings.isPending) return <Spinner />;
  if (settings.isError) return <ErrorState message={settings.error.message} />;

  if (step === 1) {
    return (
      <section className="space-y-5">
        <h1 className="text-2xl font-semibold">Nutrition setup</h1>
        <fieldset className="space-y-2">
          <legend className="mb-2 font-medium">What's your goal?</legend>
          {MODES.map((m) => (
            <label
              key={m.key}
              className={`flex cursor-pointer gap-3 rounded-2xl border p-3 ${
                chosenMode === m.key ? "border-accent bg-surface" : "border-border"
              }`}
            >
              <input
                type="radio"
                name="mode"
                checked={chosenMode === m.key}
                onChange={() => setMode(m.key)}
              />
              <span>
                <span className="block">{m.label}</span>
                <span className="block text-sm text-muted">{m.body}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="block">
          <span className="mb-1 block font-medium">How active are you?</span>
          <select
            value={chosenActivity}
            onChange={(e) => setActivity(e.target.value as ActivityLevel)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2.5"
          >
            {ACTIVITY.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}: {a.body}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setStep(2)}
          className="w-full rounded-xl bg-accent py-2.5 font-medium text-bg"
        >
          Next
        </button>
      </section>
    );
  }

  const est = estimate.data;
  const needsData =
    estimate.error instanceof ApiError && estimate.error.status === 409 ? estimate.error : null;
  return (
    <section className="space-y-5">
      <h1 className="text-2xl font-semibold">Your starting targets</h1>
      {estimate.isPending ? (
        <Spinner />
      ) : needsData ? (
        <div role="alert" className="space-y-2 rounded-2xl bg-surface p-4 text-sm">
          <p>{needsData.message}. Targets are based on your weight.</p>
          <Link to="/" className="text-accent">
            Go to Home
          </Link>
        </div>
      ) : estimate.isError ? (
        <ErrorState message={estimate.error.message} onRetry={() => void estimate.refetch()} />
      ) : est ? (
        <>
          <p className="rounded-2xl bg-surface p-4 text-sm">
            Resting burn (BMR) {est.bmr.toLocaleString("en-GB")} kcal
            {est.method === "katch"
              ? " (Katch-McArdle, from your lean mass)"
              : " (Mifflin-St Jeor, from weight, height and age)"}{" "}
            × {est.activity_factor} activity = about{" "}
            <strong>{est.tdee.toLocaleString("en-GB")} kcal</strong> a day. Once you've logged food
            for a few weeks, BodyOS will refine this from your real intake and weight trend.
          </p>
          <TargetsForm
            initial={est.targets}
            submitLabel="Save targets"
            onSubmit={async (targets) => {
              await saveSettings.mutateAsync({
                ...settingsInput(current!),
                mode: chosenMode,
                activity_level: chosenActivity,
              });
              await saveTargets.mutateAsync({
                ...targets,
                effective_from: isoDay(new Date()),
                origin: same(targets, est.targets) ? "suggested" : "manual",
                tdee_at_creation: est.tdee,
              });
              void navigate("/food");
            }}
          />
        </>
      ) : null}
      <button type="button" onClick={() => setStep(1)} className="text-sm text-muted">
        Back
      </button>
    </section>
  );
}
